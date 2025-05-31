import { writable } from 'svelte/store';

// Timeout constants - aligned with crawler heartbeat expectations
const HEARTBEAT_TIMEOUT = 30000; // 30 seconds (crawler sends every 10s, timeout after 30s)
const HEALTH_CHECK_INTERVAL = 10000; // Check every 10 seconds

export interface CrawlerStatusCache {
  // Core status data
  status: any | null;
  
  // Connection states
  sseConnected: boolean;
  messageBusConnected: boolean;
  
  // Health indicators
  lastHeartbeat: Date | null;
  lastStatusUpdate: Date | null;
  lastSseMessage: Date | null;
  
  // Job failure logs cache
  jobFailureLogs: any[];
  
  // Meta information
  cacheTimestamp: Date | null;
  isHealthy: boolean;
}

const initialCache: CrawlerStatusCache = {
  status: null,
  sseConnected: false,
  messageBusConnected: false,
  lastHeartbeat: null,
  lastStatusUpdate: null,
  lastSseMessage: null,
  jobFailureLogs: [],
  cacheTimestamp: null,
  isHealthy: false
};

// Create the writable store
export const crawlerCache = writable<CrawlerStatusCache>(initialCache);

// Health monitoring timer
let healthCheckTimer: NodeJS.Timeout | null = null;

// Start periodic health monitoring
const startHealthMonitoring = () => {
  if (healthCheckTimer) clearInterval(healthCheckTimer);
  
  healthCheckTimer = setInterval(() => {
    crawlerCache.update(cache => {
      const now = new Date();
      const isHeartbeatStale = cache.lastHeartbeat ?
        (now.getTime() - cache.lastHeartbeat.getTime()) > HEARTBEAT_TIMEOUT : true;
      
      // If heartbeat is stale but cache shows connected, mark as disconnected
      let updatedCache = cache;
      if (isHeartbeatStale && cache.messageBusConnected) {
        console.warn(`[Cache] Heartbeat timeout detected - marking crawler as disconnected`);
        updatedCache = {
          ...cache,
          messageBusConnected: false
        };
      }
      
      // Always recalculate health status
      return {
        ...updatedCache,
        isHealthy: isSystemHealthy(updatedCache.lastHeartbeat, updatedCache.messageBusConnected, updatedCache.sseConnected)
      };
    });
  }, HEALTH_CHECK_INTERVAL);
};

// Stop health monitoring
export const stopHealthMonitoring = () => {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }
};

// Initialize monitoring in browser environment
if (typeof window !== 'undefined') {
  startHealthMonitoring();
  
  // Clean up on page unload
  window.addEventListener('beforeunload', stopHealthMonitoring);
}

// Helper functions to update the cache
export const updateCrawlerStatus = (status: any, updateCacheTimestamp: boolean = true) => {
  crawlerCache.update(cache => {
    // Only update cacheTimestamp if this is actual crawler data (not routine health checks)
    const updates: any = {
      ...cache,
      status,
      lastStatusUpdate: new Date(),
      isHealthy: isSystemHealthy(cache.lastHeartbeat, cache.messageBusConnected, cache.sseConnected)
    };
    
    if (updateCacheTimestamp) {
      updates.cacheTimestamp = new Date();
    }
    
    return updates;
  });
};

export const updateSseConnection = (connected: boolean) => {
  crawlerCache.update(cache => ({
    ...cache,
    sseConnected: connected,
    lastSseMessage: connected ? new Date() : cache.lastSseMessage,
    isHealthy: isSystemHealthy(cache.lastHeartbeat, cache.messageBusConnected, connected)
  }));
};

export const updateMessageBusConnection = (connected: boolean) => {
  crawlerCache.update(cache => {
    console.log(`[Cache] MessageBus connection updated: ${connected}`);
    return {
      ...cache,
      messageBusConnected: connected,
      isHealthy: isSystemHealthy(cache.lastHeartbeat, connected, cache.sseConnected)
    };
  });
};

export const updateHeartbeat = (timestamp?: string | Date) => {
  const heartbeatTime = timestamp ? new Date(timestamp) : new Date();
  crawlerCache.update(cache => {
    console.log(`[Cache] Heartbeat updated: ${heartbeatTime.toISOString()}`);
    return {
      ...cache,
      lastHeartbeat: heartbeatTime,
      isHealthy: isSystemHealthy(heartbeatTime, cache.messageBusConnected, cache.sseConnected)
    };
  });
};

export const addJobFailureLog = (logEntry: any) => {
  crawlerCache.update(cache => ({
    ...cache,
    jobFailureLogs: [
      {
        ...logEntry,
        timestamp: logEntry.timestamp || new Date().toISOString()
      },
      ...cache.jobFailureLogs
    ].slice(0, 50) // Keep only last 50 entries
  }));
};

export const clearJobFailureLogs = () => {
  crawlerCache.update(cache => ({
    ...cache,
    jobFailureLogs: []
  }));
};

// Updated health check function with correct timeout
const isSystemHealthy = (
  lastHeartbeat: Date | null,
  messageBusConnected: boolean,
  sseConnected: boolean
): boolean => {
  // System is healthy if:
  // 1. SSE is connected (UI can receive updates)
  // 2. MessageBus is connected (backend can communicate with crawler)
  // 3. Recent heartbeat (within last 30 seconds)
  
  const now = new Date();
  const heartbeatHealthy = lastHeartbeat ?
    (now.getTime() - lastHeartbeat.getTime()) < HEARTBEAT_TIMEOUT : false;
  
  return sseConnected && messageBusConnected && heartbeatHealthy;
};

// Get cached data for immediate display
export const getCachedStatus = (): CrawlerStatusCache => {
  let currentCache: CrawlerStatusCache;
  crawlerCache.subscribe(cache => currentCache = cache)();
  return currentCache!;
};

// Export constants for use in other modules
export { HEARTBEAT_TIMEOUT, HEALTH_CHECK_INTERVAL };