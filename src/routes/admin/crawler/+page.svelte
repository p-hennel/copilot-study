<script lang="ts">
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Progress } from "$lib/components/ui/progress/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import {
    Activity,
    CircleAlert,
    RefreshCw,
    Play,
    Pause,
    Square,
    Clock,
    CheckCircle,
    XCircle,
    Loader2,
    Wifi,
    WifiOff,
    Heart,
    AlertCircle,
    CheckCircle2,
    Zap,
    Database,

    ChevronsLeftRightEllipsisIcon,

    CircleOff


  } from "lucide-svelte";
  import Time from "svelte-time/Time.svelte";
  import { invalidate } from "$app/navigation";
  import type { PageData } from "./$types";
  import { invalidateWithLoading } from "$lib/utils/admin-fetch";
  import { toast } from "svelte-sonner";
  import { onMount, onDestroy } from "svelte";
  import {
    crawlerCache,
    updateCrawlerStatus,
    updateSseConnection,
    updateMessageBusConnection,
    updateHeartbeat,
    addJobFailureLog,
    clearJobFailureLogs,
    getCachedStatus,
    type CrawlerStatusCache
  } from "$lib/stores/crawler-cache";
    import { Archive, Binoculars, CirclePause, ClipboardList, Ellipsis, Radio } from "@lucide/svelte";

  let { data }: { data: PageData } = $props();

  // Component state
  let loading = $state(false);
  let sseConnected = $state(false);
  let sseReconnectAttempts = $state(0);
  let lastUpdate = $state<Date | null>(null);
  
  // Cache state - reactive to store changes
  let cache: CrawlerStatusCache = $state(getCachedStatus());
  
  // Real-time crawler status (starts with cached data, gets updated via SSE)
  let crawlerStatus = $state<any>(cache.status);
  
  // Job failure logs state (from cache)
  let jobFailureLogs = $state<any[]>(cache.jobFailureLogs);
  const MAX_LOGS = 50; // Keep only the last 50 log entries
  
  // Real-time connection (WebSocket or EventSource)
  let ws: WebSocket | EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let cacheValidationInterval: ReturnType<typeof setInterval> | null = null;
  
  // Connection status computed from cache
  let connectionStatus = $derived((() => {
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
  })());
  
  // Initialize with cached data from loader for immediate display
  onMount(async () => {
    // Start with cached data from loader for immediate display
    if (data.cached?.status) {
      crawlerStatus = data.cached.status;
      cache = {
        ...cache,
        status: data.cached.status,
        lastHeartbeat: data.cached.lastHeartbeat ? new Date(data.cached.lastHeartbeat) : null,
        lastStatusUpdate: data.cached.lastStatusUpdate ? new Date(data.cached.lastStatusUpdate) : null,
        jobFailureLogs: data.cached.jobFailureLogs || [],
        isHealthy: data.cached.isHealthy || false,
        sseConnected: data.cached.sseConnected || false,
        messageBusConnected: data.cached.messageBusConnected || false
      };
      jobFailureLogs = data.cached.jobFailureLogs || [];
    } else {
      // Fallback to current cache if no loader data
      cache = getCachedStatus();
      crawlerStatus = cache.status;
      jobFailureLogs = cache.jobFailureLogs;
    }
    
    // Subscribe to cache updates
    const unsubscribe = crawlerCache.subscribe(newCache => {
      cache = newCache;
      crawlerStatus = newCache.status;
      jobFailureLogs = newCache.jobFailureLogs;
    });
    
    // Clean up subscription on destroy
    onDestroy(() => {
      unsubscribe();
    });
    
    try {
      const initialData = await data.crawler;
      if (initialData) {
        crawlerStatus = initialData;
        updateCrawlerStatus(initialData);
        lastUpdate = new Date();
      }
    } catch (error) {
      console.error("Failed to load initial crawler data:", error);
    }
    
    // Connect to SSE for real-time updates
    connectWebSocket();
    
    // Add periodic validation of cached data
    cacheValidationInterval = setInterval(() => {
      const currentCache = getCachedStatus();
      if (currentCache.lastHeartbeat) {
        const timeSinceHeartbeat = new Date().getTime() - currentCache.lastHeartbeat.getTime();
        if (timeSinceHeartbeat > 30000 && currentCache.messageBusConnected) {
          // Force update cache if heartbeat is stale but shows connected
          console.warn('[Dashboard] Detected stale heartbeat, forcing cache update');
          updateMessageBusConnection(false);
        }
      }
    }, 10000); // Check every 10 seconds
  });

  onDestroy(() => {
    disconnectWebSocket();
    
    // Clean up cache validation interval
    if (cacheValidationInterval) {
      clearInterval(cacheValidationInterval);
      cacheValidationInterval = null;
    }
  });

  function connectWebSocket() {
    try {
      const sseUrl = `/api/admin/crawler/status`;
      
      // Use EventSource for Server-Sent Events
      const eventSource = new EventSource(sseUrl);
      
      eventSource.onopen = () => {
        sseConnected = true;
        sseReconnectAttempts = 0;
        updateSseConnection(true);
        console.log("Crawler SSE connected");
        toast.success("Real-time updates connected");
      };
      
      eventSource.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log("DEBUG SSE: Received message from server:", message);
          handleWebSocketMessage(message);
        } catch (error) {
          console.error("Error parsing SSE message:", error);
        }
      };
      
      eventSource.onerror = (error) => {
        console.error("Crawler SSE error:", error);
        sseConnected = false;
        updateSseConnection(false);
        eventSource.close();
        if (sseReconnectAttempts < 5) {
          scheduleReconnect();
        }
      };
      
      // Store reference for cleanup
      ws = eventSource as any; // Type compatibility
      
    } catch (error) {
      console.error("Failed to connect to crawler SSE:", error);
      sseConnected = false;
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    
    const delay = Math.min(1000 * Math.pow(2, sseReconnectAttempts), 30000);
    sseReconnectAttempts++;
    
    reconnectTimer = setTimeout(() => {
      console.log(`Attempting to reconnect to crawler SSE (attempt ${sseReconnectAttempts})...`);
      connectWebSocket();
    }, delay);
  }

  function disconnectWebSocket() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    
    if (ws) {
      if (ws instanceof EventSource) {
        ws.close();
      } else if (ws instanceof WebSocket) {
        ws.close();
      }
      ws = null;
    }
    
    sseConnected = false;
    updateSseConnection(false);
  }

  function handleWebSocketMessage(message: any) {
    lastUpdate = new Date();
    
    switch (message.type) {
      case "client_status":
        // Handle initial client status with cached data
        if (message.payload) {
          updateMessageBusConnection(message.payload.messageBusConnected);
          if (message.payload.cachedStatus) {
            crawlerStatus = message.payload.cachedStatus;
            // Don't update cache timestamp - this is just restoring cached data, not new data
            updateCrawlerStatus(message.payload.cachedStatus, false);
          }
          if (message.payload.lastHeartbeat) {
            updateHeartbeat(message.payload.lastHeartbeat);
          }
          if (message.payload.jobFailureLogs) {
            jobFailureLogs = message.payload.jobFailureLogs;
          }
        }
        break;
        
      case "statusUpdate":
        if (message.payload) {
          crawlerStatus = { ...crawlerStatus, ...message.payload };
          updateCrawlerStatus(crawlerStatus);
          console.log("Received crawler status update:", message.payload);
        }
        break;
        
      case "jobUpdate":
        if (message.payload) {
          console.log("Received crawler job update:", message.payload);
          // Update specific job-related status
          if (crawlerStatus) {
            crawlerStatus = { ...crawlerStatus };
            updateCrawlerStatus(crawlerStatus);
          }
        }
        break;
        
      case "jobFailure":
        if (message.payload) {
          console.log("DEBUG: Received job failure log:", message.payload);
          addJobFailureLog(message.payload);
        } else {
          console.log("DEBUG: Received jobFailure message with no payload:", message);
        }
        break;
        
      case "heartbeat":
        if (message.payload) {
          console.log("Received crawler heartbeat:", message.payload);
          const timestamp = message.payload.timestamp || message.timestamp || new Date()?.toISOString();
          updateHeartbeat(timestamp);
          // Don't store heartbeat in crawlerStatus - use cache instead
        }
        break;
        
      case "connection":
        if (message.payload) {
          if (message.payload.component === "messageBus") {
            updateMessageBusConnection(message.payload.status === "connected");
          }
        }
        break;
        
      case "health_check":
        if (message.payload) {
          console.log("[Dashboard] Received health check:", message.payload);
          // Update connection status based on health check
          updateMessageBusConnection(message.payload.messageBusConnected);
          if (message.payload.lastHeartbeat) {
            updateHeartbeat(message.payload.lastHeartbeat);
          }
        }
        break;
        
      default:
        console.log("Received unknown SSE message type:", message.type);
    }
  }

  // Enhanced refresh function
  async function refreshCrawlerStatus() {
    loading = true;
    try {
      await invalidateWithLoading(
        () => invalidate("/api/admin/crawler"),
        'Refreshing crawler status...'
      );
      
      // Update with fresh data
      const freshData = await data.crawler;
      crawlerStatus = freshData;
      lastUpdate = new Date();
      
      toast.success("Crawler status refreshed");
    } catch (error) {
      console.error("Failed to refresh crawler status:", error);
      toast.error("Failed to refresh crawler status");
    } finally {
      loading = false;
    }
  }

  // Crawler control functions
  async function pauseCrawler() {
    loading = true;
    try {
      const response = await fetch("/api/admin/crawler/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      
      if (response.ok) {
        toast.success("Crawler paused");
        await refreshCrawlerStatus();
      } else {
        throw new Error("Failed to pause crawler");
      }
    } catch (error) {
      console.error("Error pausing crawler:", error);
      toast.error("Failed to pause crawler");
    } finally {
      loading = false;
    }
  }

  async function resumeCrawler() {
    loading = true;
    try {
      const response = await fetch("/api/admin/crawler/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      
      if (response.ok) {
        toast.success("Crawler resumed");
        await refreshCrawlerStatus();
      } else {
        throw new Error("Failed to resume crawler");
      }
    } catch (error) {
      console.error("Error resuming crawler:", error);
      toast.error("Failed to resume crawler");
    } finally {
      loading = false;
    }
  }

  // Clear job failure logs
  function clearJobFailureLogsLocal() {
    clearJobFailureLogs();
    toast.success("Job failure logs cleared");
  }

  // Helper functions
  function getStatusBadgeVariant(status: string) {
    switch (status?.toLowerCase()) {
      case "running":
        return "default";
      case "paused":
        return "secondary";
      case "stopped":
        return "destructive";
      default:
        return "destructive";
    }
  }

  function getStatusIcon(status: string) {
    switch (status?.toLowerCase()) {
      case "running":
        return Play;
      case "paused":
        return Pause;
      case "stopped":
        return Square;
      default:
        return Binoculars;
    }
  }
</script>

<div class="space-y-6">
  <!-- Page Header -->
  <div class="flex items-center justify-between">
    <div class="space-y-1">
      <div class="flex items-center gap-3">
        <h1 class="text-2xl font-semibold tracking-tight">Crawler Status</h1>
        <!-- Overall Health Indicator -->
        {#if cache.isHealthy}
          <Badge variant="default" class="text-xs">
            <CheckCircle2 class="h-3 w-3 mr-1" />
            System Healthy
          </Badge>
        {:else}
          <Badge variant="destructive" class="text-xs">
            <AlertCircle class="h-3 w-3 mr-1" />
            System Issues
          </Badge>
        {/if}
      </div>
      <p class="text-sm text-muted-foreground">
        Real-time monitoring and control of the crawler system
      </p>
    </div>
    
    <!-- Connection Status -->
    <div class="flex items-center gap-4">
      <!-- SSE Connection -->
      <div class="flex items-center gap-2">
        {#if sseConnected}
          <div class="flex items-center gap-2 text-sm text-green-600">
            <Wifi class="h-4 w-4" />
            <span>API</span>
          </div>
        {:else}
          <div class="flex items-center gap-2 text-sm text-red-600">
            <WifiOff class="h-4 w-4" />
            <span>API</span>
            {#if sseReconnectAttempts > 0}
              <span class="text-xs">({sseReconnectAttempts} attempts)</span>
            {/if}
          </div>
        {/if}
      </div>
      
      {#if lastUpdate}
        <div class="text-xs text-muted-foreground">
          <div class="flex items-center gap-2">
            <Radio class="h-4 w-4" />
            <span>
              <Tooltip.Provider delayDuration={0}>
                <Tooltip.Root>
                  <Tooltip.Trigger>
                    <Time timestamp={lastUpdate?.toISOString()} relative />
                  </Tooltip.Trigger>
                  <Tooltip.Content>
                    <Time timestamp={lastUpdate?.toISOString()} format="DD. MMM YYYY, HH:mm:ss" />
                  </Tooltip.Content>
                </Tooltip.Root>
              </Tooltip.Provider>
              
            </span>
          </div>
        </div>
      {/if}
    </div>
  </div>

  {#await data.crawler}
    <!-- Loading State -->
    <div class="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
      {#each Array(4) as _, i}
        <Card.Root>
          <Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
            <div class="h-4 w-20 bg-muted rounded animate-pulse"></div>
            <div class="h-4 w-4 bg-muted rounded animate-pulse"></div>
          </Card.Header>
          <Card.Content>
            <div class="h-8 w-16 bg-muted rounded animate-pulse"></div>
          </Card.Content>
        </Card.Root>
      {/each}
    </div>
  {:then initialCrawler}
    {#if crawlerStatus && typeof crawlerStatus === 'object'}
      <!-- Status Cards -->
      <div class="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <!-- Status -->
        <Card.Root>
          <Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
            <Card.Title class="text-sm font-medium">Status</Card.Title>
            {#if !crawlerStatus.state}
              <div class="h-5 w-5 text-red-600 relative">
                <Binoculars class="absolute h-5 w-5" />
                <Binoculars class="absolute h-5 w-5 animate-ping" />
              </div>
            {:else}
              {@const StatusIcon = getStatusIcon(crawlerStatus.state)}
              <StatusIcon class="h-5 w-5 text-muted-foreground" />
            {/if}
          </Card.Header>
          <Card.Content>
            <div class="flex items-center gap-3">
              <Badge variant={getStatusBadgeVariant(crawlerStatus.state || "unknown")}>
                {crawlerStatus.state || "Unavailable"}
              </Badge>
              {#if crawlerStatus.running}
                <Heart class="h-5 w-5 text-green-500 animate-pulse" />
              {:else if crawlerStatus.paused}
                <CirclePause class="h-5 w-5 text-yellow-500 animate-ping" />
              {/if}
            </div>
          </Card.Content>
        </Card.Root>

        <!-- Queue -->
        <Card.Root>
          <Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
            <Card.Title class="text-sm font-medium">Queued Jobs</Card.Title>
            <ClipboardList class="h-5 w-5 text-muted-foreground" />
          </Card.Header>
          <Card.Content>
            <div class="text-2xl font-bold">{crawlerStatus.queued || 0}</div>
          </Card.Content>
        </Card.Root>

        <!-- Processing -->
        <Card.Root>
          <Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
            <Card.Title class="text-sm font-medium">Processing</Card.Title>
            {#if crawlerStatus.processing > 0}
              <Loader2 class="h-5 w-5 text-muted-foreground animate-spin" />
            {:else}
              <CirclePause class="h-5 w-5 text-muted-foreground" />
            {/if}
          </Card.Header>
          <Card.Content>
            <div class="text-2xl font-bold">{crawlerStatus.processing || 0}</div>
          </Card.Content>
        </Card.Root>

        <!-- Completed -->
        <Card.Root>
          <Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
            <Card.Title class="text-sm font-medium">Completed</Card.Title>
            <CheckCircle class="h-5 w-5 text-muted-foreground" />
          </Card.Header>
          <Card.Content>
            <div class="text-2xl font-bold text-green-600">{crawlerStatus.completed || 0}</div>
          </Card.Content>
        </Card.Root>
      </div>

      <!-- Detailed Status -->
      <div class="grid gap-6 md:grid-cols-2">
        <!-- Main Status Card -->
        <Card.Root>
          <Card.Header>
            <Card.Title class="flex items-center gap-2">
              <Activity class="h-5 w-5" />
              Crawler Details
            </Card.Title>
            <div class="space-y-1">
              <Card.Description>
              {#if cache.lastHeartbeat}
                  Last heartbeat:
                  <Tooltip.Provider delayDuration={0}>
                    <Tooltip.Root>
                      <Tooltip.Trigger>
                        <Time timestamp={cache.lastHeartbeat.toISOString()} relative />
                      </Tooltip.Trigger>
                      <Tooltip.Content>
                        <Time timestamp={cache.lastHeartbeat.toISOString()} format="DD. MMM YYYY, HH:mm:ss" />
                      </Tooltip.Content>
                    </Tooltip.Root>
                  </Tooltip.Provider>
              {:else}
                <div class="flex flex-row gap-2 items-center">
                  <Tooltip.Provider delayDuration={0}>
                    <Tooltip.Root>
                      <Tooltip.Trigger>
                        <Archive class="w-5 h-5" />
                      </Tooltip.Trigger>
                      <Tooltip.Content>
                        Data is Cached
                      </Tooltip.Content>
                    </Tooltip.Root>
                  </Tooltip.Provider>
                  <div class="grow flex flex-row flex-wrap justify-between">
                    <div class="flex flex-row gap-1">
                      Last heartbeat:
                      {#if cache.lastHeartbeat}
                        <Tooltip.Provider delayDuration={0}>
                          <Tooltip.Root>
                            <Tooltip.Trigger>
                              <Time timestamp={cache.lastHeartbeat.toISOString()} relative />
                            </Tooltip.Trigger>
                            <Tooltip.Content>
                              <Time timestamp={cache.lastHeartbeat.toISOString()} format="DD. MMM YYYY, HH:mm:ss" /> (cached)
                            </Tooltip.Content>
                          </Tooltip.Root>
                        </Tooltip.Provider>
                      {:else}
                        <Tooltip.Provider delayDuration={0}>
                          <Tooltip.Root>
                            <Tooltip.Trigger>
                              <Ellipsis class="w-4 h-4 mt-0.5" />
                            </Tooltip.Trigger>
                            <Tooltip.Content>
                              No heartbeat received yet
                            </Tooltip.Content>
                          </Tooltip.Root>
                        </Tooltip.Provider>
                      {/if}
                    </div>
                    {#if cache.cacheTimestamp}
                      <span>
                        Cache age:
                        <Tooltip.Provider delayDuration={0}>
                          <Tooltip.Root>
                            <Tooltip.Trigger>
                              <Time timestamp={cache.cacheTimestamp?.toISOString()} relative />
                            </Tooltip.Trigger>
                            <Tooltip.Content>
                              <Time timestamp={cache.cacheTimestamp?.toISOString()} format="DD. MMM YYYY, HH:mm:ss" />
                            </Tooltip.Content>
                          </Tooltip.Root>
                        </Tooltip.Provider>
                      </span>
                    {/if}
                  </div>
                </div>
              {/if}
              </Card.Description>
            </div>
          </Card.Header>
          <Card.Content class="space-y-4">
            {#if 'error' in crawlerStatus && crawlerStatus.error}
              <Alert.Root variant="destructive">
                <CircleAlert class="h-4 w-4" />
                <Alert.Title>Error</Alert.Title>
                <Alert.Description>{crawlerStatus.error}</Alert.Description>
              </Alert.Root>
            {/if}

            <div class="grid grid-cols-2 gap-2">
              <div>
                <div class="text-sm font-medium text-muted-foreground">Running</div>
                <div class="text-lg font-semibold">
                  {crawlerStatus.running ? "Yes" : "No"}
                </div>
              </div>
              <div>
                <div class="text-sm font-medium text-muted-foreground">Paused</div>
                <div class="text-lg font-semibold">
                  {crawlerStatus.paused ? "Yes" : "No"}
                </div>
              </div>
              <div>
                <div class="text-sm font-medium text-muted-foreground">Failed Jobs</div>
                <div class="text-lg font-semibold text-red-600">
                  {crawlerStatus.failed || 0}
                </div>
              </div>
              <div>
                <div class="text-sm font-medium text-muted-foreground">Queue Size</div>
                <div class="text-lg font-semibold">
                  {crawlerStatus.queueSize || crawlerStatus.queued || 0}
                </div>
              </div>
            </div>

            {#if 'currentJobId' in crawlerStatus}
              <Separator />
              <div>
                <div class="text-sm font-medium text-muted-foreground">Current Job ID</div>
                <div class="text-sm font-mono bg-muted rounded p-2">
                  {crawlerStatus.currentJobId || "[none]"}
                </div>
              </div>
            {/if}
          </Card.Content>
        </Card.Root>

        <!-- Controls Card -->
        <Card.Root>
          <Card.Header>
            <Card.Title>Crawler Controls</Card.Title>
            <Card.Description class="flex flex-row flex-wrap justify-items-between">
              <div class="grow">
                Manage crawler operations and view real-time updates
              </div>
              <div class="-mt-7 -mr-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loading}
                  onclick={refreshCrawlerStatus}
                >
                  <RefreshCw class="h-4 w-4 mr-2 {loading ? 'animate-spin' : ''}" />
                  Refresh
                </Button>
              </div>
            </Card.Description>
          </Card.Header>
          <Card.Content class="flex flex-col gap-4">
            <!-- Control Buttons -->
            <!--
            <div class="flex flex-wrap gap-2 ">

              {#if !crawlerStatus.paused && crawlerStatus.running}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={loading}
                  onclick={pauseCrawler}
                >
                  <Pause class="h-4 w-4 mr-2" />
                  Pause
                </Button>
              {:else if crawlerStatus.paused}
                <Button
                  size="sm"
                  variant="default"
                  disabled={loading}
                  onclick={resumeCrawler}
                >
                  <Play class="h-4 w-4 mr-2" />
                  Resume
                </Button>
              {/if}
            </div>
            -->

            <!-- Progress visualization -->
            {#if crawlerStatus.completed || crawlerStatus.failed || crawlerStatus.processing || crawlerStatus.queued}
              <div class="space-y-2">
                <div class="text-sm font-medium">Job Progress Overview</div>
                {#each [crawlerStatus] as status}
                  {@const total = (status.completed || 0) + (status.failed || 0) + (status.processing || 0) + (status.queued || 0)}
                  {#if total > 0}
                    {@const completedPercent = ((status.completed || 0) / total) * 100}
                    <Progress value={completedPercent} class="h-2" />
                    <div class="flex justify-between text-xs text-muted-foreground">
                      <span>{status.completed || 0} completed</span>
                      <span>{total} total</span>
                    </div>
                  {:else}
                    <div class="text-sm text-muted-foreground">No jobs in queue</div>
                  {/if}
                {/each}
              </div>
            {/if}

            <!-- Connection Status -->
            <Separator />
            <div class="flex flex-row flex-wrap justify-between gap-4">
              
              <!-- SSE Connection -->
              <div class="space-y-2">
                <div class="text-xs font-medium text-muted-foreground">API Connection</div>
                <div class="flex items-center gap-2">
                  {#if sseConnected}
                    <Badge variant="default" class="text-xs">
                      <Wifi class="h-3 w-3 mr-1" />
                      Connected
                    </Badge>
                  {:else}
                    <Badge variant="destructive" class="text-xs">
                      <WifiOff class="h-3 w-3 mr-1" />
                      Disconnected
                    </Badge>
                  {/if}
                  
                  {#if !sseConnected}
                    <Button
                      size="sm"
                      variant="ghost"
                      class="h-6 px-2 text-xs"
                      onclick={connectWebSocket}
                      disabled={sseConnected}
                    >
                      Connect
                    </Button>
                  {/if}
                </div>
              </div>
              
              <!-- MessageBus Connection with enhanced status -->
              <div class="space-y-2">
                <div class="text-xs font-medium text-muted-foreground">Crawler Connection</div>
                <div class="flex items-center gap-2">
                  {#if connectionStatus.status === 'connected'}
                    <Badge variant="default" class="text-xs">
                      <Database class="h-3 w-3 mr-1" />
                      Connected
                    </Badge>
                  {:else if connectionStatus.status === 'timeout'}
                    <Badge variant="secondary" class="text-xs">
                      <Clock class="h-3 w-3 mr-1" />
                      Timeout
                    </Badge>
                  {:else if connectionStatus.status === 'disconnected'}
                    <Badge variant="destructive" class="text-xs">
                      <XCircle class="h-3 w-3 mr-1" />
                      Disconnected
                    </Badge>
                  {:else}
                    <Badge variant="destructive" class="text-xs">
                      <CircleOff class="h-3 w-3 mr-1" />
                      Unavailable
                    </Badge>
                  {/if}
                </div>
              </div>
              
              <!-- Health Status -->
              <div class="space-y-2">
                <div class="text-xs font-medium text-muted-foreground">System Health</div>
                <div class="flex items-center gap-2">
                  <span class="text-xs text-muted-foreground">
                    <Tooltip.Provider delayDuration={300} disabled={!cache.lastHeartbeat}>
                      <Tooltip.Root>
                        <Tooltip.Trigger>
                          {#if cache.isHealthy}
                            <Badge variant="default" class="text-xs">
                              <CheckCircle2 class="h-3 w-3 mr-1" />
                              Healthy
                            </Badge>
                          {:else}
                            <Badge variant="destructive" class="text-xs">
                              <AlertCircle class="h-3 w-3 mr-1" />
                              Unhealthy
                            </Badge>
                          {/if}
                        </Tooltip.Trigger>
                        <Tooltip.Content>
                          {#if cache.lastHeartbeat}
                            <Time timestamp={cache.lastHeartbeat?.toISOString()} format="DD. MMM YYYY, HH:mm:ss" />
                          {/if}
                        </Tooltip.Content>
                      </Tooltip.Root>
                    </Tooltip.Provider>
                  </span>
                </div>
              </div>
            </div>
          </Card.Content>
        </Card.Root>
      </div>

      <!-- Job Failure Logs Section -->
      <Card.Root>
        <Card.Header>
          <div class="flex items-center justify-between">
            <div>
              <Card.Title class="flex items-center gap-2">
                <XCircle class="h-5 w-5 text-red-500" />
                Recent Job Failures
              </Card.Title>
              <Card.Description>Real-time logs from failed tasks</Card.Description>
            </div>
            {#if jobFailureLogs.length > 0}
              <Button
                size="sm"
                variant="outline"
                onclick={clearJobFailureLogsLocal}
              >
                Clear Logs
              </Button>
            {/if}
          </div>
        </Card.Header>
        <Card.Content>
          {#if jobFailureLogs.length > 0}
            <div class="max-h-64 overflow-y-auto space-y-2">
              {#each jobFailureLogs as log (log.timestamp)}
                <Alert.Root variant="destructive">
                  <Alert.Title class="text-sm font-medium">
                    {log.jobId} - {log.taskType}
                  </Alert.Title>
                  <Alert.Description class="text-xs space-y-1">
                    <div class="flex items-center gap-2">
                      <Time timestamp={log.timestamp} format="HH:mm:ss" />
                      <span>•</span>
                      <span class="font-mono">{log.error}</span>
                    </div>
                    {#if log.stackTrace}
                      <details class="mt-2">
                        <summary class="cursor-pointer text-xs opacity-75 hover:opacity-100">
                          View stack trace
                        </summary>
                        <pre class="mt-1 text-xs bg-muted/50 p-2 rounded overflow-x-auto whitespace-pre-wrap">{log.stackTrace}</pre>
                      </details>
                    {/if}
                    {#if log.context}
                      <details class="mt-1">
                        <summary class="cursor-pointer text-xs opacity-75 hover:opacity-100">
                          View context
                        </summary>
                        <pre class="mt-1 text-xs bg-muted/50 p-2 rounded overflow-x-auto">{JSON.stringify(log.context, null, 2)}</pre>
                      </details>
                    {/if}
                  </Alert.Description>
                </Alert.Root>
              {/each}
            </div>
          {:else}
            <div class="text-center py-8 text-muted-foreground">
              <XCircle class="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p class="text-sm">No job failures recorded</p>
              <p class="text-xs">Failed task logs will appear here in real-time</p>
            </div>
          {/if}
        </Card.Content>
      </Card.Root>
    {:else}
      <!-- Error State -->
      <Alert.Root variant="destructive">
        <CircleAlert class="h-4 w-4" />
        <Alert.Title>Error</Alert.Title>
        <Alert.Description>
          No crawler information available. Please check if the crawler service is running.
        </Alert.Description>
      </Alert.Root>
    {/if}
  {:catch error}
    <!-- Error State -->
    <Alert.Root variant="destructive">
      <CircleAlert class="h-4 w-4" />
      <Alert.Title>Error Loading Crawler Status</Alert.Title>
      <Alert.Description>
        Failed to load crawler status: {error?.message || "Unknown error"}
      </Alert.Description>
    </Alert.Root>
  {/await}
</div>