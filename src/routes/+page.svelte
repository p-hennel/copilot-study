<script lang="ts">
  import { Separator } from "$lib/components/ui/separator/index.js";
  import type { PageProps } from "./$types";
  let { data }: PageProps = $props();
  import Markdown from "svelte-exmarkdown";
  import { authClient } from "$lib/auth-client";
  import Gitlab from "$lib/components/Gitlab.svelte";
  import Jira from "$lib/components/Jira.svelte";
  import AuthProvider from "$lib/components/AuthProvider.svelte";
  import AuthProviderCard from "$lib/components/AuthProviderCard.svelte";
  import { JobStatus, TokenProvider } from "$lib/utils";
  import { number } from "$lib/paraglide/registry";
  import AreaCard from "$lib/components/AreaCard.svelte";
  import { m } from "$paraglide";
  import * as Accordion from "$lib/components/ui/accordion/index.js";

  let pageState = $state({
    loading: true,
    linkedAccounts: [] as string[]
  });

  authClient.listAccounts().then((x) => {
    if (!!x.data && x.data.length > 0) {
      pageState.linkedAccounts = x.data.map((x) => x.provider);
    }
    pageState.loading = false;
  });

  const nicerCounts = (count: number) => {
    if (count <= 0) return "no";
    else return `${count}`;
  };

  const isLoggedIn = $derived(!!data.session && !!data.session.userId);
  const jobsSummary = $derived.by(() => {
    return data.jobs.reduce(
      (ctr, item) => {
        if (!!item.status) ctr[item.status] = ctr[item.status] + 1;
        return ctr;
      },
      {
        [JobStatus.failed]: 0,
        [JobStatus.finished]: 0,
        [JobStatus.queued]: 0,
        [JobStatus.running]: 0
      }
    );
  });
</script>

<article class="prose dark:prose-invert mb-4">
  <h1 class="text-4xl font-extrabold">{m["home.title"]()}</h1>
  <p class="mb-0">
    {m["home.intro"]()}
  </p>
  {#if !!data.user && !!data.session}
    <Accordion.Root type="single" class="mt-0 w-full text-lg">
      <Accordion.Item value="explainer">
        <Accordion.Trigger class="pb-2 text-lg font-semibold">Read more...</Accordion.Trigger>
        <Accordion.Content class="prose dark:prose-invert m-0 p-0">
          <Markdown md={data.content} />
        </Accordion.Content>
      </Accordion.Item>
    </Accordion.Root>
  {:else}
    <Markdown md={data.content} />
    <Separator class="my-4" />
  {/if}
</article>

<div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
  <AuthProviderCard
    iconSize={10}
    class="xl:col-span-2"
    linkedAccounts={pageState.linkedAccounts}
    bind:loading={pageState.loading}
    textId="auth.login.action"
    doneTextId="auth.login.action_done"
    Icon={Gitlab}
    provider={TokenProvider.gitlab}
    {isLoggedIn}
    nextUrl="/"
  />
  <AuthProviderCard
    iconSize={10}
    class="xl:col-span-2"
    linkedAccounts={pageState.linkedAccounts}
    bind:loading={pageState.loading}
    textId="auth.login.action"
    doneTextId="auth.login.action_done"
    Icon={Jira}
    provider={TokenProvider.jiraCloud}
    {isLoggedIn}
    nextUrl="/"
  />
</div>

<Separator class="my-4" />

{#if !!data.areas && data.areas.length > 0}
  <div class="flex flex-wrap gap-4">
    {#each data.areas as area}
      <AreaCard {area} />
    {/each}
  </div>
{:else}
  <p>
    As soon as your account's areas (i.e., groups and projects) have been synchronized, you will see
    more information here.
  </p>
{/if}
<div class="mt-2 flex flex-wrap gap-4">
  <AreaCard
    area={{
      name: "test",
      full_path: "abc-def/ased",
      type: "project",
      jobsFinished: 1,
      jobsTotal: 10,
      gitlab_id: null
    }}
  />
  <AreaCard
    area={{
      name: "test",
      full_path: "abc-def/ased",
      type: "project",
      jobsFinished: 1,
      jobsTotal: 10,
      gitlab_id: null
    }}
  />
  <AreaCard
    area={{
      name: "test",
      full_path: "abc-def/ased",
      type: "project",
      jobsFinished: 1,
      jobsTotal: 10,
      gitlab_id: null
    }}
  />
  <AreaCard
    area={{
      name: "test",
      full_path: "abc-def/ased",
      type: "project",
      jobsFinished: 10,
      jobsTotal: 10,
      gitlab_id: null
    }}
  />
</div>

{#if !!data.jobs && data.jobs.length > 0}
  <Separator class="my-4" />
  <p>
    Directly associated with your accounts, {nicerCounts(jobsSummary[JobStatus.finished])} jobs have
    finished (and {nicerCounts(jobsSummary[JobStatus.finished])} have failed).
  </p>
  {#if jobsSummary[JobStatus.running] > 0 || jobsSummary[JobStatus.queued] > 0}
    <p>
      Currently, {nicerCounts(jobsSummary[JobStatus.running])} jobs are running, while {nicerCounts(
        jobsSummary[JobStatus.queued]
      )} are queued.
    </p>
  {/if}
{/if}
