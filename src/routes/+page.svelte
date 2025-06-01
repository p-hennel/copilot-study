<script lang="ts">
  import ProfileWidget from "$components/ProfileWidget.svelte";
  import StudyInfo from "$components/StudyInfo.svelte";
  import { Progress } from "$components/ui/progress";
  import { authClient } from "$lib/auth-client";
  import AreaCard from "$lib/components/AreaCard.svelte";
  import AuthProviderCard from "$lib/components/AuthProviderCard.svelte";
  import Gitlab from "$lib/components/Gitlab.svelte";
  import * as Accordion from "$lib/components/ui/accordion/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { JobStatus, TokenProvider, AreaType } from "$lib/types";
  import { m } from "$paraglide";
  import { FolderGit2, UsersRound, Search, ChevronLeft, ChevronRight, ChevronFirst, ChevronLast } from "lucide-svelte";
  import Time from "svelte-time/Time.svelte";
  import type { PageProps } from "./$types";
  let pageState = $state({
    loading: true,
    linkedAccounts: [] as string[]
  });

  // Enhanced areas display state
  let areasDisplayState = $state({
    searchQuery: "",
    filterType: "all" as "all" | "groups" | "projects" | "top-level",
    sortBy: "name" as "name" | "completion" | "type",
    sortOrder: "asc" as "asc" | "desc",
    currentPage: 1,
    itemsPerPage: 25
  });

  let { data }: PageProps = $props();

  $effect(() => {
    if (data.session && data.user && data.user.id) {
      authClient.listAccounts().then((x) => {
        if (!!x.data && x.data.length > 0) {
          pageState.linkedAccounts = x.data.map((x) => x.provider);
        }
        pageState.loading = false;
      });
    } else {
      pageState.loading = false;
    }
  });

  const nicerCounts = (count: number) => {
    if (count <= 0) return "no";
    else return `${count}`;
  };

  const isLoggedIn = $derived(!!data.session && !!data.session.userId);
  const jobsSummary = $derived.by(() => {
    return data.jobs.reduce(
      (ctr: any, item: any) => {
        if (item.status) ctr[item.status] = ctr[item.status] + 1;
        return ctr;
      },
      {
        [JobStatus.failed]: 0,
        [JobStatus.finished]: 0,
        [JobStatus.queued]: 0,
        [JobStatus.running]: 0,
        [JobStatus.paused]: 0 // Add paused status
      }
    );
  });

  const getProgressParams = (isComplete: boolean, count: number | null, total: number | null) => {
    const _total = normalizedTotal(count, total);
    if (isComplete)
      return {
        value: 100,
        max: 100
      };
    return {
      value: _total > 0 ? count : 0,
      max: _total > 0 ? _total : undefined
    };
  };

  const normalizedTotal = (count: number | null, total: number | null) => {
    if (!count || count <= 0 || !total || total <= 0 || count < total) return 0;
    return total;
  };

  const getCountInfo = (count: number | null, total: number | null) => {
    if (!count || count <= 0) count = 0;
    total = normalizedTotal(count, total);
    if (total <= 0 || count > total) return `${count}`;
    return `${count} / ${total}`;
  };

  // Enhanced areas filtering and sorting
  const filteredAndSortedAreas = $derived.by(() => {
    if (!data.areas || data.areas.length === 0) return [];

    let filtered = [...data.areas];

    // Debug logging - check actual data structure
    if (filtered.length > 0 && filtered[0]) {
      console.log('Sample area data:', {
        full_path: filtered[0].full_path,
        type: filtered[0].type,
        name: filtered[0].name
      });
      
      // Log unique types and sample full_paths
      const uniqueTypes = [...new Set(filtered.map(area => area.type))];
      const samplePaths = filtered.slice(0, 5).map(area => area.full_path);
      console.log('Unique area types:', uniqueTypes);
      console.log('Sample full_paths:', samplePaths);
    }

    // Search filter (fuzzy search in name and full_path)
    if (areasDisplayState.searchQuery.trim()) {
      const query = areasDisplayState.searchQuery.toLowerCase().trim();
      filtered = filtered.filter(area => {
        const name = (area.name || area.full_path).toLowerCase();
        const fullPath = area.full_path.toLowerCase();
        return name.includes(query) || fullPath.includes(query);
      });
    }

    // Type filter - Fixed to use string values instead of enum
    switch (areasDisplayState.filterType) {
      case "groups":
        filtered = filtered.filter(area => {
          const isGroup = area.type === "group";
          console.log(`Area ${area.full_path}: type="${area.type}", isGroup=${isGroup}`);
          return isGroup;
        });
        break;
      case "projects":
        filtered = filtered.filter(area => {
          const isProject = area.type === "project";
          console.log(`Area ${area.full_path}: type="${area.type}", isProject=${isProject}`);
          return isProject;
        });
        break;
      case "top-level":
        filtered = filtered.filter(area => {
          const isTopLevel = !area.full_path.includes('/');
          console.log(`Area ${area.full_path}: hasSlash=${area.full_path.includes('/')}, isTopLevel=${isTopLevel}`);
          return isTopLevel;
        });
        break;
      // "all" - no additional filtering
    }

    console.log(`Filter applied: ${areasDisplayState.filterType}, Results: ${filtered.length}/${data.areas.length}`);

    // Sorting
    filtered.sort((a, b) => {
      let comparison = 0;
      
      switch (areasDisplayState.sortBy) {
        case "name":
          const nameA = (a.name || a.full_path).toLowerCase();
          const nameB = (b.name || b.full_path).toLowerCase();
          comparison = nameA.localeCompare(nameB);
          break;
        case "completion":
          const completionA = a.jobsTotal > 0 ? a.jobsFinished / a.jobsTotal : 0;
          const completionB = b.jobsTotal > 0 ? b.jobsFinished / b.jobsTotal : 0;
          comparison = completionA - completionB;
          break;
        case "type":
          // Groups first, then projects - using string values
          if (a.type === "group" && b.type === "project") comparison = -1;
          else if (a.type === "project" && b.type === "group") comparison = 1;
          else comparison = (a.name || a.full_path).toLowerCase().localeCompare((b.name || b.full_path).toLowerCase());
          break;
      }

      return areasDisplayState.sortOrder === "desc" ? -comparison : comparison;
    });

    return filtered;
  });

  // Pagination calculations
  const totalFilteredAreas = $derived(filteredAndSortedAreas.length);
  const totalPages = $derived(Math.ceil(totalFilteredAreas / areasDisplayState.itemsPerPage));
  const startIndex = $derived((areasDisplayState.currentPage - 1) * areasDisplayState.itemsPerPage);
  const endIndex = $derived(Math.min(startIndex + areasDisplayState.itemsPerPage, totalFilteredAreas));
  const paginatedAreas = $derived(filteredAndSortedAreas.slice(startIndex, endIndex));

  // Debug pagination calculations
  $effect(() => {
    console.log('Pagination Debug:', {
      totalFilteredAreas,
      totalPages,
      currentPage: areasDisplayState.currentPage,
      itemsPerPage: areasDisplayState.itemsPerPage,
      startIndex,
      endIndex,
      paginatedAreasLength: paginatedAreas.length,
      displayStart: startIndex + 1,
      displayEnd: endIndex
    });
  });

  // Pagination handlers
  const handlePageChange = (newPage: number) => {
    areasDisplayState.currentPage = newPage;
  };

  const handleItemsPerPageChange = (value: string) => {
    areasDisplayState.itemsPerPage = parseInt(value, 10);
    areasDisplayState.currentPage = 1;
  };

  const handleFilterChange = (value: string) => {
    areasDisplayState.filterType = value as typeof areasDisplayState.filterType;
    areasDisplayState.currentPage = 1;
  };

  const handleSortChange = (value: string) => {
    const [sortBy, sortOrder] = value.split('-');
    areasDisplayState.sortBy = sortBy as typeof areasDisplayState.sortBy;
    areasDisplayState.sortOrder = sortOrder as typeof areasDisplayState.sortOrder;
    areasDisplayState.currentPage = 1;
  };

  // Reset page when search changes or when current page is beyond available pages
  $effect(() => {
    if (totalPages > 0 && areasDisplayState.currentPage > totalPages) {
      areasDisplayState.currentPage = 1;
    }
  });

  // Reset page when search query changes
  $effect(() => {
    if (areasDisplayState.searchQuery) {
      areasDisplayState.currentPage = 1;
    }
  });
</script>
<main class="container mx-auto px-4 py-8">
  <article class="prose mb-4 items-center">
    <ProfileWidget user={data.user} />

    <h1 class="text-4xl font-extrabold">{m["home.title"]()}</h1>

    {#if !!data.user && !!data.session}
      <!-- Use $page store -->
      <Accordion.Root type="single" class="mt-0 w-full text-lg">
        <Accordion.Item value="explainer">
          <Accordion.Trigger class="pb-2 text-lg font-semibold">Read more...</Accordion.Trigger>
          <Accordion.Content class="prose m-0 p-0">
            <StudyInfo contents={data.contents} user={data.user} />
          </Accordion.Content>
        </Accordion.Item>
      </Accordion.Root>
    {:else}
      <StudyInfo contents={data.contents} user={data.user} />
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
    {#if data.isDev}
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

    <!-- Areas Controls -->
    <div class="mb-6 space-y-4">
      <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <!-- Search Input -->
        <div class="relative flex-1 max-w-sm">
          <Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            bind:value={areasDisplayState.searchQuery}
            placeholder="Search areas..."
            class="pl-10"
          />
        </div>

        <!-- Controls Row -->
        <div class="flex flex-wrap gap-2">
          <!-- Filter -->
          <!--
          <Select.Root
            type="single"
            value={areasDisplayState.filterType}
            onValueChange={handleFilterChange}
          >
            <Select.Trigger class="w-[140px]">
              <span class="text-sm">
                {areasDisplayState.filterType === "all" ? "All Areas" :
                 areasDisplayState.filterType === "groups" ? "Groups Only" :
                 areasDisplayState.filterType === "projects" ? "Projects Only" : "Top Level"}
              </span>
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="all" label="All Areas" />
              <Select.Item value="groups" label="Groups Only" />
              <Select.Item value="projects" label="Projects Only" />
              <Select.Item value="top-level" label="Top Level Only" />
            </Select.Content>
          </Select.Root>
          -->
          <!-- Sort -->
          <Select.Root
            type="single"
            value={`${areasDisplayState.sortBy}-${areasDisplayState.sortOrder}`}
            onValueChange={handleSortChange}
          >
            <Select.Trigger class="w-[160px]">
              <span class="text-sm">
                {areasDisplayState.sortBy === "name" && areasDisplayState.sortOrder === "asc" ? "Name A-Z" :
                 areasDisplayState.sortBy === "name" && areasDisplayState.sortOrder === "desc" ? "Name Z-A" :
                 areasDisplayState.sortBy === "completion" && areasDisplayState.sortOrder === "asc" ? "Completion ↑" :
                 areasDisplayState.sortBy === "completion" && areasDisplayState.sortOrder === "desc" ? "Completion ↓" :
                 areasDisplayState.sortBy === "type" && areasDisplayState.sortOrder === "asc" ? "Type (Groups First)" : "Type (Projects First)"}
              </span>
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="name-asc" label="Name A-Z" />
              <Select.Item value="name-desc" label="Name Z-A" />
              <Select.Item value="completion-asc" label="Completion ↑" />
              <Select.Item value="completion-desc" label="Completion ↓" />
              <Select.Item value="type-asc" label="Type (Groups First)" />
              <Select.Item value="type-desc" label="Type (Projects First)" />
            </Select.Content>
          </Select.Root>

          <!-- Items per page -->
          <Select.Root
            type="single"
            value={`${areasDisplayState.itemsPerPage}`}
            onValueChange={handleItemsPerPageChange}
          >
            <Select.Trigger class="w-[80px]">
              <span class="text-sm">{areasDisplayState.itemsPerPage}</span>
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="10" label="10" />
              <Select.Item value="25" label="25" />
              <Select.Item value="50" label="50" />
            </Select.Content>
          </Select.Root>
        </div>
      </div>

      <!-- Results Info -->
      {#if totalFilteredAreas > 0 && (areasDisplayState.searchQuery || areasDisplayState.filterType !== "all")}
        <div class="text-sm text-muted-foreground">
          Showing {startIndex + 1} to {endIndex} of {totalFilteredAreas} areas
          {#if totalFilteredAreas !== data.areas.length}
            (filtered from {data.areas.length} total)
          {/if}
        </div>
      {/if}
    </div>

    <!-- Areas Grid -->
    {#if paginatedAreas.length > 0}
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
        {#each paginatedAreas as area, idx (area.full_path)}
          <AreaCard {area} />
        {/each}
      </div>

      <!-- Pagination Controls -->
      {#if totalFilteredAreas > 0 && totalPages > 1}
        <div class="mt-6 flex items-center justify-between">
          <div class="text-sm text-muted-foreground">
            Page {areasDisplayState.currentPage} of {totalPages}
          </div>
          
          <div class="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={areasDisplayState.currentPage === 1}
              onclick={() => handlePageChange(1)}
              class="w-8 h-8 p-0"
              aria-label="Go to first page"
            >
              <ChevronFirst class="h-4 w-4" />
            </Button>

            <Button
              variant="outline"
              size="sm"
              disabled={areasDisplayState.currentPage === 1}
              onclick={() => handlePageChange(Math.max(1, areasDisplayState.currentPage - 1))}
              class="w-8 h-8 p-0"
            >
              <ChevronLeft class="h-4 w-4" />
            </Button>

            <div class="flex items-center gap-1">
              {#each Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const start = Math.max(1, areasDisplayState.currentPage - 2);
                const end = Math.min(totalPages, start + 4);
                const adjustedStart = Math.max(1, end - 4);
                return adjustedStart + i;
              }) as pageNum}
                <Button
                  variant={areasDisplayState.currentPage === pageNum ? "default" : "outline"}
                  size="sm"
                  onclick={() => handlePageChange(pageNum)}
                  class="w-8 h-8 p-0"
                >
                  {pageNum}
                </Button>
              {/each}
            </div>

            <Button
              variant="outline"
              size="sm"
              disabled={areasDisplayState.currentPage === totalPages}
              onclick={() => handlePageChange(Math.min(totalPages, areasDisplayState.currentPage + 1))}
              class="w-8 h-8 p-0"
            >
              <ChevronRight class="h-4 w-4" />
            </Button>

            <Button
              variant="outline"
              size="sm"
              disabled={areasDisplayState.currentPage === totalPages}
              onclick={() => handlePageChange(totalPages)}
              class="w-8 h-8 p-0"
              aria-label="Go to last page"
            >
              <ChevronLast class="h-4 w-4" />
            </Button>
          </div>
        </div>
      {/if}
    {:else if totalFilteredAreas === 0}
      <div class="text-center py-8 text-muted-foreground">
        <p>No areas found matching your criteria.</p>
        {#if areasDisplayState.searchQuery || areasDisplayState.filterType !== "all"}
          <Button
            variant="outline"
            size="sm"
            class="mt-2"
            onclick={() => {
              areasDisplayState.searchQuery = "";
              areasDisplayState.filterType = "all";
              areasDisplayState.currentPage = 1;
            }}
          >
            Clear filters
          </Button>
        {/if}
      </div>
    {/if}
  {:else if data.session}
    <Separator class="my-4" />
    <div class="flex items-center justify-between">
      <p>
        As soon as your account's areas (i.e., groups and projects) have been synchronized, you will
        see more information here.
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
      {#each jobInfos as jobInfo (jobInfo.provider)}
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
                  created at: <Time timestamp={jobInfo.createdAt} relative={true} />
                </p>
              </Tooltip.Content>
            </Tooltip.Root>
          </Tooltip.Provider>
          <Tooltip.Provider>
            <Tooltip.Root>
              <Tooltip.Trigger class="flex w-full items-center gap-4">
                <UsersRound class="h-8 w-8" />
                <div class="flex-1">
                  <Progress
                    {...getProgressParams(jobInfo.isComplete, jobInfo.groupCount, jobInfo.groupTotal)}
                  />
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
                  <Progress
                    {...getProgressParams(
                      jobInfo.isComplete,
                      jobInfo.projectCount,
                      jobInfo.projectTotal
                    )}
                  />
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
            Directly associated with your accounts, {nicerCounts(jobsSummary[JobStatus.finished])} jobs
            have finished (and {nicerCounts(jobsSummary[JobStatus.finished])} have failed).
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
</main>