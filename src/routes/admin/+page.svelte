<script lang="ts">
  import type { PageProps } from "./$types"
  import { m } from "$paraglide"
  import UserTable from "$lib/components/UserTable.svelte"
  import { Skeleton } from "$ui/skeleton"
  import * as Tabs from "$lib/components/ui/tabs/index.js"
  import ProcesTable from "$lib/components/ProcesTable.svelte"
  import JobsTable from "$lib/components/JobsTable.svelte"
  import AreasTable from "$lib/components/AreasTable.svelte"
  import type { Snapshot } from "./$types"
  import ProfileWidget from "$components/ProfileWidget.svelte"
  // Removed incorrect import from $lib/server/utils

  let { data }: PageProps = $props()

  const randomWidths = ["w-1/2", "w-2/3", "w-3/4", "w-5/6", "w-7/12", "w-10/12", "w-11/12"]
  const getLoadingClassForColumn = (idx: number) => {
    if (idx === 0) return "h-4 w-3/4 ml-auto"
    const randomWidth = randomWidths[Math.floor(Math.random() * randomWidths.length)]
    return `col-span-${idx === 2 ? "4" : "2"} h-4 ${idx > 4 ? "mx-auto " : ""}${randomWidth}`
  }
  const loadingRows = Array.from({ length: 20 }, () =>
    Array.from({ length: 7 }, (_, idx) => getLoadingClassForColumn(idx))
  )

  let selectedTab = $state("accounts")

  export const snapshot: Snapshot<string> = {
    capture: () => selectedTab,
    restore: (value) => (selectedTab = value)
  }
  const processesWithToken = $derived.by(() => Promise.all([data.processes, data.sessiontoken]))
</script>

<ProfileWidget user={data.user} class="mb-4" />
<h1 class="mb-2 text-4xl font-extrabold">{m["admin.dashboard.title"]()}</h1>

<Tabs.Root bind:value={selectedTab} class="w-full">
  <Tabs.List class="mx-auto flex w-full flex-row">
    <Tabs.Trigger value="accounts" class="flex-1">Accounts</Tabs.Trigger>
    <Tabs.Trigger value="areas" class="flex-1">Areas</Tabs.Trigger>
    <Tabs.Trigger value="jobs" class="flex-1">Jobs</Tabs.Trigger>
    <Tabs.Trigger value="processes" class="flex-1">Processes</Tabs.Trigger>
  </Tabs.List>
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

        {#each loadingRows as row (row)}
          {#each row as col (col)}
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
    {#await processesWithToken}
      Loading
    {:then [processes, token]}
      <ProcesTable processes={processes as any} sessionToken={token ?? ""} />
    {/await}
  </Tabs.Content>
</Tabs.Root>
