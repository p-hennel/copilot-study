<script lang="ts">
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Skeleton } from "$ui/skeleton";
  import Input from "@/input/input.svelte";
  import { m } from "$paraglide";
  import { Users, Key, MapPin, Briefcase, Settings, CircleAlert, RefreshCw, ClipboardCopy, DatabaseBackup, FileDown, ArchiveRestore } from "lucide-svelte";
  import Time from "svelte-time/Time.svelte";
  import { invalidate } from "$app/navigation";
  import type { PageProps } from "./$types";
  import { clickToCopy, dynamicHandleDownloadAsCSV } from "$lib/utils";
  import { toast } from "svelte-sonner";
  import LoadingButton from "$lib/components/LoadingButton.svelte";
  import { authClient } from "$lib/auth-client";
  import { goto } from "$app/navigation";
  
  let { data }: PageProps = $props();

  let loading = $state(true);
  data.crawler.then(() => {
    loading = false;
  });

  function afterCommand() {
    loading = false;
    invalidate("/api/admin/crawler");
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

<!-- Account Management Quick Actions -->
  <Card.Root>
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
  <Card.Root>
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
