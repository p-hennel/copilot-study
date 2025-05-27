<script lang="ts">
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Skeleton } from "$ui/skeleton";
  import { m } from "$paraglide";
  import { Users, Key, MapPin, Briefcase, Settings, CircleAlert, RefreshCw } from "lucide-svelte";
  import Time from "svelte-time/Time.svelte";
  import { invalidate } from "$app/navigation";
  import type { PageProps } from "./$types";
  
  let { data }: PageProps = $props();

  let loading = $state(true);
  data.crawler.then(() => {
    loading = false;
  });

  function afterCommand() {
    loading = false;
    invalidate("/api/admin/crawler");
  }

  // Summary stats derived from data
  const summaryStats = $derived.by(async () => {
    const [users, areas, jobs, tokenInfos] = await Promise.all([
      data.users,
      data.areas,
      data.jobs,
      data.tokenInfos
    ]);

    return {
      users: Array.isArray(users) ? users.length : 0,
      areas: Array.isArray(areas) ? areas.length : 0,
      jobs: Array.isArray(jobs) ? jobs.length : 0,
      tokens: (tokenInfos && typeof tokenInfos === 'object' && 'result' in tokenInfos && tokenInfos.result)
        ? Object.keys(tokenInfos.result).length : 0
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

  <!-- Summary Cards -->
  <div class="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
    {#await summaryStats}
      {#each Array(4) as _}
        <Card.Root>
          <Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
            <Skeleton class="h-4 w-20" />
            <Skeleton class="h-4 w-4" />
          </Card.Header>
          <Card.Content>
            <Skeleton class="h-8 w-16" />
            <Skeleton class="h-3 w-24 mt-2" />
          </Card.Content>
        </Card.Root>
      {/each}
    {:then stats}
      <Card.Root>
        <Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
          <Card.Title class="text-sm font-medium">Total Users</Card.Title>
          <Users class="h-4 w-4 text-muted-foreground" />
        </Card.Header>
        <Card.Content>
          <div class="text-2xl font-bold">{stats.users}</div>
          <p class="text-xs text-muted-foreground">Registered accounts</p>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
          <Card.Title class="text-sm font-medium">Active Tokens</Card.Title>
          <Key class="h-4 w-4 text-muted-foreground" />
        </Card.Header>
        <Card.Content>
          <div class="text-2xl font-bold">{stats.tokens}</div>
          <p class="text-xs text-muted-foreground">API tokens configured</p>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
          <Card.Title class="text-sm font-medium">Survey Areas</Card.Title>
          <MapPin class="h-4 w-4 text-muted-foreground" />
        </Card.Header>
        <Card.Content>
          <div class="text-2xl font-bold">{stats.areas}</div>
          <p class="text-xs text-muted-foreground">Configured areas</p>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
          <Card.Title class="text-sm font-medium">Total Jobs</Card.Title>
          <Briefcase class="h-4 w-4 text-muted-foreground" />
        </Card.Header>
        <Card.Content>
          <div class="text-2xl font-bold">{stats.jobs}</div>
          <p class="text-xs text-muted-foreground">Jobs in system</p>
        </Card.Content>
      </Card.Root>
    {/await}
  </div>

  <!-- Crawler Status -->
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

  <!-- Quick Actions -->
  <div>
    <h2 class="text-2xl font-semibold mb-6">Quick Actions</h2>
    <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {#each quickActions as action (action.href)}
        <Card.Root class="hover:shadow-md transition-shadow">
          <Card.Header>
            <Card.Title class="flex items-center gap-2">
              <svelte:component this={action.icon} class="h-5 w-5" />
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
