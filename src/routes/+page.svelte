<script lang="ts">
  import { dev } from '$app/environment';
  import ProfileWidget from "$components/ProfileWidget.svelte";
  import BorderBeam from "$components/ui-mod/BorderBeam.svelte";
  import SparklesText from "$components/ui-mod/SparklesText.svelte";
  import { Progress } from "$components/ui/progress";
  import { authClient } from "$lib/auth-client";
  import AreaCard from "$lib/components/AreaCard.svelte";
  import AuthProviderCard from "$lib/components/AuthProviderCard.svelte";
  import Gitlab from "$lib/components/Gitlab.svelte";
  import * as Accordion from "$lib/components/ui/accordion/index.js";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { JobStatus, TokenProvider } from "$lib/types";
  import { m } from "$paraglide";
  import { FolderGit2, Gift, UsersRound } from "lucide-svelte";
  import Markdown from "svelte-exmarkdown";
  import Time from "svelte-time/Time.svelte";
  import type { PageProps } from "./$types";
  let pageState = $state({
    loading: true,
    linkedAccounts: [] as string[]
  })

  let { data }: PageProps = $props()

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

  const isLoggedIn = $derived(!!data.session && !!data.session.userId)
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

  const getProgressParams = (isComplete: boolean, count: number|null, total: number|null) => {
    const _total = normalizedTotal(count, total)
    if (isComplete)
      return {
        value: 100,
        max: 100
      }
    return {
      value: _total > 0 ? count : 0,
      max: _total > 0 ? _total : undefined
    }
  }

  const normalizedTotal = (count: number | null, total: number|null) => {
    if (!count || count <= 0 || !total || total <= 0 || count < total)
      return 0
    return total
  }

  const getCountInfo = (count: number | null, total: number|null) => {
    if (!count || count <= 0)
      count = 0
    total = normalizedTotal(count, total)
    if (total <= 0 || count > total)
      return `${count}`
    return `${count} / ${total}`
  }
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
  
  {#if !!data.user && !!data.session}
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
  {#if dev}
  <AuthProviderCard
    iconSize={12}
    class="md:col-span-2 xl:col-span-5"
    linkedAccounts={pageState.linkedAccounts}
    bind:loading={pageState.loading}
    textId="auth.login.action"
    doneTextId="auth.login.action_done"
    Icon={Gitlab}
    provider={TokenProvider.gitlabCloud}
    {isLoggedIn}
    nextUrl="/"
  />
  {/if}
</div>

{#if !!data.areas && data.areas.length > 0}
  <Separator class="my-4" />

  <div class="flex flex-wrap gap-4 justify-between">
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
  {#await data.jobInfo then jobInfos}
    {#each jobInfos as jobInfo (jobInfo.provider) }
      <div class="mt-6 flex w-full flex-wrap items-center gap-4">
        <Tooltip.Provider>
          <Tooltip.Root>
            <Tooltip.Trigger class="flex w-full items-center gap-4">
              <span class="italic">
                Initializing {jobInfo.provider}: {jobInfo.isComplete ? "Done" : "Processing..."}
              </span>
            </Tooltip.Trigger>
            <Tooltip.Content side="top" sideOffset={-10}>
              <p>
                updated at: <Time timestamp={jobInfo.updated_at} relative={true} />
                created at: <Time timestamp={jobInfo.createdAt} relative={true}/>
              </p>
            </Tooltip.Content>
          </Tooltip.Root>
        </Tooltip.Provider>
        <Tooltip.Provider>
          <Tooltip.Root>
            <Tooltip.Trigger class="flex w-full items-center gap-4">
              <UsersRound class="h-8 w-8" />
              <div class="flex-1">
                <Progress {...getProgressParams(jobInfo.isComplete, jobInfo.groupCount, jobInfo.groupTotal)} />
              </div>
            </Tooltip.Trigger>
            <Tooltip.Content side="top" sideOffset={-10}>
              {getCountInfo(jobInfo.groupCount, jobInfo.groupTotal)} Groups
            </Tooltip.Content>
          </Tooltip.Root>
        </Tooltip.Provider>
        <Tooltip.Provider delayDuration={0}>
          <Tooltip.Root>
            <Tooltip.Trigger class="flex w-full items-center gap-4">
              <FolderGit2 class="h-8 w-8" />
              <div class="flex-1">
                <Progress {...getProgressParams(jobInfo.isComplete, jobInfo.projectCount, jobInfo.projectTotal)} />
              </div>
            </Tooltip.Trigger>
            <Tooltip.Content side="bottom" sideOffset={-10}>
              {getCountInfo(jobInfo.projectCount, jobInfo.projectTotal)} Projects
            </Tooltip.Content>
          </Tooltip.Root>
        </Tooltip.Provider>
      </div>
    {/each}
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
