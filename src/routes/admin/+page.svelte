<script lang="ts">
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Progress } from "$lib/components/ui/progress/index.js";
  import type { ComponentProps } from "svelte";
  import Time from "svelte-time/Time.svelte";
  import Input from "@/input/input.svelte";
  import { m } from "$paraglide";
  import { Users, Key, MapPin, Briefcase, Settings, CircleAlert, RefreshCw, ClipboardCopy, DatabaseBackup, FileDown, ArchiveRestore, FolderTree, Activity, CheckCircle, Clock, XCircle, Search, Play, Pause, Square, Loader2, Heart, WifiOff, Wifi, TrendingUp, Database, GitBranch, GitCommit, Users2, Tags, GitMerge } from "lucide-svelte";
  import { goto, invalidate } from "$app/navigation";
  import type { PageProps } from "./$types";
  import { clickToCopy, dynamicHandleDownloadAsCSV, formatBytes } from "$lib/utils";
  import { toast } from "svelte-sonner";
  import LoadingButton from "$lib/components/LoadingButton.svelte";
  import { authClient } from "$lib/auth-client"
  import AdminDataLoader from "$lib/components/admin/AdminDataLoader.svelte";
  import { invalidateWithLoading } from "$lib/utils/admin-fetch";
  import { HardDrive } from "@lucide/svelte";
  import { Chart, Arc, Group, LinearGradient, Svg, Text, RadialGradient } from "layerchart"
  import { extractProgressData, calculateProgressPercentage, getProgressSummary, type CrawlerProgressData } from "$lib/types/progress";
  
  let { data }: PageProps = $props();

  let loading = $state(true);
  data.crawler.then(() => {
    loading = false;
  });

  function afterCommand() {
    loading = false;
    invalidate("/api/admin/crawler");
  }

  // Enhanced refresh function
  async function refreshCrawlerStatus() {
    await invalidateWithLoading(
      () => invalidate("/api/admin/crawler"),
      'Refreshing crawler status...'
    );
  }

  // Hash generator state
  let toBeHashed = $state(data.user?.email ?? "");
  let hashedValue = $state("");

  async function hashValue() {
    try {
      const response = await fetch("/api/admin/hash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: toBeHashed })
      });
      const result: any = await response.json();
      if (result.error || !result.success) {
        toast.error("Error hashing value", { description: result.error });
        hashedValue = result.error;
      } else {
        hashedValue = result.hashedValue;
      }
    } catch (error) {
      toast.error("Failed to hash value", {
        description: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }

  // Account management functions
  async function backupAccounts() {
    const token = (await authClient.getSession())?.data?.session.token;
    if (!token) return goto("/admin/sign-in");
    await fetch("/api/admin/backup", {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    toast.success("Backup initiated", { description: "Backup email will be sent" });
  }

  async function copyAccountIds() {
    const users = await data.users;
    if (Array.isArray(users)) {
      const idsText = users.map((x: any) => x.email).join("\n");
      navigator.clipboard.writeText(idsText);
      toast.success("Account IDs copied", { description: "Email addresses copied to clipboard" });
    }
  }

  async function exportAccountsCSV() {
    const users = await data.users;
    if (Array.isArray(users)) {
      dynamicHandleDownloadAsCSV(() =>
        users.map((x: any) => ({
          email: x.email,
          accounts: x.accounts.map((acc: any) => acc.providerId).join(",")
        }))
      )();
      toast.success("CSV export started", { description: "Download should begin shortly" });
    }
  }

  // Summary stats derived from data
  const summaryStats = $derived.by(async () => {
    const [users, statistics, tokenInfos, crawler, storage, jobs] = await Promise.all([
      data.users,
      data.statistics,
      data.tokenInfos,
      data.crawler,
      data.storage,
      data.jobs
    ]);

    // Extract progress information from active jobs
    let jobsWithProgress: any[] = [];
    let totalProgressInfo: CrawlerProgressData = {};
    
    if (jobs && typeof jobs === 'object' && 'data' in jobs && Array.isArray(jobs.data)) {
      jobsWithProgress = jobs.data.filter((job: any) =>
        job.status === 'running' || job.status === 'active' || job.status === 'paused'
      ).map((job: any) => ({
        ...job,
        progressData: extractProgressData(job.progress)
      }));

      // Aggregate progress from all active jobs
      jobsWithProgress.forEach((job: any) => {
        const progress = job.progressData;
        if (progress.processedItems) {
          totalProgressInfo.processedItems = (totalProgressInfo.processedItems || 0) + progress.processedItems;
        }
        if (progress.totalItems) {
          totalProgressInfo.totalItems = (totalProgressInfo.totalItems || 0) + progress.totalItems;
        }
        if (progress.itemsByType) {
          totalProgressInfo.itemsByType = totalProgressInfo.itemsByType || {};
          Object.entries(progress.itemsByType).forEach(([type, count]) => {
            if (typeof count === 'number') {
              totalProgressInfo.itemsByType![type] = (totalProgressInfo.itemsByType![type] || 0) + count;
            }
          });
        }
      });
    }

    return {
      users: Array.isArray(users) ? users.length : 0,
      tokens: (tokenInfos && typeof tokenInfos === 'object' && 'result' in tokenInfos && tokenInfos.result)
        ? Object.keys(tokenInfos.result).length : 0,
      areas: (statistics && typeof statistics === 'object' && 'areas' in statistics && statistics.areas)
        ? statistics.areas : { total: 0, groups: 0, projects: 0 },
      jobs: (statistics && typeof statistics === 'object' && 'jobs' in statistics && statistics.jobs)
        ? statistics.jobs : {
            total: 0, completed: 0, active: 0, running: 0, paused: 0,
            queued: 0, failed: 0, groupProjectDiscovery: 0
          },
      crawler: crawler || null,
      storage: (storage && typeof storage === 'object' && 'used' in storage && 'available' in storage && 'total' in storage)
        ? storage : { used: 0, available: 0, total: 0 },
      // Enhanced progress information
      activeJobs: jobsWithProgress,
      totalProgress: totalProgressInfo,
      progressPercentage: calculateProgressPercentage(totalProgressInfo),
      progressSummary: getProgressSummary(totalProgressInfo)
    };
  });

  const quickActions = [
    { label: "Manage Tokens", href: "/admin/tokens", icon: Key, description: "View and manage API tokens" },
    { label: "User Accounts", href: "/admin/accounts", icon: Users, description: "Manage user accounts and permissions" },
    { label: "Survey Areas", href: "/admin/areas", icon: MapPin, description: "Configure survey areas and regions" },
    { label: "Job Management", href: "/admin/jobs", icon: Briefcase, description: "Monitor and manage jobs" },
    { label: "System Settings", href: "/admin/settings", icon: Settings, description: "Configure application settings" }
  ];
</script>

<div class="space-y-8">
  <!-- Page Header -->
  <div>
    <h1 class="text-4xl font-extrabold">{m["admin.dashboard.title"]()}</h1>
    <p class="text-muted-foreground mt-2">Overview of your admin dashboard</p>
  </div>

  <!-- Summary Cards with Loading -->
  <AdminDataLoader
    data={summaryStats}
    loadingType="stats"
    operationId="dashboard-stats"
    errorMessage="Failed to load dashboard statistics"
  >
    {#snippet children({ data: stats }: { data: any })}
      <!-- Row 1: Core Metrics -->
      <div class="flex flex-row flex-wrap gap-4 justify-center">
        <Card.Root class="min-w-3xs max-w-3xs flex-1">
          <Card.Header class="flex flex-row items-center justify-between space-y-0 pb-0">
            <Card.Title class="font-medium">Users & Tokens</Card.Title>
            <Users class="h-5 w-5 text-muted-foreground" />
          </Card.Header>
          <Card.Content class="space-y-2 pt-2 flex flex-row gap-4 justify-between">
            <div class="flex flex-col items-center">
              <div class="text-2xl font-bold">{stats.users}</div>
              <p class="text-xs text-muted-foreground">Accounts</p>
            </div>
            <Separator orientation="vertical" class="" />
            <div class="flex flex-col items-center">
              <div class="text-2xl font-semibold">{stats.tokens}</div>
              <span class="text-xs text-muted-foreground">Tokens</span>
            </div>
          </Card.Content>
        </Card.Root>

        <Card.Root class="min-w-3xs max-w-sm flex-1">
          <Card.Header class="flex flex-row items-center justify-between space-y-0 pb-0">
            <Card.Title class="font-medium">Discovered Areas</Card.Title>
            <FolderTree class="h-5 w-5 text-muted-foreground" />
          </Card.Header>
          <Card.Content class="space-y-2 pt-2 flex flex-row gap-4 justify-between">
            <div class="flex flex-col items-center">
              <div class="text-2xl font-bold">{stats.areas.total}</div>
              <p class="text-sm text-muted-foreground">Total</p>
            </div>
            <Separator orientation="vertical" class="" />
            <div class="flex flex-col items-center">
              <div class="text-lg font-semibold text-blue-600">{stats.areas.groups}</div>
              <p class="text-sm text-muted-foreground">Groups</p>
            </div>
            <Separator orientation="vertical" class="" />
            <div class="flex flex-col items-center">
              <div class="text-lg font-semibold text-green-600">{stats.areas.projects}</div>
              <p class="text-sm text-muted-foreground">Projects</p>
            </div>
          </Card.Content>
        </Card.Root>

        <Card.Root class="min-w-3xs max-w-md flex-1">
          <Card.Header class="flex flex-row items-center justify-between space-y-0 pb-0">
            <Card.Title class="font-medium">Jobs Overview</Card.Title>
            <Activity class="h-5 w-5 text-muted-foreground" />
          </Card.Header>
          <Card.Content class="space-y-3 pt-2">
            <!-- Job Status Counts -->
            <div class="flex flex-row gap-4 justify-between">
              <div class="flex flex-col items-center">
                <div class="text-2xl font-bold">{stats.jobs.total}</div>
                <p class="text-sm text-muted-foreground">Total</p>
              </div>
              <Separator orientation="vertical" class="" />
              <div class="flex flex-col items-center">
                <div class="text-lg font-semibold text-blue-600">{stats.jobs.active}</div>
                <p class="text-sm text-muted-foreground">Active</p>
              </div>
              <Separator orientation="vertical" class="" />
              <div class="flex flex-col items-center">
                <div class="text-lg font-semibold text-green-600">{stats.jobs.running}</div>
                <p class="text-sm text-muted-foreground">Running</p>
              </div>
              <Separator orientation="vertical" class="" />
              <div class="flex flex-col items-center">
                <div class="text-lg font-semibold text-yellow-600">{stats.jobs.paused}</div>
                <p class="text-sm text-muted-foreground">Paused</p>
              </div>
            </div>
            
            <!-- Active Jobs Progress -->
            {#if stats.activeJobs.length > 0}
              <Separator />
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-xs font-medium text-muted-foreground">Active Progress</span>
                  {#if stats.progressPercentage !== null}
                    <span class="text-xs font-semibold">{stats.progressPercentage}%</span>
                  {/if}
                </div>
                {#if stats.progressPercentage !== null}
                  <Progress value={stats.progressPercentage} class="h-1.5" />
                  <div class="text-xs text-muted-foreground">
                    {stats.totalProgress.processedItems || 0}/{stats.totalProgress.totalItems || 0} items
                  </div>
                {:else if stats.totalProgress.processedItems}
                  <div class="text-xs text-muted-foreground">
                    {stats.totalProgress.processedItems} items processed
                  </div>
                {/if}
              </div>
            {/if}
          </Card.Content>
        </Card.Root>

        <Card.Root class="min-w-3xs max-w-3xs flex-1">
          <Card.Header class="flex flex-row items-center justify-between space-y-0 pb-0">
            <Card.Title class="font-medium">Discovery Jobs</Card.Title>
            <Search class="h-5 w-5 text-muted-foreground" />
          </Card.Header>
          <Card.Content class="space-y-2 pt-2 flex flex-row gap-4 justify-between">
            <div class="flex flex-col items-center">
              <div class="text-2xl font-bold">{stats.jobs.groupProjectDiscovery}</div>
              <p class="text-sm text-muted-foreground">Discovery</p>
            </div>
            <Separator orientation="vertical" class="" />
            <div class="flex flex-col items-center">
              <div class="text-2xl font-semibold text-blue-600">{ stats.jobs.total > 0 ? Math.round((stats.jobs.groupProjectDiscovery / stats.jobs.total) * 100) : "--" }%</div>
              <p class="text-sm text-muted-foreground">of all</p>
            </div>
          </Card.Content>
        </Card.Root>

        <Card.Root class="min-w-xs max-w-sm flex-1">
          <Card.Header class="flex flex-row items-center justify-between space-y-0 pb-0">
            <Card.Title class="font-medium">Job Status</Card.Title>
            <Briefcase class="h-5 w-5 text-muted-foreground" />
          </Card.Header>
          <Card.Content class="flex flex-col gap-1">
            <div class="flex flex-col gap-1">
              <div class="flex items-center justify-between">
                <div class="flex items-center space-x-2">
                  <CheckCircle class="h-4 w-4 text-green-600" />
                  <span class="text-sm">Completed</span>
                </div>
                <span class="font-semibold text-green-600">{stats.jobs.completed}</span>
              </div>
              <div class="flex items-center justify-between">
                <div class="flex items-center space-x-2">
                  <Clock class="h-4 w-4 text-yellow-600" />
                  <span class="text-sm">Open</span>
                </div>
                <span class="font-semibold text-yellow-600">{stats.jobs.queued}</span>
              </div>
              <div class="flex items-center justify-between">
                <div class="flex items-center space-x-2">
                  <XCircle class="h-4 w-4 text-red-600" />
                  <span class="text-sm">Failed</span>
                </div>
                <span class="font-semibold text-red-600">{stats.jobs.failed}</span>
              </div>
            </div>
            {#if stats.jobs.total > 0}
              <Separator class="my-2" />
              <div>
                <Progress value={(stats.jobs.completed / stats.jobs.total) * 100} class="h-2" />
                <div class="text-xs text-muted-foreground mt-1 flex flex-row flex-wrap justify-between">
                  <span>Completion Rate</span>
                  <span>{Math.round((stats.jobs.completed / stats.jobs.total) * 100)}%</span>
                </div>
              </div>
            {/if}
          </Card.Content>
        </Card.Root>

        <Card.Root class="min-w-3xs max-w-lg flex-1">
          <Card.Header class="flex flex-row items-center justify-between space-y-0 pb-0">
            <Card.Title class="font-medium">Crawler Status</Card.Title>
            {#if stats.crawler?.state === 'running'}
              <Play class="h-5 w-5 text-green-600" />
            {:else if stats.crawler?.state === 'paused'}
              <Pause class="h-5 w-5 text-yellow-600" />
            {:else if stats.crawler?.state === 'stopped'}
              <Square class="h-5 w-5 text-red-600" />
            {:else}
              <WifiOff class="h-5 w-5 text-muted-foreground" />
            {/if}
          </Card.Header>
          <Card.Content class="flex flex-col gap-4">
            <div class="flex flex-row gap-4 justify-between">
              <div class="flex flex-1 flex-col items-center">
                <div class="text-2xl font-bold">
                  {#if stats.crawler?.state}
                    <Badge variant={stats.crawler.state === 'running' ? 'default' : stats.crawler.state === 'paused' ? 'secondary' : 'destructive'} class="text-sm">
                      {stats.crawler.state}
                    </Badge>
                  {:else}
                    <Badge variant="destructive" class="text-sm">Unavailable</Badge>
                  {/if}
                </div>
                <p class="text-sm text-muted-foreground">Status</p>
              </div>
              <div class="flex flex-1 flex-col items-center">
                <div class="text-lg font-semibold text-blue-600">
                  {#if stats.crawler?.lastHeartbeat}
                    <div class="text-xs text-muted-foreground">
                      <Time timestamp={stats.crawler.lastHeartbeat} relative />
                    </div>
                  {:else}
                    <div class="text-sm text-red-600">No heartbeat</div>
                  {/if}
                </div>
                <p class="text-sm text-muted-foreground">Heartbeat</p>
              </div>
            </div>
            <Separator/>
            <div class="flex flex-row gap-4 justify-between">
              <div class="flex flex-1 flex-col items-center">
                <div class="text-lg font-semibold text-green-600">{stats.crawler?.queued || 0}</div>
                <p class="text-sm text-muted-foreground">Queue</p>
              </div>
              <div class="flex flex-1 flex-col items-center">
                <div class="text-lg font-semibold text-green-600">{stats.crawler?.processing || 0}</div>
                <p class="text-sm text-muted-foreground">Processing</p>
              </div>
            </div>
            
            <!-- Enhanced Progress Information -->
            {#if stats.activeJobs.length > 0 && stats.totalProgress.processedItems}
              <Separator/>
              <div class="space-y-2">
                <div class="text-xs font-medium text-muted-foreground">Current Progress</div>
                <div class="text-sm">
                  {#if stats.totalProgress.currentDataType}
                    <Badge variant="secondary" class="text-xs mb-1">
                      {stats.totalProgress.currentDataType}
                    </Badge>
                  {/if}
                  <div class="text-xs text-muted-foreground">
                    {stats.progressSummary}
                  </div>
                </div>
              </div>
            {/if}
          </Card.Content>
        </Card.Root>

        <Card.Root class="min-w-sm max-w-lg flex-1">
          <Card.Header class="flex flex-row items-center justify-between space-y-0 pb-0">
            <Card.Title class="font-medium">Storage</Card.Title>
            <HardDrive class="h-5 w-5 text-muted-foreground" />
          </Card.Header>
          <Card.Content class="space-y-2 pt-2 flex flex-row gap-4 justify-between">
            <div class="min-w-[150px] flex flex-col gap-4 justify-between">
              <div class="flex flex-col items-center pt-2">
                <div class="text-2xl font-bold">{formatBytes(stats.storage.used ?? 0)}</div>
                <p class="text-sm text-muted-foreground">Used</p>
              </div>
              <Separator />
              <Tooltip.Provider delayDuration={0}>
                <Tooltip.Root>
                  <Tooltip.Trigger>
                    <div class="flex flex-col items-center pb-2">
                      <div class="text-2xl font-semibold">{formatBytes(stats.storage.available)}</div>
                      <p class="text-sm text-muted-foreground">Available</p>
                    </div>
                  </Tooltip.Trigger>
                  <Tooltip.Content>
                    Total: {formatBytes(stats.storage.total)}
                  </Tooltip.Content>
                </Tooltip.Root>
              </Tooltip.Provider>
            </div>
            <Separator orientation="vertical" />
            <div class="grow flex-1 h-[120px] overflow-auto">
                <Chart>
                  <Svg center>
                    <Group y={16}>
                      <RadialGradient units="userSpaceOnUse" rotate={270} class="from-rose-600 to-lime-600" cx={"85px"} cy={"50px"} fx={"50px"} fy={"40px"} r={"100px"}>
                        {#snippet children({ gradient })}
                          <Arc
                            value={stats.storage.total > 0 ? Math.round((stats.storage.used / stats.storage.total) * 100) : 0}
                            range={[-120, 120]}
                            outerRadius={70}
                            innerRadius={50}
                            cornerRadius={10}
                            motion="spring"
                            fill={gradient}
                            track={{ class: 'fill-none stroke-surface-content/10' }}
                          >
                            {#snippet children({ value })}
                              <Text
                                value={Math.round(value) + "%"}
                                textAnchor="middle"
                                verticalAnchor="end"
                                dy={-4}
                                class="text-3xl tabular-nums"
                              />
                              <Text
                                value="Used"
                                textAnchor="middle"
                                verticalAnchor="start"
                                dy={4}
                                fill="#6b7280"
                                class="text-sm text-muted-foreground"
                              />
                            {/snippet}
                          </Arc>
                        {/snippet}
                      </RadialGradient>
                    </Group>
                  </Svg>
                </Chart>
            </div>
          </Card.Content>
        </Card.Root>
      </div>
      
      <!-- Progress Details Section (when active jobs exist) -->
      {#if stats.activeJobs.length > 0}
        <div class="mt-6">
          <h2 class="text-xl font-semibold mb-4">Active Job Progress Details</h2>
          <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            
            <!-- Overall Progress Card -->
            <Card.Root>
              <Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
                <Card.Title class="font-medium">Overall Progress</Card.Title>
                <TrendingUp class="h-5 w-5 text-muted-foreground" />
              </Card.Header>
              <Card.Content class="space-y-3">
                {#if stats.progressPercentage !== null}
                  <div class="space-y-2">
                    <Progress value={stats.progressPercentage} class="h-2" />
                    <div class="flex justify-between text-sm">
                      <span>{stats.totalProgress.processedItems || 0} processed</span>
                      <span>{stats.progressPercentage}%</span>
                    </div>
                  </div>
                {:else}
                  <div class="text-sm text-muted-foreground">
                    {stats.totalProgress.processedItems || 0} items processed
                  </div>
                {/if}
                
                {#if stats.totalProgress.currentDataType}
                  <div class="flex items-center gap-2">
                    <Badge variant="outline" class="text-xs">
                      {stats.totalProgress.currentDataType}
                    </Badge>
                    <span class="text-xs text-muted-foreground">Currently processing</span>
                  </div>
                {/if}
              </Card.Content>
            </Card.Root>

            <!-- Items by Type Breakdown -->
            {#if stats.totalProgress.itemsByType && Object.keys(stats.totalProgress.itemsByType).length > 0}
              <Card.Root>
                <Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
                  <Card.Title class="font-medium">Items by Type</Card.Title>
                  <Database class="h-5 w-5 text-muted-foreground" />
                </Card.Header>
                <Card.Content class="space-y-2">
                  {#each Object.entries(stats.totalProgress.itemsByType).filter(([_, count]) => typeof count === 'number' && count > 0) as [type, count]}
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-2">
                        {#if type === 'groups'}
                          <FolderTree class="h-4 w-4 text-blue-600" />
                        {:else if type === 'projects'}
                          <GitBranch class="h-4 w-4 text-green-600" />
                        {:else if type === 'issues'}
                          <CircleAlert class="h-4 w-4 text-red-600" />
                        {:else if type === 'mergeRequests'}
                          <GitMerge class="h-4 w-4 text-purple-600" />
                        {:else if type === 'commits'}
                          <GitCommit class="h-4 w-4 text-orange-600" />
                        {:else if type === 'users'}
                          <Users2 class="h-4 w-4 text-indigo-600" />
                        {:else if type === 'tags'}
                          <Tags class="h-4 w-4 text-pink-600" />
                        {:else}
                          <Database class="h-4 w-4 text-gray-600" />
                        {/if}
                        <span class="text-sm capitalize">{type}</span>
                      </div>
                      <span class="font-semibold">{count}</span>
                    </div>
                  {/each}
                </Card.Content>
              </Card.Root>
            {/if}

            <!-- Active Jobs List -->
            <Card.Root>
              <Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
                <Card.Title class="font-medium">Active Jobs ({stats.activeJobs.length})</Card.Title>
                <Activity class="h-5 w-5 text-muted-foreground" />
              </Card.Header>
              <Card.Content class="space-y-3">
                {#each stats.activeJobs.slice(0, 3) as job}
                  <div class="border rounded-lg p-3 space-y-2">
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-2">
                        <Badge variant={job.status === 'running' ? 'default' : job.status === 'paused' ? 'secondary' : 'outline'} class="text-xs">
                          {job.status}
                        </Badge>
                        <span class="text-xs font-mono text-muted-foreground">
                          {job.id.slice(0, 8)}...
                        </span>
                      </div>
                      {#if job.progressData.stage}
                        <Badge variant="outline" class="text-xs">
                          {job.progressData.stage}
                        </Badge>
                      {/if}
                    </div>
                    
                    {#if job.progressData.processedItems !== undefined || job.progressData.totalItems !== undefined}
                      {@const percentage = calculateProgressPercentage(job.progressData)}
                      <div class="space-y-1">
                        {#if percentage !== null}
                          <Progress value={percentage} class="h-1" />
                          <div class="text-xs text-muted-foreground">
                            {job.progressData.processedItems || 0}/{job.progressData.totalItems || 0} ({percentage}%)
                          </div>
                        {:else if job.progressData.processedItems}
                          <div class="text-xs text-muted-foreground">
                            {job.progressData.processedItems} items processed
                          </div>
                        {/if}
                      </div>
                    {/if}
                    
                    {#if job.progressData.currentDataType}
                      <div class="text-xs text-muted-foreground">
                        Processing: {job.progressData.currentDataType}
                      </div>
                    {/if}
                  </div>
                {/each}
                
                {#if stats.activeJobs.length > 3}
                  <div class="text-xs text-muted-foreground text-center">
                    ...and {stats.activeJobs.length - 3} more active jobs
                  </div>
                {/if}
              </Card.Content>
            </Card.Root>
          </div>
        </div>
      {/if}
    {/snippet}
  </AdminDataLoader>

  <!-- Crawler Status -->
  <!--
  {#await data.crawler}
    <Card.Root>
      <Card.Header>
        <Card.Title>Crawler Status</Card.Title>
      </Card.Header>
      <Card.Content>
        <Skeleton class="h-4 w-32" />
      </Card.Content>
    </Card.Root>
  {:then crawler}
    <Card.Root>
      <Card.Header>
        <Card.Title>Crawler Status</Card.Title>
        {#if crawler && typeof crawler === 'object' && 'lastHeartbeat' in crawler && crawler.lastHeartbeat}
          <Card.Description>
            Last heartbeat: <Time timestamp={crawler.lastHeartbeat as string} format="DD. MMM YYYY, HH:mm:ss" />
          </Card.Description>
        {/if}
      </Card.Header>
      <Card.Content>
        {#if crawler && typeof crawler === 'object'}
          {#if 'error' in crawler && crawler.error}
            <Alert.Root variant="destructive" class="mb-4">
              <CircleAlert class="size-4" />
              <Alert.Title>Error</Alert.Title>
              <Alert.Description>
                {crawler.error}
                {#if 'lastHeartbeat' in crawler && crawler.lastHeartbeat}
                  <br />
                  <Time timestamp={crawler.lastHeartbeat as string} format="DD. MMM YYYY, HH:mm:ss" />
                  (<Time timestamp={crawler.lastHeartbeat as string} relative />)
                {/if}
              </Alert.Description>
            </Alert.Root>
          {/if}
          
          <div class="grid grid-cols-2 gap-4 mb-4">
            <div>
              <div class="text-sm font-medium">Status</div>
              <div class="text-lg capitalize">{'state' in crawler ? crawler.state : 'Unknown'}</div>
            </div>
            <div>
              <div class="text-sm font-medium">Queue Size</div>
              <div class="text-lg">{'queueSize' in crawler ? crawler.queueSize : 0}</div>
            </div>
            <div class="col-span-2">
              <div class="text-sm font-medium">Current Job ID</div>
              <div class="text-lg font-mono">{'currentJobId' in crawler ? (crawler.currentJobId ?? "[none]") : "[none]"}</div>
            </div>
          </div>
          
          <div class="flex gap-2">
            <Button
              size="sm"
              disabled={loading}
              variant="secondary"
              onclick={() => invalidate("/api/admin/crawler")}
            >
              <RefreshCw class="h-4 w-4 mr-2" />
              Refresh Status
            </Button>
          </div>
        {:else}
          <Alert.Root variant="destructive">
            <CircleAlert class="size-4" />
            <Alert.Title>Error</Alert.Title>
            <Alert.Description>No Crawler Information Available</Alert.Description>
          </Alert.Root>
        {/if}
      </Card.Content>
    </Card.Root>
  {/await}
  -->

  <div class="flex flex-col gap-4 justify-stretch">
    <!-- Account Management Quick Actions -->
    <Card.Root class="flex-1">
      <Card.Header>
        <Card.Title>Account Management</Card.Title>
        <Card.Description>Quick actions for user account management</Card.Description>
      </Card.Header>
      <Card.Content>
        <div class="flex flex-wrap gap-4">
          <LoadingButton
            variant="secondary"
            icon={ArchiveRestore}
            fn={backupAccounts}
          >
            Backup (Mail)
          </LoadingButton>
          <Button
            target="_blank"
            href="/admin/backup">
            <DatabaseBackup class="h-4 w-4 mr-2" />
            Backup
          </Button>
          <Button
            variant="secondary"
            onclick={copyAccountIds}>
            <ClipboardCopy class="h-4 w-4 mr-2" />
            Copy IDs
          </Button>
          <Button
            variant="default"
            onclick={exportAccountsCSV}
          >
            <FileDown class="h-4 w-4 mr-2" />
            CSV Export
          </Button>
        </div>
      </Card.Content>
    </Card.Root>

    <!-- Hash Generator -->
    <Card.Root class="flex-1">
      <Card.Header>
        <Card.Title>Hash Generator</Card.Title>
        <Card.Description>Generate hashed values for secure storage and comparison</Card.Description>
      </Card.Header>
      <Card.Content class="space-y-4">
        <div class="flex flex-row gap-4">
          <Input
            type="text"
            bind:value={toBeHashed}
            class="font-mono flex-1"
            placeholder="Value to hash"
          />
          <Button onclick={hashValue}>
            Hash Value
          </Button>
        </div>

        <div
          class="flex flex-wrap flex-row cursor-pointer font-mono border-2 border-slate-300 p-2 rounded-md min-h-[2.5rem] items-center"
          use:clickToCopy={hashedValue}
        >
          <ClipboardCopy
            color={hashedValue && hashedValue.length > 0 ? '#000000' : '#9ca3af'}
            class="mr-2 flex-shrink-0"
          />
          <span class="break-all">{hashedValue || "Hashed value will appear here..."}</span>
        </div>
        
        {#if hashedValue}
          <p class="text-xs text-muted-foreground">
            Click the box above to copy the hashed value to clipboard.
          </p>
        {/if}
      </Card.Content>
    </Card.Root>
  </div>

  <!-- Quick Actions -->
  <div>
    <h2 class="text-2xl font-semibold mb-6">Quick Actions</h2>
    <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {#each quickActions as action (action.href)}
        <Card.Root class="hover:shadow-md transition-shadow">
          <Card.Header>
            <Card.Title class="flex items-center gap-2">
              {@const IconComponent = action.icon}
              <IconComponent class="h-5 w-5" />
              {action.label}
            </Card.Title>
            <Card.Description>{action.description}</Card.Description>
          </Card.Header>
          <Card.Content>
            <Button href={action.href} class="w-full">
              Go to {action.label}
            </Button>
          </Card.Content>
        </Card.Root>
      {/each}
    </div>
  </div>
</div>
