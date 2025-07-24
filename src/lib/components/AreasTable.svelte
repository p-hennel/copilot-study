<script lang="ts">
  import Time from "svelte-time";
  import * as Table from "$lib/components/ui/table/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import { m } from "$paraglide";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { JobStatus } from "$lib/types";
  import { AreaType } from "$lib/types";
  import { Check, Cross, FolderGit2, Logs, Repeat, UsersRound, ChevronLeft, ChevronRight, ChevronFirst, ChevronLast, Loader2 } from "lucide-svelte";
  import { authClient } from "$lib/auth-client";
  import { goto } from "$app/navigation";
  import { toast } from "svelte-sonner";

  // Updated type to match API response from /api/admin/areas
  type AreaInformation = {
    fullPath: string;
    gitlabId: string; // Added
    name: string | null; // Allow null
    type: AreaType;
    createdAt: Date;
    countAccounts: number;
    countJobs: number;
  };

  type PaginatedAreasResponse = {
    data: AreaInformation[];
    pagination: {
      page: number;
      limit: number;
      totalCount: number;
      totalPages: number;
      hasNextPage: boolean;
      hasPreviousPage: boolean;
    };
  };

  type AreaTableProps = {
    format?: string;
    initialData?: AreaInformation[]; // For backward compatibility
  };

  let props: AreaTableProps = $props();
  const format = $derived(props.format ?? "DD. MMM, HH:mm");

  // Pagination state
  let currentPage = $state(1);
  let itemsPerPage = $state(25);
  let itemsPerPageOptions = [10, 25, 50, 100];
  let loading = $state(false);
  let recrawlLoading = $state<Record<string, boolean>>({});
  let areasData = $state<PaginatedAreasResponse | null>(null);

  // Fetch areas data from API
  const fetchAreas = async (page: number = currentPage, limit: number = itemsPerPage) => {
    try {
      loading = true;
      const token = (await authClient.getSession())?.data?.session.token;
      if (!token) {
        await goto("/admin/sign-in");
        throw new Error("No authentication token");
      }

      const response = await fetch(`/api/admin/areas?page=${page}&limit=${limit}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch areas: ${response.statusText}`);
      }

      const data = await response.json() as PaginatedAreasResponse;
      areasData = data;
    } catch (error) {
      console.error("Error fetching areas:", error);
      toast.error("Failed to fetch areas", {
        description: error instanceof Error ? error.message : "An unknown error occurred"
      });
    } finally {
      loading = false;
    }
  };

  // Initial load and reactive updates
  $effect(() => {
    fetchAreas(currentPage, itemsPerPage);
  });

  // Handle page changes
  const handlePageChange = (newPage: number) => {
    currentPage = newPage;
  };

  // Handle items per page change
  const handleItemsPerPageChange = (val:string|undefined = undefined) => {
    if (val) {
      itemsPerPage = parseInt(val, 10);
    }
    currentPage = 1;
    fetchAreas(1, itemsPerPage);
  };

  // Handle re-crawl action
  const handleRecrawl = async (fullPath: string) => {
    try {
      recrawlLoading[fullPath] = true;
      const token = (await authClient.getSession())?.data?.session.token;
      if (!token) {
        await goto("/admin/sign-in");
        throw new Error("No authentication token");
      }

      const response = await fetch(`/api/admin/areas/recrawl`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ fullPath })
      });

      if (!response.ok) {
        throw new Error(`Failed to re-crawl area: ${response.statusText}`);
      }

      const result = await response.json();
      toast.success("Re-crawl initiated", {
        description: `${result.jobsCreated} jobs created for ${fullPath}`
      });

      // Refresh the areas data to show updated job counts
      await fetchAreas(currentPage, itemsPerPage);
    } catch (error) {
      console.error("Error re-crawling area:", error);
      toast.error("Failed to re-crawl area", {
        description: error instanceof Error ? error.message : "An unknown error occurred"
      });
    } finally {
      recrawlLoading[fullPath] = false;
    }
  };

  // Derived values for display
  const areas = $derived(areasData?.data || []);
  const pagination = $derived(areasData?.pagination);
  const totalItems = $derived(pagination?.totalCount || 0);
  const totalPages = $derived(pagination?.totalPages || 0);
  const startIndex = $derived(pagination ? (pagination.page - 1) * pagination.limit : 0);
  const endIndex = $derived(pagination ? Math.min(startIndex + pagination.limit, pagination.totalCount) : 0);
</script>

<Table.Root class="w-full gap-0.5">
  <Table.Header>
    <Table.Row>
      <Table.Head class="w-[2.5rem] text-right"
        >{m["admin.dashboard.areasTable.header.idx"]()}</Table.Head
      >
      <Table.Head>{m["admin.dashboard.areasTable.header.id"]()}</Table.Head>
      <Table.Head>{m["admin.dashboard.areasTable.header.name"]()}</Table.Head>
      <Table.Head>{m["admin.dashboard.areasTable.header.type"]()}</Table.Head>
      <Table.Head class="text-center"
        >{m["admin.dashboard.areasTable.header.created_at"]()}</Table.Head
      >
      <Table.Head class="text-end"
        >{m["admin.dashboard.areasTable.header.countAccounts"]()}</Table.Head
      >
      <Table.Head class="text-end">{m["admin.dashboard.areasTable.header.countJobs"]()}</Table.Head>
      <Table.Head class="text-center">Actions</Table.Head>
    </Table.Row>
  </Table.Header>
  <Table.Body>
    {#each areas as area, idx (area.fullPath)}
      <!-- Add key -->
      <Table.Row>
        <Table.Cell class="text-right">{startIndex + idx + 1}</Table.Cell>
        <Table.Cell class="font-mono">{area.fullPath}</Table.Cell>
        <Table.Cell>{area.name}</Table.Cell>
        <Table.Cell>
          <Tooltip.Provider delayDuration={0}>
            <Tooltip.Root>
              <Tooltip.Trigger>
                {#if area.type === AreaType.group}
                  <UsersRound />
                {:else if area.type === AreaType.project}
                  <FolderGit2 />
                {/if}
              </Tooltip.Trigger>
              <Tooltip.Content class="font-mono">
                {`${area.type.substring(0, 1).toUpperCase()}${area.type.substring(1)}`}
              </Tooltip.Content>
            </Tooltip.Root>
          </Tooltip.Provider>
        </Table.Cell>
        <Table.Cell class="text-center">
          <Time timestamp={area.createdAt} {format} />
        </Table.Cell>
        <Table.Cell class="text-end">{area.countAccounts}</Table.Cell>
        <Table.Cell class="text-end">{area.countJobs}</Table.Cell>
        <Table.Cell class="text-center">
          <Button
            variant="outline"
            size="sm"
            onclick={() => handleRecrawl(area.fullPath)}
            disabled={loading || recrawlLoading[area.fullPath]}
            class="gap-1"
          >
            {#if recrawlLoading[area.fullPath]}
              <Loader2 class="h-3 w-3 animate-spin" />
            {:else}
              <Repeat class="h-3 w-3" />
            {/if}
            Re-crawl
          </Button>
        </Table.Cell>
      </Table.Row>
    {/each}
  </Table.Body>
</Table.Root>

<!-- Pagination Controls -->
{#if totalPages > 1}
  <div class="mt-4 flex items-center justify-between">
    <div class="flex items-center gap-2 text-sm text-muted-foreground">
      <span>
        Showing {startIndex + 1} to {endIndex} of {totalItems} areas
      </span>
    </div>
    
    <div class="flex items-center gap-6">
      <div class="flex items-center gap-2">
        <Select.Root
          type="single"
          onValueChange={(v) => {currentPage = 1; handleItemsPerPageChange(v)}}
          value={`${itemsPerPage}`}
          >
          <Select.Trigger>
            <span class="text-sm text-muted-foreground">
              Items per page: {itemsPerPage}
            </span>
          </Select.Trigger>
          <Select.Content>
            {#each itemsPerPageOptions as option}
              <Select.Item value={`${option}`} label={`${option}`} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

      <div class="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={currentPage === 1 || loading}
          onclick={() => handlePageChange(1)}
          class="w-8 h-8 p-0"
          aria-label="Go to first page"
        >
          {#if loading}
            <Loader2 class="h-4 w-4 animate-spin" />
          {:else}
            <ChevronFirst class="h-4 w-4" />
          {/if}
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={!pagination?.hasPreviousPage || loading}
          onclick={() => handlePageChange(Math.max(1, currentPage - 1))}
          class="w-8 h-8 p-0"
        >
          {#if loading}
            <Loader2 class="h-4 w-4 animate-spin" />
          {:else}
            <ChevronLeft class="h-4 w-4" />
          {/if}
        </Button>

        <div class="flex items-center gap-1">
          {#each Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            const start = Math.max(1, currentPage - 2);
            const end = Math.min(totalPages, start + 4);
            const adjustedStart = Math.max(1, end - 4);
            return adjustedStart + i;
          }) as pageNum}
            <Button
              variant={currentPage === pageNum ? "default" : "outline"}
              size="sm"
              onclick={() => handlePageChange(pageNum)}
              disabled={loading}
              class="w-8 h-8 p-0"
            >
              {pageNum}
            </Button>
          {/each}
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={!pagination?.hasNextPage || loading}
          onclick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
          class="w-8 h-8 p-0"
        >
          {#if loading}
            <Loader2 class="h-4 w-4 animate-spin" />
          {:else}
            <ChevronRight class="h-4 w-4" />
          {/if}
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={currentPage === totalPages || loading}
          onclick={() => handlePageChange(totalPages)}
          class="w-8 h-8 p-0"
          aria-label="Go to last page"
        >
          {#if loading}
            <Loader2 class="h-4 w-4 animate-spin" />
          {:else}
            <ChevronLast class="h-4 w-4" />
          {/if}
        </Button>
      </div>
    </div>
  </div>
{:else}
  <div class="mt-4 text-sm text-muted-foreground">
    Showing {totalItems} area{totalItems === 1 ? '' : 's'}
  </div>
{/if}
