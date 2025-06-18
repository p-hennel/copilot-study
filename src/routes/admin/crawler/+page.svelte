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
    TrendingUp,
    GitBranch,
    GitCommit,
    Users2,
    Tags,
    GitMerge,
    FolderTree,

    ChevronsLeftRightEllipsisIcon,

    CircleOff


  } from "lucide-svelte";
  import { extractProgressData, calculateProgressPercentage, getProgressSummary, type CrawlerProgressData } from "$lib/types/progress";
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
  // svelte-ignore state_referenced_locally
    let crawlerStatus = $state<any>(cache.status);
  
  // Job failure logs state (from cache)
  // svelte-ignore state_referenced_locally
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
      disconnectWebSocket();

      // Clean up cache validation interval
      if (cacheValidationInterval) {
        clearInterval(cacheValidationInterval);
        cacheValidationInterval = null;
      }
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
            
            // If this is a progress update, include detailed item counts
            if (message.payload.action === 'progress' && message.payload.progress) {
              const progress = message.payload.progress;
              // Update crawler status with enhanced progress data
              crawlerStatus.currentProgress = {
                stage: progress.stage,
                processed: progress.total_processed || progress.processed || 0,
                total: progress.total_discovered || progress.total,
                message: progress.message,
                itemCounts: progress.itemCounts || progress.item_counts || {},
                processingRate: progress.processingRate || progress.processing_rate,
                estimatedTimeRemaining: progress.estimatedTimeRemaining || progress.estimated_time_remaining
              };
            }
            
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
                              <Time timestamp={cache.lastHeartbeat} relative />
                            </Tooltip.Trigger>
                            <Tooltip.Content>
                              <Time timestamp={cache.lastHeartbeat} format="DD. MMM YYYY, HH:mm:ss" /> (cached)
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

            {#if crawlerStatus.processing > 0}
              <Separator />
              <div>
                <div class="text-sm font-medium text-muted-foreground">Active Jobs</div>
                <div class="text-sm font-mono bg-muted rounded p-2">
                  {crawlerStatus.processing} job{crawlerStatus.processing !== 1 ? 's' : ''} currently processing
                </div>
              </div>
            {/if}
          </Card.Content>
        </Card.Root>

        <!-- Controls Card -->
        <Card.Root>
          <Card.Header>
            <Card.Title>Crawler Progress</Card.Title>
            <!--
            <Card.Description class="flex flex-row flex-wrap items-end">
              <div >
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
            -->
          </Card.Header>
          <Card.Content class="flex flex-col gap-2">
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

            <!-- Enhanced Progress visualization -->
            {#if crawlerStatus.completed || crawlerStatus.failed || crawlerStatus.processing || crawlerStatus.queued}
              <div class="flex flex-col gap-2">
                {#each [crawlerStatus] as status}
                  {@const total = (status.completed || 0) + (status.failed || 0) + (status.processing || 0) + (status.queued || 0)}
                  {#if total > 0}
                    {@const completedPercent = ((status.completed || 0) / total) * 100}
                    {@const processingPercent = ((status.processing || 0) / total) * 100}
                    {@const failedPercent = ((status.failed || 0) / total) * 100}

                    <!-- Summary -->
                    <div class="flex justify-between text-xs text-muted-foreground">
                      <span>Total: {total} jobs</span>
                      <span>Processing: {Math.round(processingPercent)}%</span>
                      <span>Failed: {Math.round(failedPercent)}%</span>
                      <span>Completion: {Math.round(completedPercent)}%</span>
                    </div>
                    
                    <!-- Main progress bar -->
                    <Progress value={completedPercent} class="h-2" />
                    
                    <!-- Detailed breakdown -->
                    <div class="grid grid-cols-2 gap-2 text-xs">
                      <div class="flex items-center justify-between">
                        <div class="flex items-center gap-1">
                          <CheckCircle class="h-3 w-3 text-green-600" />
                          <span>Completed</span>
                        </div>
                        <span class="font-semibold">{status.completed || 0}</span>
                      </div>
                      <div class="flex items-center justify-between">
                        <div class="flex items-center gap-1">
                          <Loader2 class="h-3 w-3 text-blue-600" />
                          <span>Processing</span>
                        </div>
                        <span class="font-semibold">{status.processing || 0}</span>
                      </div>
                      <div class="flex items-center justify-between">
                        <div class="flex items-center gap-1">
                          <Clock class="h-3 w-3 text-yellow-600" />
                          <span>Queued</span>
                        </div>
                        <span class="font-semibold">{status.queued || 0}</span>
                      </div>
                      <div class="flex items-center justify-between">
                        <div class="flex items-center gap-1">
                          <XCircle class="h-3 w-3 text-red-600" />
                          <span>Failed</span>
                        </div>
                        <span class="font-semibold">{status.failed || 0}</span>
                      </div>
                    </div>
                  {:else}
                    <div class="text-sm text-muted-foreground">No jobs in queue</div>
                  {/if}
                {/each}
              </div>
            {/if}

            <!-- Connection Status -->
            <Separator />
            <div class="flex flex-row flex-wrap justify-between gap-2">
              
              <!-- SSE Connection -->
              <div class="flex flex-col gap-1 place-items-center">
                <div class="text-xs font-medium text-muted-foreground">API</div>
                <div class="flex items-center gap-1">
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
              <div class="flex flex-col gap-1 place-items-center">
                <div class="text-xs font-medium text-muted-foreground">Crawler</div>
                <div class="flex items-center gap-1">
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
              <div class="flex flex-col gap-1 place-items-center">
                <div class="text-xs font-medium text-muted-foreground">System</div>
                <div class="flex items-center gap-1">
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

      <!-- Enhanced Job Progress Section -->
      {#if crawlerStatus && (crawlerStatus.processing > 0 || crawlerStatus.queued > 0)}
        <div class="grid gap-6 md:grid-cols-2">
          <!-- Active Job Progress Details -->
          <Card.Root>
            <Card.Header>
              <Card.Title class="flex items-center gap-2">
                <TrendingUp class="h-5 w-5" />
                Active Job Progress
              </Card.Title>
              <Card.Description>
                Real-time progress tracking for currently processing jobs
              </Card.Description>
            </Card.Header>
            <Card.Content class="space-y-4">
              <!-- Progress Overview -->
              {#if crawlerStatus.processing > 0}
                <div class="space-y-3">
                  <div class="flex items-center justify-between">
                    <span class="text-sm font-medium">Processing Jobs</span>
                    <Badge variant="default" class="text-xs">
                      {crawlerStatus.processing} active
                    </Badge>
                  </div>
                  
                  <!-- Real progress data calculated from job status -->
                  <div class="space-y-2">
                    {#if crawlerStatus.processing > 0}
                      {@const total = (crawlerStatus.completed || 0) + (crawlerStatus.failed || 0) + (crawlerStatus.processing || 0) + (crawlerStatus.queued || 0)}
                      {@const completedPercent = total > 0 ? ((crawlerStatus.completed || 0) / total) * 100 : 0}
                      
                      <div class="flex justify-between text-sm">
                        <span>Overall Progress</span>
                        <span class="text-muted-foreground">
                          {crawlerStatus.processing} job{crawlerStatus.processing !== 1 ? 's' : ''} processing
                        </span>
                      </div>
                      
                      <Progress value={completedPercent} class="h-2" />
                      <div class="text-xs text-muted-foreground">
                        {crawlerStatus.completed || 0} of {total} jobs completed ({Math.round(completedPercent)}%)
                      </div>

                      <!-- Enhanced progress data -->
                      {#if crawlerStatus.currentProgress}
                        <Separator />
                        <div class="space-y-2">
                          <div class="text-sm font-medium">Current Job Details</div>
                          <div class="text-xs space-y-1">
                            <div>Stage: <span class="font-mono">{crawlerStatus.currentProgress.stage}</span></div>
                            <div>Processed: <span class="font-mono">{crawlerStatus.currentProgress.processed.toLocaleString()}</span></div>
                            {#if crawlerStatus.currentProgress.total}
                              <div>Total: <span class="font-mono">{crawlerStatus.currentProgress.total.toLocaleString()}</span></div>
                            {/if}
                            {#if crawlerStatus.currentProgress.message}
                              <div>Status: <span class="font-mono text-muted-foreground">{crawlerStatus.currentProgress.message}</span></div>
                            {/if}
                            
                            <!-- Item counts breakdown -->
                            {#if crawlerStatus.currentProgress.itemCounts && Object.keys(crawlerStatus.currentProgress.itemCounts).length > 0}
                              <div class="pt-1 border-t">
                                <div class="text-xs font-medium mb-1">Item Breakdown:</div>
                                <div class="grid grid-cols-2 gap-1 text-xs">
                                  {#each Object.entries(crawlerStatus.currentProgress.itemCounts) as [type, count]}
                                    <div class="flex justify-between">
                                      <span class="capitalize">{type}:</span>
                                      <span class="font-mono">{count.toLocaleString()}</span>
                                    </div>
                                  {/each}
                                </div>
                              </div>
                            {/if}
                            
                            <!-- Performance metrics -->
                            {#if crawlerStatus.currentProgress.processingRate}
                              <div class="pt-1 border-t text-xs">
                                Rate: <span class="font-mono">{crawlerStatus.currentProgress.processingRate.toFixed(1)} items/sec</span>
                              </div>
                            {/if}
                            {#if crawlerStatus.currentProgress.estimatedTimeRemaining}
                              <div class="text-xs">
                                ETA: <span class="font-mono">{Math.round(crawlerStatus.currentProgress.estimatedTimeRemaining / 60)} min</span>
                              </div>
                            {/if}
                          </div>
                        </div>
                      {/if}
                    {:else if crawlerStatus.queued > 0}
                      <div class="flex justify-between text-sm">
                        <span>Overall Progress</span>
                        <span class="text-muted-foreground">Jobs queued</span>
                      </div>
                      <Progress value={0} class="h-2" />
                      <div class="text-xs text-muted-foreground">
                        {crawlerStatus.queued} job{crawlerStatus.queued !== 1 ? 's' : ''} waiting to start
                      </div>
                    {:else}
                      <div class="flex justify-between text-sm">
                        <span>Overall Progress</span>
                        <span class="text-muted-foreground">No active jobs</span>
                      </div>
                      <Progress value={0} class="h-2" />
                      <div class="text-xs text-muted-foreground">
                        No jobs currently running or queued
                      </div>
                    {/if}
                  </div>
                </div>
              {/if}

              <!-- Queue Information -->
              {#if crawlerStatus.queued > 0}
                <Separator />
                <div class="space-y-2">
                  <div class="flex items-center justify-between">
                    <span class="text-sm font-medium">Queued Jobs</span>
                    <Badge variant="secondary" class="text-xs">
                      {crawlerStatus.queued} waiting
                    </Badge>
                  </div>
                  <div class="text-xs text-muted-foreground">
                    Jobs ready to be processed when resources become available
                  </div>
                </div>
              {/if}

              <!-- Current System Status -->
              {#if crawlerStatus.processing > 0}
                <Separator />
                <div class="space-y-2">
                  <span class="text-sm font-medium">System Status</span>
                  <div class="flex items-center gap-2 p-2 rounded border">
                    <Activity class="h-4 w-4 text-blue-600" />
                    <div class="text-xs">
                      <div class="font-medium">Active Processing</div>
                      <div class="text-muted-foreground">
                        {crawlerStatus.processing} job{crawlerStatus.processing !== 1 ? 's' : ''} running
                      </div>
                    </div>
                  </div>
                </div>
              {:else if crawlerStatus.paused}
                <Separator />
                <div class="space-y-2">
                  <span class="text-sm font-medium">System Status</span>
                  <div class="flex items-center gap-2 p-2 rounded border">
                    <Pause class="h-4 w-4 text-yellow-600" />
                    <div class="text-xs">
                      <div class="font-medium">System Paused</div>
                      <div class="text-muted-foreground">Crawler is currently paused</div>
                    </div>
                  </div>
                </div>
              {/if}
            </Card.Content>
          </Card.Root>

          <!-- System Statistics -->
          <Card.Root>
            <Card.Header>
              <Card.Title class="flex items-center gap-2">
                <TrendingUp class="h-5 w-5" />
                System Statistics
              </Card.Title>
              <Card.Description>
                Current job distribution and system performance
              </Card.Description>
            </Card.Header>
            <Card.Content class="space-y-4">
              <!-- Job Status Distribution -->
              <div class="space-y-3">
                <div class="text-sm font-medium">Job Status Distribution</div>
                
                <div class="grid grid-cols-2 gap-3">
                  <div class="flex items-center justify-between p-2 bg-green-50 rounded">
                    <div class="flex items-center gap-2">
                      <CheckCircle class="h-4 w-4 text-green-600" />
                      <span class="text-sm">Completed</span>
                    </div>
                    <div class="text-sm font-semibold">{(crawlerStatus.completed || 0).toLocaleString()}</div>
                  </div>
                  
                  <div class="flex items-center justify-between p-2 bg-blue-50 rounded">
                    <div class="flex items-center gap-2">
                      <Loader2 class="h-4 w-4 text-blue-600" />
                      <span class="text-sm">Processing</span>
                    </div>
                    <div class="text-sm font-semibold">{(crawlerStatus.processing || 0).toLocaleString()}</div>
                  </div>
                  
                  <div class="flex items-center justify-between p-2 bg-yellow-50 rounded">
                    <div class="flex items-center gap-2">
                      <Clock class="h-4 w-4 text-yellow-600" />
                      <span class="text-sm">Queued</span>
                    </div>
                    <div class="text-sm font-semibold">{(crawlerStatus.queued || 0).toLocaleString()}</div>
                  </div>
                  
                  <div class="flex items-center justify-between p-2 bg-red-50 rounded">
                    <div class="flex items-center gap-2">
                      <XCircle class="h-4 w-4 text-red-600" />
                      <span class="text-sm">Failed</span>
                    </div>
                    <div class="text-sm font-semibold">{(crawlerStatus.failed || 0).toLocaleString()}</div>
                  </div>
                </div>
              </div>

              <!-- System Performance Metrics -->
              {#if crawlerStatus.processing > 0}
                <Separator />
                <div class="space-y-2">
                  <div class="text-sm font-medium">System Performance</div>
                  <div class="flex items-center justify-between">
                    <span class="text-sm">Active Jobs</span>
                    <div class="text-right">
                      <div class="text-sm font-semibold">{crawlerStatus.processing}</div>
                      <div class="text-xs text-muted-foreground">currently running</div>
                    </div>
                  </div>
                  
                  {#if crawlerStatus.lastHeartbeat}
                    <div class="flex items-center justify-between">
                      <span class="text-sm">Last Heartbeat</span>
                      <div class="text-right">
                        <div class="text-xs text-muted-foreground">
                          <Time timestamp={new Date(crawlerStatus.lastHeartbeat).toISOString()} relative />
                        </div>
                      </div>
                    </div>
                  {/if}
                </div>
              {:else}
                <div class="text-center py-4 text-muted-foreground">
                  <TrendingUp class="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p class="text-sm">No active processing to display metrics</p>
                </div>
              {/if}
            </Card.Content>
          </Card.Root>
        </div>
      {/if}


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
            <div class="max-h-96 overflow-y-auto space-y-3">
              {#each jobFailureLogs as log (log.timestamp)}
                <Alert.Root variant="destructive" class="border-l-4 border-l-red-500">
                  <CircleAlert class="h-4 w-4" />
                  <Alert.Title class="text-sm font-medium flex items-center justify-between">
                    <span>{log.jobId} - {log.taskType}</span>
                    <div class="flex items-center gap-2">
                      {#if log.isRecoverable}
                        <Badge variant="secondary" class="text-xs">
                          <RefreshCw class="h-3 w-3 mr-1" />
                          Recoverable
                        </Badge>
                      {:else}
                        <Badge variant="destructive" class="text-xs">
                          <XCircle class="h-3 w-3 mr-1" />
                          Fatal
                        </Badge>
                      {/if}
                      <Time timestamp={log.timestamp} format="HH:mm:ss" class="text-xs text-muted-foreground" />
                    </div>
                  </Alert.Title>
                  <Alert.Description class="text-xs space-y-2">
                    <!-- Main Error Message -->
                    <div class="flex items-start gap-2 p-2 bg-red-50/50 rounded">
                      <AlertCircle class="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                      <div class="flex-1">
                        <div class="font-medium text-red-800 mb-1">Error Message:</div>
                        <div class="font-mono text-sm text-red-700 break-words">{log.error}</div>
                      </div>
                    </div>

                    <!-- Enhanced Context Information -->
                    {#if log.context && Object.keys(log.context).length > 0}
                      <div class="space-y-2">
                        <!-- Quick Context Summary -->
                        <div class="grid grid-cols-2 gap-2 text-xs">
                          {#if log.context.retryCount !== undefined}
                            <div class="flex justify-between p-1 bg-muted/30 rounded">
                              <span>Retry Count:</span>
                              <span class="font-mono">{log.context.retryCount}</span>
                            </div>
                          {/if}
                          {#if log.context.partialCounts}
                            <div class="flex justify-between p-1 bg-muted/30 rounded">
                              <span>Partial Progress:</span>
                              <span class="font-mono">{Object.values(log.context.partialCounts).reduce((a, b) => a + b, 0)} items</span>
                            </div>
                          {/if}
                        </div>

                        <!-- Request Details if available -->
                        {#if log.context.requestDetails}
                          <div class="p-2 bg-muted/20 rounded border">
                            <div class="font-medium mb-1">Request Details:</div>
                            <div class="grid grid-cols-2 gap-1 text-xs">
                              {#if log.context.requestDetails.method}
                                <div><span class="text-muted-foreground">Method:</span> <span class="font-mono">{log.context.requestDetails.method}</span></div>
                              {/if}
                              {#if log.context.requestDetails.url}
                                <div><span class="text-muted-foreground">URL:</span> <span class="font-mono text-xs break-all">{log.context.requestDetails.url}</span></div>
                              {/if}
                              {#if log.context.requestDetails.status_code}
                                <div><span class="text-muted-foreground">Status:</span> <span class="font-mono">{log.context.requestDetails.status_code}</span></div>
                              {/if}
                            </div>
                          </div>
                        {/if}

                        <!-- Detailed Context (Expandable) -->
                        <details class="mt-2">
                          <summary class="cursor-pointer text-xs opacity-75 hover:opacity-100 flex items-center gap-1">
                            <ChevronsLeftRightEllipsisIcon class="h-3 w-3" />
                            View full context details
                          </summary>
                          <pre class="mt-2 text-xs bg-muted/50 p-3 rounded overflow-x-auto border">{JSON.stringify(log.context, null, 2)}</pre>
                        </details>
                      </div>
                    {/if}

                    <!-- Stack Trace (Properly displayed when available) -->
                    {#if log.stackTrace && log.stackTrace !== log.taskType}
                      <details class="mt-2">
                        <summary class="cursor-pointer text-xs opacity-75 hover:opacity-100 flex items-center gap-1">
                          <Database class="h-3 w-3" />
                          View stack trace
                        </summary>
                        <div class="mt-2 p-3 bg-gray-900 text-green-400 rounded overflow-x-auto">
                          <pre class="text-xs font-mono whitespace-pre-wrap">{log.stackTrace}</pre>
                        </div>
                      </details>
                    {/if}

                    <!-- Resume State if available -->
                    {#if log.context?.resumeState}
                      <details class="mt-1">
                        <summary class="cursor-pointer text-xs opacity-75 hover:opacity-100 flex items-center gap-1">
                          <Play class="h-3 w-3" />
                          View resume state
                        </summary>
                        <pre class="mt-2 text-xs bg-blue-50/50 p-3 rounded overflow-x-auto border">{JSON.stringify(log.context.resumeState, null, 2)}</pre>
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