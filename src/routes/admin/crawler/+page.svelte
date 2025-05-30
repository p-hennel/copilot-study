<script lang="ts">
  import * as Card from "$lib/components/ui/card/index.js";
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
    Heart
  } from "lucide-svelte";
  import Time from "svelte-time/Time.svelte";
  import { invalidate } from "$app/navigation";
  import type { PageData } from "./$types";
  import { invalidateWithLoading } from "$lib/utils/admin-fetch";
  import { toast } from "svelte-sonner";
  import { onMount, onDestroy } from "svelte";

  let { data }: { data: PageData } = $props();

  // Component state
  let loading = $state(false);
  let wsConnected = $state(false);
  let wsReconnectAttempts = $state(0);
  let lastUpdate = $state<Date | null>(null);
  
  // Real-time crawler status (starts with initial data, gets updated via WebSocket)
  let crawlerStatus = $state<any>(null);
  
  // Job failure logs state
  let jobFailureLogs = $state<any[]>([]);
  const MAX_LOGS = 50; // Keep only the last 50 log entries
  
  // Real-time connection (WebSocket or EventSource)
  let ws: WebSocket | EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  
  // Initialize with loaded data
  onMount(async () => {
    try {
      const initialData = await data.crawler;
      crawlerStatus = initialData;
      lastUpdate = new Date();
    } catch (error) {
      console.error("Failed to load initial crawler data:", error);
    }
    
    // Connect to WebSocket for real-time updates
    connectWebSocket();
  });

  onDestroy(() => {
    disconnectWebSocket();
  });

  function connectWebSocket() {
    try {
      const sseUrl = `/api/admin/crawler/status`;
      
      // Use EventSource for Server-Sent Events
      const eventSource = new EventSource(sseUrl);
      
      eventSource.onopen = () => {
        wsConnected = true;
        wsReconnectAttempts = 0;
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
        wsConnected = false;
        eventSource.close();
        if (wsReconnectAttempts < 5) {
          scheduleReconnect();
        }
      };
      
      // Store reference for cleanup
      ws = eventSource as any; // Type compatibility
      
    } catch (error) {
      console.error("Failed to connect to crawler SSE:", error);
      wsConnected = false;
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    
    const delay = Math.min(1000 * Math.pow(2, wsReconnectAttempts), 30000);
    wsReconnectAttempts++;
    
    reconnectTimer = setTimeout(() => {
      console.log(`Attempting to reconnect to crawler WebSocket (attempt ${wsReconnectAttempts})...`);
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
    
    wsConnected = false;
  }

  function handleWebSocketMessage(message: any) {
    lastUpdate = new Date();
    
    switch (message.type) {
      case "statusUpdate":
        if (message.payload) {
          crawlerStatus = { ...crawlerStatus, ...message.payload };
          console.log("Received crawler status update:", message.payload);
        }
        break;
        
      case "jobUpdate":
        if (message.payload) {
          console.log("Received crawler job update:", message.payload);
          // Update specific job-related status
          if (crawlerStatus) {
            crawlerStatus = { ...crawlerStatus };
          }
        }
        break;
        
      case "jobFailure":
        if (message.payload) {
          console.log("DEBUG: Received job failure log:", message.payload);
          console.log("DEBUG: Current jobFailureLogs before update:", jobFailureLogs.length);
          // Add the log to the beginning of the array and trim to max size
          jobFailureLogs = [
            {
              ...message.payload,
              timestamp: message.timestamp || new Date().toISOString()
            },
            ...jobFailureLogs
          ].slice(0, MAX_LOGS);
          console.log("DEBUG: jobFailureLogs after update:", jobFailureLogs.length, jobFailureLogs);
        } else {
          console.log("DEBUG: Received jobFailure message with no payload:", message);
        }
        break;
        
      case "heartbeat":
        if (message.payload) {
          console.log("Received crawler heartbeat:", message.payload);
          if (crawlerStatus) {
            crawlerStatus = {
              ...crawlerStatus,
              lastHeartbeat: message.timestamp || new Date().toISOString()
            };
          }
        }
        break;
        
      default:
        console.log("Received unknown WebSocket message type:", message.type);
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
  function clearJobFailureLogs() {
    jobFailureLogs = [];
    toast.success("Job failure logs cleared");
  }

  // Test job failure logs
  async function testJobFailure() {
    loading = true;
    try {
      const response = await fetch("/api/admin/crawler/test-failure", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      
      if (response.ok) {
        const result = await response.json();
        toast.success("Test failure log sent");
        console.log("Test failure result:", result);
      } else {
        throw new Error("Failed to send test failure");
      }
    } catch (error) {
      console.error("Error sending test failure:", error);
      toast.error("Failed to send test failure");
    } finally {
      loading = false;
    }
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
        return "outline";
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
        return Clock;
    }
  }
</script>

<div class="space-y-6">
  <!-- Page Header -->
  <div class="flex items-center justify-between">
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold tracking-tight">Crawler Status</h1>
      <p class="text-sm text-muted-foreground">
        Real-time monitoring and control of the crawler system
      </p>
    </div>
    
    <!-- Connection Status -->
    <div class="flex items-center gap-2">
      {#if wsConnected}
        <div class="flex items-center gap-2 text-sm text-green-600">
          <Wifi class="h-4 w-4" />
          <span>Connected</span>
        </div>
      {:else}
        <div class="flex items-center gap-2 text-sm text-red-600">
          <WifiOff class="h-4 w-4" />
          <span>Disconnected</span>
          {#if wsReconnectAttempts > 0}
            <span class="text-xs">({wsReconnectAttempts} attempts)</span>
          {/if}
        </div>
      {/if}
      
      {#if lastUpdate}
        <div class="text-xs text-muted-foreground">
          Last update: <Time timestamp={lastUpdate.toISOString()} relative />
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
            {@const StatusIcon = getStatusIcon(crawlerStatus.state || "unknown")}
            <StatusIcon class="h-4 w-4 text-muted-foreground" />
          </Card.Header>
          <Card.Content>
            <div class="flex items-center gap-2">
              <Badge variant={getStatusBadgeVariant(crawlerStatus.state || "unknown")}>
                {crawlerStatus.state || "Unknown"}
              </Badge>
              {#if crawlerStatus.running}
                <Heart class="h-3 w-3 text-green-500 animate-pulse" />
              {/if}
            </div>
          </Card.Content>
        </Card.Root>

        <!-- Queue -->
        <Card.Root>
          <Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
            <Card.Title class="text-sm font-medium">Queued Jobs</Card.Title>
            <Clock class="h-4 w-4 text-muted-foreground" />
          </Card.Header>
          <Card.Content>
            <div class="text-2xl font-bold">{crawlerStatus.queued || 0}</div>
          </Card.Content>
        </Card.Root>

        <!-- Processing -->
        <Card.Root>
          <Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
            <Card.Title class="text-sm font-medium">Processing</Card.Title>
            <Loader2 class="h-4 w-4 text-muted-foreground {crawlerStatus.processing > 0 ? 'animate-spin' : ''}" />
          </Card.Header>
          <Card.Content>
            <div class="text-2xl font-bold">{crawlerStatus.processing || 0}</div>
          </Card.Content>
        </Card.Root>

        <!-- Completed -->
        <Card.Root>
          <Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
            <Card.Title class="text-sm font-medium">Completed</Card.Title>
            <CheckCircle class="h-4 w-4 text-muted-foreground" />
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
            {#if crawlerStatus.lastHeartbeat}
              <Card.Description>
                Last heartbeat: <Time timestamp={crawlerStatus.lastHeartbeat} format="DD. MMM YYYY, HH:mm:ss" />
                (<Time timestamp={crawlerStatus.lastHeartbeat} relative />)
              </Card.Description>
            {/if}
          </Card.Header>
          <Card.Content class="space-y-4">
            {#if 'error' in crawlerStatus && crawlerStatus.error}
              <Alert.Root variant="destructive">
                <CircleAlert class="h-4 w-4" />
                <Alert.Title>Error</Alert.Title>
                <Alert.Description>{crawlerStatus.error}</Alert.Description>
              </Alert.Root>
            {/if}

            <div class="grid grid-cols-2 gap-4">
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
            <Card.Description>
              Manage crawler operations and view real-time updates
            </Card.Description>
          </Card.Header>
          <Card.Content class="space-y-4">
            <!-- Control Buttons -->
            <div class="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={loading}
                onclick={refreshCrawlerStatus}
              >
                <RefreshCw class="h-4 w-4 mr-2 {loading ? 'animate-spin' : ''}" />
                Refresh
              </Button>

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
              
              <Button
                size="sm"
                variant="destructive"
                disabled={loading}
                onclick={testJobFailure}
              >
                <XCircle class="h-4 w-4 mr-2" />
                Test Failure
              </Button>
            </div>

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
            <div class="space-y-2">
              <div class="text-sm font-medium">Real-time Connection</div>
              <div class="flex items-center gap-2">
                {#if wsConnected}
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
                
                <Button
                  size="sm"
                  variant="ghost"
                  class="h-6 px-2 text-xs"
                  onclick={connectWebSocket}
                  disabled={wsConnected}
                >
                  Reconnect
                </Button>
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
                onclick={clearJobFailureLogs}
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