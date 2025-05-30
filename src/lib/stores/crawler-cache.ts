import { writable } from 'svelte/store';

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

// Helper functions to update the cache
export const updateCrawlerStatus = (status: any) => {
  crawlerCache.update(cache => ({
    ...cache,
    status,
    lastStatusUpdate: new Date(),
    cacheTimestamp: new Date(),
    isHealthy: isSystemHealthy(cache.lastHeartbeat, cache.messageBusConnected, cache.sseConnected)
  }));
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
  crawlerCache.update(cache => ({
    ...cache,
    messageBusConnected: connected,
    isHealthy: isSystemHealthy(cache.lastHeartbeat, connected, cache.sseConnected)
  }));
};

export const updateHeartbeat = (timestamp?: string | Date) => {
  const heartbeatTime = timestamp ? new Date(timestamp) : new Date();
  crawlerCache.update(cache => ({
    ...cache,
    lastHeartbeat: heartbeatTime,
    isHealthy: isSystemHealthy(heartbeatTime, cache.messageBusConnected, cache.sseConnected)
  }));
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

// Health check function
const isSystemHealthy = (
  lastHeartbeat: Date | null, 
  messageBusConnected: boolean, 
  sseConnected: boolean
): boolean => {
  // System is healthy if:
  // 1. SSE is connected (UI can receive updates)
  // 2. MessageBus is connected (backend can communicate with crawler)
  // 3. Recent heartbeat (within last 2 minutes)
  
  const now = new Date();
  const heartbeatHealthy = lastHeartbeat ? 
    (now.getTime() - lastHeartbeat.getTime()) < 120000 : false; // 2 minutes
  
  return sseConnected && messageBusConnected && heartbeatHealthy;
};

// Get cached data for immediate display
export const getCachedStatus = (): CrawlerStatusCache => {
  let currentCache: CrawlerStatusCache;
  crawlerCache.subscribe(cache => currentCache = cache)();
  return currentCache!;
};