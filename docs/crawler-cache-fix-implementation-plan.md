# Crawler Cache Fix Implementation Plan

## Problem Summary

The crawler dashboard shows that the crawler is "connected" even when it's disconnected because:

1. **Mismatched timeout values**: Cache uses 2-minute timeout but crawler sends heartbeats every 10 seconds with expected 30-second timeout
2. **No proactive monitoring**: Cache only updates when new data arrives, doesn't actively check for stale heartbeats
3. **Inconsistent state management**: Connection loss isn't properly reflected in cached data

## Implementation Plan

### Phase 1: Fix Cache Timeout Logic (Priority: HIGH)

#### File: `src/lib/stores/crawler-cache.ts`

**Changes needed:**

1. **Update timeout constants**:
   ```typescript
   // Change from 120000ms (2 minutes) to 30000ms (30 seconds)
   const HEARTBEAT_TIMEOUT = 30000; // 30 seconds
   const HEALTH_CHECK_INTERVAL = 10000; // Check every 10 seconds
   ```

2. **Add periodic health monitoring**:
   ```typescript
   let healthCheckTimer: NodeJS.Timeout | null = null;
   
   const startHealthMonitoring = () => {
     if (healthCheckTimer) clearInterval(healthCheckTimer);
     
     healthCheckTimer = setInterval(() => {
       crawlerCache.update(cache => {
         const now = new Date();
         const isHeartbeatStale = cache.lastHeartbeat ? 
           (now.getTime() - cache.lastHeartbeat.getTime()) > HEARTBEAT_TIMEOUT : true;
         
         if (isHeartbeatStale && cache.messageBusConnected) {
           // Heartbeat is stale but cache shows connected - mark as disconnected
           return {
             ...cache,
             messageBusConnected: false,
             isHealthy: false
           };
         }
         
         return {
           ...cache,
           isHealthy: isSystemHealthy(cache.lastHeartbeat, cache.messageBusConnected, cache.sseConnected)
         };
       });
     }, HEALTH_CHECK_INTERVAL);
   };
   ```

3. **Update health check function**:
   ```typescript
   const isSystemHealthy = (
     lastHeartbeat: Date | null, 
     messageBusConnected: boolean, 
     sseConnected: boolean
   ): boolean => {
     const now = new Date();
     const heartbeatHealthy = lastHeartbeat ? 
       (now.getTime() - lastHeartbeat.getTime()) < HEARTBEAT_TIMEOUT : false;
     
     return sseConnected && messageBusConnected && heartbeatHealthy;
   };
   ```

4. **Add cleanup function**:
   ```typescript
   export const stopHealthMonitoring = () => {
     if (healthCheckTimer) {
       clearInterval(healthCheckTimer);
       healthCheckTimer = null;
     }
   };
   ```

5. **Initialize monitoring**:
   ```typescript
   // Start health monitoring when store is created
   if (typeof window !== 'undefined') {
     startHealthMonitoring();
   }
   ```

### Phase 2: Enhance MessageBusClient Timeout Handling (Priority: HIGH)

#### File: `src/lib/messaging/MessageBusClient.ts`

**Changes needed:**

1. **Add heartbeat timeout tracking**:
   ```typescript
   private lastHeartbeatTime: number = 0;
   private heartbeatTimeoutTimer: Timer | null = null;
   private readonly HEARTBEAT_TIMEOUT = 30000; // 30 seconds
   ```

2. **Implement heartbeat timeout detection**:
   ```typescript
   private startHeartbeatMonitoring(): void {
     if (this.heartbeatTimeoutTimer) {
       clearTimeout(this.heartbeatTimeoutTimer);
     }
     
     this.heartbeatTimeoutTimer = setTimeout(() => {
       this.logger.warn("Heartbeat timeout - marking connection as lost");
       updateMessageBusConnection(false);
       this.emit("heartbeatTimeout");
     }, this.HEARTBEAT_TIMEOUT);
   }
   
   private resetHeartbeatTimeout(): void {
     this.lastHeartbeatTime = Date.now();
     this.startHeartbeatMonitoring();
   }
   ```

3. **Update heartbeat handling**:
   ```typescript
   case MessageType.HEARTBEAT: {
     this.logger.debug("MessageBusClient: Processing HEARTBEAT");
     this.resetHeartbeatTimeout(); // Reset timeout on heartbeat
     
     const heartbeatTimestamp = message.payload?.timestamp || message.timestamp || new Date().toISOString();
     updateHeartbeat(heartbeatTimestamp);
     this.emit("heartbeat", message.payload);
     break;
   }
   ```

4. **Update connection handling**:
   ```typescript
   open: () => {
     this.connected = true;
     this.reconnectAttempts = 0;
     this.logger.info(`Connected to supervisor at ${this.socketPath}`);
     
     updateMessageBusConnection(true);
     this.resetHeartbeatTimeout(); // Start monitoring heartbeats
     
     this.emit("connected");
     // ... rest of existing code
   },
   
   close: () => {
     this.connected = false;
     if (this.heartbeatTimeoutTimer) {
       clearTimeout(this.heartbeatTimeoutTimer);
       this.heartbeatTimeoutTimer = null;
     }
     
     this.logger.warn("Disconnected from supervisor");
     updateMessageBusConnection(false);
     // ... rest of existing code
   }
   ```

### Phase 3: Update Dashboard Component (Priority: MEDIUM)

#### File: `src/routes/admin/crawler/+page.svelte`

**Changes needed:**

1. **Add better connection state indicators**:
   ```typescript
   // Add computed state for connection status
   $: connectionStatus = (() => {
     if (!cache.messageBusConnected && !cache.lastHeartbeat) {
       return { status: 'never-connected', message: 'Crawler not available' };
     } else if (!cache.messageBusConnected && cache.lastHeartbeat) {
       const timeSinceHeartbeat = new Date().getTime() - cache.lastHeartbeat.getTime();
       if (timeSinceHeartbeat > 30000) {
         return { status: 'timeout', message: 'Connection timeout' };
       } else {
         return { status: 'disconnected', message: 'Connection lost' };
       }
     } else {
       return { status: 'connected', message: 'Connected' };
     }
   })();
   ```

2. **Update connection status display**:
   ```svelte
   <!-- Backend Connection with better status -->
   <div class="flex items-center gap-2">
     {#if connectionStatus.status === 'connected'}
       <div class="flex items-center gap-2 text-sm text-green-600">
         <ChevronsLeftRightEllipsisIcon class="h-4 w-4" />
         <span>Crawler</span>
       </div>
     {:else if connectionStatus.status === 'timeout'}
       <div class="flex items-center gap-2 text-sm text-orange-600">
         <Clock class="h-4 w-4" />
         <span>Timeout</span>
       </div>
     {:else}
       <div class="flex items-center gap-2 text-sm text-red-600">
         <CircleOff class="h-4 w-4" />
         <span>Disconnected</span>
       </div>
     {/if}
   </div>
   ```

3. **Add periodic cache validation**:
   ```typescript
   onMount(() => {
     // ... existing code ...
     
     // Add periodic validation of cached data
     const cacheValidationInterval = setInterval(() => {
       const currentCache = getCachedStatus();
       if (currentCache.lastHeartbeat) {
         const timeSinceHeartbeat = new Date().getTime() - currentCache.lastHeartbeat.getTime();
         if (timeSinceHeartbeat > 30000 && currentCache.messageBusConnected) {
           // Force update cache if heartbeat is stale but shows connected
           updateMessageBusConnection(false);
         }
       }
     }, 10000); // Check every 10 seconds
     
     onDestroy(() => {
       clearInterval(cacheValidationInterval);
     });
   });
   ```

### Phase 4: Improve SSE Endpoint (Priority: MEDIUM)

#### File: `src/routes/api/admin/crawler/status/+server.ts`

**Changes needed:**

1. **Add periodic health broadcasts**:
   ```typescript
   // Add periodic health status broadcast
   const healthBroadcastInterval = setInterval(() => {
     const cachedData = getCachedStatus();
     const healthStatus = {
       type: "health_check",
       payload: {
         messageBusConnected: !!messageBusClient,
         lastHeartbeat: cachedData.lastHeartbeat?.toISOString() || null,
         isHealthy: cachedData.isHealthy,
         timestamp: new Date().toISOString()
       }
     };
     
     try {
       controller.enqueue(`data: ${JSON.stringify(healthStatus)}\n\n`);
     } catch (error) {
       logger.error("Error sending health broadcast:", { error });
     }
   }, 20000); // Every 20 seconds
   ```

2. **Update cleanup on client disconnect**:
   ```typescript
   request.signal?.addEventListener('abort', () => {
     logger.info("SSE client disconnected, cleaning up listeners");
     
     // Clear health broadcast interval
     if (healthBroadcastInterval) {
       clearInterval(healthBroadcastInterval);
     }
     
     // ... existing cleanup code ...
   });
   ```

### Phase 5: Update Server Supervisor Constants (Priority: MEDIUM)

#### File: `src/lib/server/supervisor.ts`

**Changes needed:**

1. **Update heartbeat timeout constant**:
   ```typescript
   // Change from 60000ms to 30000ms to match expected behavior
   const HEARTBEAT_TIMEOUT = 30000 // 30 seconds
   ```

2. **Update monitoring interval**:
   ```typescript
   // Monitor every 10 seconds instead of every 30 seconds
   setInterval(() => {
     if (messageBusClientInstance && lastHeartbeat !== 0 && Date.now() - lastHeartbeat > HEARTBEAT_TIMEOUT) {
       logger.warn(
         `No heartbeat or status update received from crawler via supervisor in over ${HEARTBEAT_TIMEOUT / 1000} seconds. Communication might be stale.`
       )
       
       // Reset running jobs if heartbeat timeout indicates lost connection
       if (Date.now() - lastHeartbeat > HEARTBEAT_TIMEOUT * 2) {
         logger.warn("Extended heartbeat timeout detected - resetting running jobs to queued");
         resetRunningJobsOnDisconnect();
         lastHeartbeat = 0;
       }
     }
   }, 10000) // Check every 10 seconds
   ```

## Implementation Timeline

1. **Phase 1** (Most Critical): Fix cache timeout logic - 30 minutes
2. **Phase 2** (High Priority): Enhance MessageBusClient - 45 minutes  
3. **Phase 3** (Medium Priority): Update dashboard component - 30 minutes
4. **Phase 4** (Medium Priority): Improve SSE endpoint - 20 minutes
5. **Phase 5** (Low Priority): Update server constants - 10 minutes

**Total estimated time: ~2.5 hours**

## Testing Plan

1. **Test heartbeat timeout**: Stop crawler and verify dashboard shows "disconnected" within 30 seconds
2. **Test connection recovery**: Restart crawler and verify dashboard shows "connected" when heartbeats resume
3. **Test SSE resilience**: Disconnect/reconnect browser and verify real-time updates continue
4. **Test cache persistence**: Refresh browser and verify cached state reflects actual connection status

## Success Criteria

- ✅ Dashboard shows "Disconnected" within 30 seconds when crawler stops sending heartbeats
- ✅ Dashboard shows "Connected" immediately when crawler reconnects and sends heartbeats
- ✅ Cache state accurately reflects actual connection status at all times
- ✅ No false positives showing "Connected" when crawler is actually disconnected
- ✅ Proper visual indicators for different types of connection issues

## Next Steps

1. Switch to Code mode to implement these changes
2. Start with Phase 1 (cache timeout fixes) as it's the most critical
3. Test each phase before moving to the next
4. Monitor logs to verify proper timeout behavior