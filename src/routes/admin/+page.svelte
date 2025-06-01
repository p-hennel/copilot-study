<script lang="ts">
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Progress } from "$lib/components/ui/progress/index.js";
  import type { ComponentProps } from "svelte";
  import Time from "svelte-time/Time.svelte";
  import Input from "@/input/input.svelte";
  import { m } from "$paraglide";
  import { Users, Key, MapPin, Briefcase, Settings, CircleAlert, RefreshCw, ClipboardCopy, DatabaseBackup, FileDown, ArchiveRestore, FolderTree, Activity, CheckCircle, Clock, XCircle, Search, Play, Pause, Square, Loader2, Heart, WifiOff, Wifi } from "lucide-svelte";
  import { goto, invalidate } from "$app/navigation";
  import type { PageProps } from "./$types";
  import { clickToCopy, dynamicHandleDownloadAsCSV } from "$lib/utils";
  import { formatBytes } from '$lib/utils'
  import { toast } from "svelte-sonner";
  import LoadingButton from "$lib/components/LoadingButton.svelte";
  import { authClient } from "$lib/auth-client"
  import AdminDataLoader from "$lib/components/admin/AdminDataLoader.svelte";
  import { invalidateWithLoading } from "$lib/utils/admin-fetch";
  import { HardDrive } from "@lucide/svelte";

  import {
    Arc,
    Chart,
    Group,
    LinearGradient,
    Svg,
    Text,
  } from 'layerchart';
  
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
    const [users, statistics, tokenInfos, crawler, storage] = await Promise.all([
      data.users,
      data.statistics,
      data.tokenInfos,
      data.crawler,
      data.storage
    ]);

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
        ? storage : { used: 0, available: 0, total: 0 }
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
          <Card.Content class="space-y-2 pt-2 flex flex-row gap-4 justify-between">
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
              <div class="text-lg font-semibold text-green-600">{stats.jobs.paused}</div>
              <p class="text-sm text-muted-foreground">Paused</p>
            </div>
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
              <div class="text-2xl font-semibold text-blue-600">{Math.round((stats.jobs.groupProjectDiscovery / stats.jobs.total) * 100)}%</div>
              <p class="text-sm text-muted-foreground">of all</p>
            </div>
          </Card.Content>
        </Card.Root>

        <Card.Root class="min-w-xs max-w-md flex-1">
          <Card.Header class="flex flex-row items-center justify-between space-y-0 pb-0">
            <Card.Title class="font-medium">Job Status</Card.Title>
            <Briefcase class="h-5 w-5 text-muted-foreground" />
          </Card.Header>
          <Card.Content class="space-y-2">
            <div class="space-y-2">
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
                  <span class="text-sm">Queued</span>
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
              <div class="pt-2 border-t">
                <div class="text-xs text-muted-foreground mb-1">Completion Rate</div>
                <Progress value={(stats.jobs.completed / stats.jobs.total) * 100} class="h-2" />
                <div class="text-xs text-muted-foreground mt-1">
                  {Math.round((stats.jobs.completed / stats.jobs.total) * 100)}%
                </div>
              </div>
            {/if}
          </Card.Content>
        </Card.Root>

        <Card.Root class="min-w-3xs max-w-md flex-1">
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
          <Card.Content class="space-y-2">
            <div>
              {#if stats.crawler?.state}
                <Badge variant={stats.crawler.state === 'running' ? 'default' : stats.crawler.state === 'paused' ? 'secondary' : 'destructive'} class="text-sm">
                  {stats.crawler.state}
                </Badge>
              {:else}
                <Badge variant="destructive" class="text-sm">Unavailable</Badge>
              {/if}
              <p class="text-xs text-muted-foreground mt-1">System status</p>
            </div>
            <div class="border-t pt-4 space-y-2">
              <div class="flex justify-between">
                <span class="text-xs text-muted-foreground">Queue:</span>
                <span class="text-sm font-semibold">{stats.crawler?.queued || 0}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-xs text-muted-foreground">Processing:</span>
                <span class="text-sm font-semibold">{stats.crawler?.processing || 0}</span>
              </div>
              {#if stats.crawler?.lastHeartbeat}
                <div class="text-xs text-muted-foreground">
                  <Time timestamp={stats.crawler.lastHeartbeat} relative />
                </div>
              {:else}
                <div class="text-sm text-red-600">No heartbeat</div>
              {/if}
            </div>
          </Card.Content>
        </Card.Root>

        <Card.Root class="min-w-sm max-w-md flex-1">
          <Card.Header class="flex flex-row items-center justify-between space-y-0 pb-0">
            <Card.Title class="font-medium">Storage</Card.Title>
            <HardDrive class="h-5 w-5 text-muted-foreground" />
          </Card.Header>
          <Card.Content class="space-y-2 pt-2 flex flex-row gap-4 justify-between">
            <div class="min-w-[120px] flex flex-col gap-4 justify-between">
              <div class="flex flex-col items-center">
                <div class="text-2xl font-bold">{formatBytes(stats.storage.used)}</div>
                <p class="text-sm text-muted-foreground">Used</p>
              </div>
              <Separator orientation="horizontal" class="" />
              <div class="flex flex-col items-center">
                <div class="text-2xl font-semibold">{formatBytes(stats.storage.available)}</div>
                <p class="text-sm text-muted-foreground">Available</p>
              </div>
            </div>
            <div class="grow flex-1">
              <div class="h-[120px] overflow-auto">
                <Chart>
                  <Svg center>
                    <Group y={16}>
                      <LinearGradient class="from-secondary to-primary" let:gradient>
                        <Arc
                          value={stats.storage.total > 0 ? Math.round((stats.storage.used / stats.storage.total) * 100) : 0}
                          range={[-120, 120]}
                          outerRadius={60}
                          innerRadius={50}
                          cornerRadius={5}
                          spring
                          let:value
                          fill={gradient}
                          track={{ class: "fill-none stroke-surface-content/10" }}
                        >
                          <Text
                            value={Math.round(value) + "%"}
                            textAnchor="middle"
                            verticalAnchor="middle"
                            class="text-3xl tabular-nums"
                          />
                        </Arc>
                      </LinearGradient>
                    </Group>
                  </Svg>
                </Chart>
              </div>
            </div>
          </Card.Content>
        </Card.Root>
      </div>
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
