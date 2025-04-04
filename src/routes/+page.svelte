<script lang="ts">
  import { Separator } from "$lib/components/ui/separator/index.js"
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import type { PageData } from "./$types" // Use PageData from generated types
  let { data }: { data: PageData } = $props() // Use PageData
  import Markdown from "svelte-exmarkdown"
  import { authClient } from "$lib/auth-client"
  import Gitlab from "$lib/components/Gitlab.svelte"
  // Removed: import AuthProvider from "$lib/components/AuthProvider.svelte";
  import AuthProviderCard from "$lib/components/AuthProviderCard.svelte"
  import { TokenProvider } from "$lib/types";
  import { JobStatus } from "$lib/types";
  // Removed: import { number } from "$lib/paraglide/registry";
  import AreaCard from "$lib/components/AreaCard.svelte"
  import { m } from "$paraglide"
  import * as Accordion from "$lib/components/ui/accordion/index.js"
  import { page } from "$app/stores" // Import page store
  import ProfileWidget from "$components/ProfileWidget.svelte"
  import { Progress } from "$components/ui/progress"
  import { FolderGit2, Gift, RefreshCw, UsersRound } from "lucide-svelte"
  import * as Alert from "$lib/components/ui/alert/index.js";;
  import AuroraText from "$components/ui-mod/AuroraText.svelte";
  import SparklesText from "$components/ui-mod/SparklesText.svelte";
    import BorderBeam from "$components/ui-mod/BorderBeam.svelte";
  let pageState = $state({
    loading: true,
    linkedAccounts: [] as string[]
  })

  $effect(() => {
    if (data.session && data.user && data.user.id) {
      authClient.listAccounts().then((x) => {
        if (!!x.data && x.data.length > 0) {
          pageState.linkedAccounts = x.data.map((x) => x.provider)
        }
        pageState.loading = false
      })
    } else {
      pageState.loading = false
    }
  })

  const nicerCounts = (count: number) => {
    if (count <= 0) return "no"
    else return `${count}`
  }

  const isLoggedIn = $derived(!!$page.data.session && !!$page.data.session.userId) // Use $page store
  const jobsSummary = $derived.by(() => {
    return data.jobs.reduce(
      (ctr, item) => {
        if (item.status) ctr[item.status] = ctr[item.status] + 1
        return ctr
      },
      {
        [JobStatus.failed]: 0,
        [JobStatus.finished]: 0,
        [JobStatus.queued]: 0,
        [JobStatus.running]: 0,
        [JobStatus.paused]: 0 // Add paused status
      }
    )
  })
</script>

<article class="prose mb-4 items-center">
  <ProfileWidget user={data.user} />

  <h1 class="text-4xl font-extrabold">{m["home.title"]()}</h1>
  <p class="mb-0">
    {m["home.intro"]()}
  </p>

  <Alert.Root class="relative mx-auto rounded-3xl my-12 max-w-200">
    {#if !data.user}
      <BorderBeam duration={4} borderWidth={2.5} />
    {/if}
    <Gift class="mt-2.5" color="#581c87" strokeWidth={2} size={64} />
    <Alert.Title>
      <h1 class="ml-12 text-3xl font-bold tracking-tighter text-center md:text-4xl lg:text-6xl mb-0">
        <SparklesText colors={{first: "#fcd34d", second: "#fda4af"}} sparklesCount={8} lifespanMin={12} lifespanFactor={22} textClass="bg-gradient-to-tl from-slate-900 via-purple-900 to-slate-900 bg-clip-text text-transparent" text="Win a Prize!" />
      </h1>
    </Alert.Title>
    <Alert.Description class="ml-12 md:text-lg lg:text-xl text-center">As a thank you, you will be entered into a draw for a chance to win a prize!</Alert.Description>
  </Alert.Root>
  
  {#if !!$page.data.user && !!$page.data.session}
    <!-- Use $page store -->
    <Accordion.Root type="single" class="mt-0 w-full text-lg">
      <Accordion.Item value="explainer">
        <Accordion.Trigger class="pb-2 text-lg font-semibold">Read more...</Accordion.Trigger>
        <Accordion.Content class="prose m-0 p-0">
          <Markdown md={data.content} />
        </Accordion.Content>
      </Accordion.Item>
    </Accordion.Root>
  {:else}
    <Markdown md={data.content} />
    <Separator class="mt-8 mb-10" />
  {/if}
</article>

<div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
  <AuthProviderCard
    iconSize={12}
    class="md:col-span-2 xl:col-span-5"
    linkedAccounts={pageState.linkedAccounts}
    bind:loading={pageState.loading}
    textId="auth.login.action"
    doneTextId="auth.login.action_done"
    Icon={Gitlab}
    provider={TokenProvider.gitlab}
    {isLoggedIn}
    nextUrl="/"
  />
</div>

{#if !!data.areas && data.areas.length > 0}
  <Separator class="my-4" />

  <div class="flex flex-wrap gap-4">
    {#each data.areas as area, idx (idx)}
      <!-- Add key -->
      <AreaCard {area} />
    {/each}
  </div>
{:else if data.session}
  <Separator class="my-4" />
  <div class="flex items-center justify-between">
    <p>
      As soon as your account's areas (i.e., groups and projects) have been synchronized, you will see more information
      here.
    </p>
    <!--
    <Button
      variant="outline"
      onclick={() => {
        goto("/recheck")
      }}
    >
      <RefreshCw />
      Refresh
    </Button>
    -->
  </div>
  {#await data.jobInfo then jobInfo}
    {#if jobInfo}
      <div class="mt-6 flex w-full flex-wrap items-center gap-4">
        <span class="italic">Initial job: {jobInfo.status}</span>
        <Tooltip.Provider>
          <Tooltip.Root>
            <Tooltip.Trigger class="flex w-full items-center gap-4">
              <UsersRound class="h-8 w-8" />
              <div class="flex-1">
                <Progress value={jobInfo.isComplete ? 100 : jobInfo.collectedGroups} max={jobInfo.isComplete ? 100 : jobInfo.totalGroups} />
              </div>
            </Tooltip.Trigger>
            <Tooltip.Content side="top" sideOffset={-10}>
              {jobInfo.collectedGroups}{jobInfo.totalGroups ? "/" : ""}{jobInfo.totalGroups} Groups
            </Tooltip.Content>
          </Tooltip.Root>
        </Tooltip.Provider>
        <Tooltip.Provider delayDuration={0}>
          <Tooltip.Root>
            <Tooltip.Trigger class="flex w-full items-center gap-4">
              <FolderGit2 class="h-8 w-8" />
              <div class="flex-1">
                <Progress value={jobInfo.isComplete ? 100 : jobInfo.collectedProjects} max={jobInfo.isComplete ? 100 : jobInfo.totalProjects} />
              </div>
            </Tooltip.Trigger>
            <Tooltip.Content side="bottom" sideOffset={-10}>
              {jobInfo.collectedProjects}{jobInfo.totalProjects ? "/" : ""}{jobInfo.totalProjects} Projects
            </Tooltip.Content>
          </Tooltip.Root>
        </Tooltip.Provider>
      </div>
    {/if}
  {/await}
{/if}

{#if !!data.jobs && data.jobs.length > 0}
  <Separator class="my-4" />
  <Accordion.Root type="single" class="mt-0 w-full text-sm">
    <Accordion.Item value="explainer">
      <Accordion.Trigger class="pb-2 text-sm">More details</Accordion.Trigger>
      <Accordion.Content class="m-0 p-0">
        <p>
          Directly associated with your accounts, {nicerCounts(jobsSummary[JobStatus.finished])} jobs have finished (and {nicerCounts(
            jobsSummary[JobStatus.finished]
          )} have failed).
        </p>
        {#if jobsSummary[JobStatus.running] > 0 || jobsSummary[JobStatus.queued] > 0}
          <p>
            Currently, {nicerCounts(jobsSummary[JobStatus.running])} jobs are running, while {nicerCounts(
              jobsSummary[JobStatus.queued]
            )} are queued.
          </p>
        {/if}
      </Accordion.Content>
    </Accordion.Item>
  </Accordion.Root>
{/if}
