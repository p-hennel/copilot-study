# Crawler Cache Flickering Fix - COMPLETED

## Problem Identified

The dashboard was flickering between "connected" and "disconnected" states every few seconds because:

1. **SSE endpoint was incorrectly reporting connection status** - it was checking `!!messageBusClient` (whether the instance exists) instead of whether it's actually connected to the socket
2. **Health broadcasts were too frequent** (every 20 seconds) and were overriding the cache's correct timeout detection
3. **False positive connections** - the MessageBusClient singleton exists even when it can't connect to the socket file

## Root Cause Analysis

From the logs:
- **Backend**: `Socket file does not exist: /Users/philhennel/Code/copilot-survey/data.private/config/api.sock`
- **SSE endpoint**: Reported `messageBusConnected: true` because `!!messageBusClient` was true (instance exists)
- **Cache timeout**: Correctly detected no heartbeats and marked as disconnected
- **Health broadcast**: Every 20s, re-marked as connected, causing the cycle

## Solution Implemented

### 1. Added `isConnected()` Method to MessageBusClient
**File: `src/lib/messaging/MessageBusClient.ts`**
```typescript
/**
 * Get the current connection status
 */
public isConnected(): boolean {
  return this.connected;
}
```

### 2. Fixed SSE Endpoint Connection Detection
**File: `src/routes/api/admin/crawler/status/+server.ts`**

**Before:**
```typescript
messageBusConnected: !!messageBusClient,  // Wrong - checks if instance exists
```

**After:**
```typescript
const actuallyConnected = messageBusClient?.isConnected() ?? false;
messageBusConnected: actuallyConnected,  // Correct - checks actual connection
```

### 3. Applied Fix to All Connection Checks
- ✅ Initial client status message
- ✅ Periodic health broadcasts  
- ✅ Fallback JSON response
- ✅ Cache updates

### 4. Reduced Health Broadcast Frequency
**Before:** Every 20 seconds (causing frequent overrides)
**After:** Every 60 seconds (cache handles real-time detection)

## Expected Behavior Now

### When Crawler is Disconnected:
1. **MessageBusClient.isConnected()** returns `false` (socket not connected)
2. **SSE endpoint** correctly reports `messageBusConnected: false`
3. **Cache** maintains `messageBusConnected: false` consistently
4. **Dashboard** shows "Unavailable" or "Disconnected" without flickering

### When Crawler Connects:
1. **MessageBusClient.isConnected()** returns `true` (socket connected)
2. **Heartbeats start flowing** and reset the cache timeout
3. **SSE endpoint** correctly reports `messageBusConnected: true`
4. **Dashboard** shows "Connected" consistently

## Testing Results Expected

- ✅ **No more flickering** between connected/disconnected states
- ✅ **Accurate status reporting** when crawler is truly unavailable
- ✅ **Faster detection** when crawler becomes available (immediate on connection)
- ✅ **Consistent cache state** that doesn't get overridden by false positives

## Key Changes Summary

| Component | Change | Impact |
|-----------|--------|---------|
| **MessageBusClient** | Added `isConnected()` public method | Exposes actual socket connection status |
| **SSE Endpoint** | Use `isConnected()` instead of `!!instance` | Accurate connection reporting |
| **Health Broadcasts** | Reduced from 20s to 60s interval | Less interference with cache timeout |
| **Cache Updates** | Use actual connection status | Consistent state management |

The fix addresses the core issue where the existence of the MessageBusClient instance was being confused with an actual active connection to the crawler socket.