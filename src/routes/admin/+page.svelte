<script lang="ts">
  import { invalidate } from "$app/navigation";
  import ProfileWidget from "$components/ProfileWidget.svelte";
  import TokensInfo from "$components/TokensInfo.svelte";
  import AreasTable from "$lib/components/AreasTable.svelte";
  import JobsTable from "$lib/components/JobsTable.svelte";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Tabs from "$lib/components/ui/tabs/index.js";
  import UserTable from "$lib/components/UserTable.svelte";
  import { m } from "$paraglide";
  import { Button } from "$ui/button";
  import { Skeleton } from "$ui/skeleton";
  import { Textarea } from "$ui/textarea";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import { CircleDashed, Pause, Play, PlayCircle, RefreshCw } from "lucide-svelte";
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import Time from "svelte-time/Time.svelte";
  import type { PageProps, Snapshot } from "./$types";
  
  let { data }: PageProps = $props();

  // --- Settings Tab State ---
  let settingsYaml = $state("");
  let isLoadingSettings = $state(false);
  let settingsError = $state<string | null>(null);

  async function fetchSettings() {
    isLoadingSettings = true;
    settingsError = null;
    try {
      const response = await fetch("/api/admin/settings");
      if (!response.ok) {
        throw new Error(`Failed to fetch settings: ${response.statusText}`);
      }
      const result = (await response.json()) as { yaml?: string; error?: string }; // Type assertion
      if (result.yaml) {
        settingsYaml = result.yaml;
      } else {
        throw new Error(result.error || "Received invalid response from server");
      }
    } catch (error: any) {
      settingsError = error.message || "An unknown error occurred";
      toast.error("Failed to load settings", { description: settingsError ?? "" }); // Handle null
    } finally {
      isLoadingSettings = false;
    }
  }

  async function saveSettings() {
    isLoadingSettings = true;
    settingsError = null;
    try {
      const response = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yaml: settingsYaml })
      });
      const result = (await response.json()) as {
        success?: boolean;
        message?: string;
        error?: string;
        details?: any;
      }; // Type assertion
      if (!response.ok || !result.success) {
        throw new Error(result.error || `Failed to save settings: ${response.statusText}`);
      }
      toast.success(result.message || "Settings saved successfully!");
      // Optionally re-fetch settings to confirm changes or rely on the API response
      // await fetchSettings(); // Uncomment if re-fetch is desired
    } catch (error: any) {
      settingsError = error.message || "An unknown error occurred";
      toast.error("Failed to save settings", { description: settingsError ?? "" }); // Handle null
    } finally {
      isLoadingSettings = false;
    }
  }

  onMount(() => {
    // Fetch settings initially when the component mounts
    // Alternatively, fetch when the 'settings' tab is selected
    fetchSettings();
  });
  // --- End Settings Tab State ---

  const randomWidths = ["w-1/2", "w-2/3", "w-3/4", "w-5/6", "w-7/12", "w-10/12", "w-11/12"];
  const getLoadingClassForColumn = (idx: number) => {
    if (idx === 0) return "h-4 w-3/4 ml-auto";
    const randomWidth = randomWidths[Math.floor(Math.random() * randomWidths.length)];
    return `col-span-${idx === 2 ? "4" : "2"} h-4 ${idx > 4 ? "mx-auto " : ""}${randomWidth}`;
  };
  const loadingRows = Array.from({ length: 20 }, () =>
    Array.from({ length: 7 }, (_, idx) => getLoadingClassForColumn(idx))
  );

  let selectedTab = $state("tokens");

  export const snapshot: Snapshot<string> = {
    capture: () => selectedTab,
    restore: (value) => (selectedTab = value)
  };
  //const processesWithToken = $derived.by(() => Promise.all([data.processes, data.sessiontoken]))

  let loading = $state(true);
  data.crawler.then(() => {
    loading = false;
  });

  function afterCommand() {
    loading = false;
    invalidate("/api/admin/crawler");
  }
/*
  async function toggleCrawler(crawler: CrawlerStatus | null) {
    if (!crawler) crawler = await data.crawler;
    if (!crawler) return;
    if (crawler.state !== "running" && crawler.state !== "paused") return;
    if (loading) return;
    loading = true;
    if (crawler.state === "running") {
      // Pause the crawler
      fetch("/api/admin/crawler/pause", { method: "POST" })
        .then(afterCommand)
        .catch((error) => console.error("Error pausing crawler:", error))
        .finally(() => (loading = false));
    } else if (crawler.state === "paused") {
      // Resume the crawler
      fetch("/api/admin/crawler/resume", { method: "POST" })
        .then(afterCommand)
        .catch((error) => console.error("Error resuming crawler:", error))
        .finally(() => (loading = false));
    }
  }

  async function pushCrawler(crawler: CrawlerStatus | null) {
    if (!crawler) crawler = await data.crawler;
    if (!crawler) return;
    crawler.state = "error";
    if (!!crawler.currentJobId && crawler.state !== "error") return;
    if (loading) return;
    loading = true;
    fetch("/api/admin/crawler/push", { method: "POST" })
      .then(afterCommand)
      .catch((error) => console.error("Error pushing crawler:", error))
      .finally(() => (loading = false));
  }
*/
</script>

<ProfileWidget user={data.user} class="mb-4" />
<h1 class="mb-2 text-4xl font-extrabold">{m["admin.dashboard.title"]()}</h1>

<Tabs.Root bind:value={selectedTab} class="w-full">
  <Tabs.List class="mx-auto flex w-full flex-row">
    <Tabs.Trigger value="tokens" class="flex-1">Tokens</Tabs.Trigger>
    <Tabs.Trigger value="accounts" class="flex-1">Accounts</Tabs.Trigger>
    <Tabs.Trigger value="areas" class="flex-1">Areas</Tabs.Trigger>
    <Tabs.Trigger value="jobs" class="flex-1">Jobs</Tabs.Trigger>
    <Tabs.Trigger value="processes" class="flex-1">Processes</Tabs.Trigger>
    <Tabs.Trigger value="settings" class="flex-1">Settings</Tabs.Trigger>
  </Tabs.List>
  <Tabs.Content value="tokens">
    {#await data.tokenInfos}
      Loading...
    {:then tokenInfos}
      <TokensInfo infos={tokenInfos.result} />
    {/await}
  </Tabs.Content>
  <Tabs.Content value="accounts">
    {#await data.users}
      <Skeleton class="my-2 h-4 w-1/12" />
      <Skeleton class="my-2 h-4 w-1/4" />

      <div class="mb-12 grid grid-cols-15 items-center gap-3">
        <div class="row-span-2 content-center">
          <Skeleton class="ml-auto h-6 w-3/4" />
        </div>
        <div class="col-span-2 row-span-2 content-center">
          <Skeleton class="h-6 w-1/2" />
        </div>
        <div class="col-span-4 row-span-2 content-center">
          <Skeleton class="h-6 w-1/3" />
        </div>
        <div class="col-span-2 row-span-2 content-center">
          <Skeleton class="mx-auto h-6 w-3/4" />
        </div>
        <div class="col-span-6 content-center">
          <Skeleton class="mx-auto h-6 w-1/3" />
        </div>
        <Skeleton class="col-span-2 h-6" />
        <Skeleton class="col-span-2 mx-auto h-6 w-2/3" />
        <Skeleton class="col-span-2 mx-auto h-6 w-2/3" />

        {#each loadingRows as row, idxR (idxR)}
          {#each row as col, idxC (idxC)}
            <Skeleton class={col} />
          {/each}
        {/each}
      </div>
    {:then users}
      {#if users}
        <UserTable users={users as any[]} />
      {/if}
    {/await}
  </Tabs.Content>
  <Tabs.Content value="areas">
    {#await data.areas}
      Loading
    {:then areas}
      <AreasTable areas={areas as any[]} />
    {/await}
  </Tabs.Content>
  <Tabs.Content value="jobs">
    {#await data.jobs}
      Loading
    {:then jobs}
      <JobsTable jobs={jobs as any[]} />
    {/await}
  </Tabs.Content>
  <Tabs.Content value="processes">
    {#await data.crawler}
      Loading
    {:then crawler}
      <div class="justify-center">
        {#if crawler}
          {#if crawler.error}
            <Alert.Root variant="destructive">
              <CircleAlert class="size-4" />
              <Alert.Title>Error</Alert.Title>
              <Alert.Description>
                {crawler.error}
                {#if crawler.lastHeartbeat}
                  <br />
                  <Time timestamp={crawler.lastHeartbeat} format="DD. MMM YYYY, HH:mm:ss" />
                  (
                  <Time timestamp={crawler.lastHeartbeat} relative />
                  )
                {/if}
              </Alert.Description>
            </Alert.Root>
          {/if}
          <Card.Root>
            <Card.Header>
              <Card.Title>Crawler: {crawler.state}</Card.Title>
              <Card.Description>
                Last heartbeat: <Time
                  timestamp={crawler.lastHeartbeat}
                  format="DD. MMM YYYY, HH:mm:ss"
                />
              </Card.Description>
            </Card.Header>
            <Card.Content>
              <div class="mb-4 grid grid-cols-2 items-center justify-center gap-2">
                <strong class="text-end">Queue Size:</strong>
                <span class="text-start">{crawler.queueSize}</span>
                <strong class="text-end">Current Job ID:</strong>
                <span class="text-start">{crawler.currentJobId ?? "[none]"}</span>
              </div>
            </Card.Content>
            <Card.Footer class="flex flex-wrap justify-between gap-4">
              <Button
                variant="default"
                disabled={loading || (!!crawler.currentJobId && crawler.state !== "error")}
                onclick={() => pushCrawler(crawler)}
                class="justify-self-start"
              >
                <PlayCircle />
                Push/Restart Job
              </Button>
              <Button
                variant="default"
                disabled={loading || (crawler.state !== "paused" && crawler.state !== "running")}
                onclick={() => toggleCrawler(crawler)}
                class="justify-self-start"
              >
                {#if crawler.state === "running"}
                  <Pause />
                {:else if crawler.state === "paused"}
                  <Play />
                {:else}
                  <CircleDashed />
                {/if}
                {#if crawler.state === "running"}
                  Pause
                {:else if crawler.state === "paused"}
                  Resume
                {:else}
                  Start/Pause
                {/if}
              </Button>
              <Button
                disabled={loading}
                variant="secondary"
                onclick={() => invalidate("/api/admin/crawler")}
                class="justify-self-end"
              >
                <RefreshCw />
                Refresh
              </Button>
            </Card.Footer>
          </Card.Root>
        {:else}
          <Alert.Root variant="destructive">
            <CircleAlert class="size-4" />
            <Alert.Title>Error</Alert.Title>
            <Alert.Description>No Crawler Information Available</Alert.Description>
          </Alert.Root>
        {/if}
      </div>
    {/await}
  </Tabs.Content>
  <Tabs.Content value="settings">
    <div class="mt-4 space-y-4">
      <h2 class="text-2xl font-semibold">Application Settings (YAML)</h2>
      {#if isLoadingSettings}
        <p>Loading settings...</p>
        <Skeleton class="h-64 w-full" />
      {:else if settingsError}
        <p class="text-destructive">Error loading settings: {settingsError}</p>
        <Button onclick={fetchSettings}>Retry</Button>
      {:else}
        <Textarea
          bind:value={settingsYaml}
          class="h-96 font-mono"
          placeholder="Settings in YAML format..."
          disabled={isLoadingSettings}
        />
        <Button onclick={saveSettings} disabled={isLoadingSettings}>
          {#if isLoadingSettings}Saving...{:else}Save Settings{/if}
        </Button>
      {/if}
    </div>
  </Tabs.Content>
</Tabs.Root>
