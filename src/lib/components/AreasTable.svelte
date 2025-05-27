<script lang="ts">
  import Time from "svelte-time";
  import * as Table from "$lib/components/ui/table/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { m } from "$paraglide";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { JobStatus } from "$lib/types";
  import { AreaType } from "$lib/types";
  import { Check, Cross, FolderGit2, Logs, Repeat, UsersRound, ChevronLeft, ChevronRight, Loader2 } from "lucide-svelte";
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
  const handleItemsPerPageChange = () => {
    currentPage = 1;
    fetchAreas(1, itemsPerPage);
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
        <span class="text-sm text-muted-foreground">Items per page:</span>
        <select
          bind:value={itemsPerPage}
          onchange={() => currentPage = 1}
          class="h-8 w-[70px] rounded-md border border-input bg-background px-2 py-1 text-sm"
        >
          {#each itemsPerPageOptions as option}
            <option value={option}>{option}</option>
          {/each}
        </select>
      </div>

      <div class="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!pagination?.hasPreviousPage || loading}
          onclick={() => handlePageChange(Math.max(1, currentPage - 1))}
          class="gap-1"
        >
          {#if loading}
            <Loader2 class="h-4 w-4 animate-spin" />
          {:else}
            <ChevronLeft class="h-4 w-4" />
          {/if}
          Previous
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
          class="gap-1"
        >
          Next
          {#if loading}
            <Loader2 class="h-4 w-4 animate-spin" />
          {:else}
            <ChevronRight class="h-4 w-4" />
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
