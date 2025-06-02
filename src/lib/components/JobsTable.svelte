<script lang="ts">
  import Time from "svelte-time";
  import * as Table from "$lib/components/ui/table/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import * as Checkbox from "$lib/components/ui/checkbox/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import { Button } from "$ui/button";
  import { Input } from "$ui/input";
  import { m } from "$paraglide";
  import { JobStatus, CrawlCommand } from "$lib/types";
  import type { AreaType } from "$lib/types";
  import type { JobsQueryParams, JobsApiResponse, JobInformation as ApiJobInformation } from "$lib/types/jobs-api";
  import { Check, Cross, Logs, Repeat, Trash2, AlertTriangle, Minus, ChevronLeft, ChevronRight, ChevronFirst, ChevronLast, Loader2, Search, Filter, SortAsc, SortDesc, X } from "lucide-svelte";
  import LoadingButton from "./LoadingButton.svelte";
  import { authClient } from "$lib/auth-client";
  import { goto } from "$app/navigation";
  import { toast } from "svelte-sonner";
  import Highlight, { LineNumbers } from "svelte-highlight";
  import json from "svelte-highlight/languages/json";
  import horizonDark from "svelte-highlight/styles/horizon-dark";

  type JobInformation = {
    id: string;
    provider: string;
    created_at: Date;
    updated_at?: Date;
    full_path: string;
    status: JobStatus;
    command: CrawlCommand;
    started_at?: Date;
    finished_at?: Date;
    branch: string;
    childrenCount: number | null;
    fromJob: {
      id: string;
      command: CrawlCommand;
      status: JobStatus;
      started_at: Date;
      finished_at: Date;
    } | null;
    forArea: {
      full_path: string;
      type: AreaType;
      name: string;
      gitlab_id: string;
      created_at: Date;
    } | null;
    resumeState?: Record<
      string,
      { afterCursor?: string; errorCount?: number; lastAttempt?: number }
    > | null; // Added resumeState
  };

  // Use the enhanced API types
  type PaginatedJobsResponse = JobsApiResponse;

  type JobsTableProps = {
    format?: string;
    onRefresh?: () => Promise<void>;
    initialJobs?: JobInformation[]; // For backward compatibility
  };

  let props: JobsTableProps = $props();
  const format = $derived(props.format ?? "DD. MMM, HH:mm");
  const formatTooltip = $derived(props.format ?? "DD. MMM YYYY, HH:mm:ss");

  // Enhanced state management for Phase 2
  let loading = $state(false);
  let jobsData = $state<PaginatedJobsResponse | null>(null);
  
  // Selection state - works across all pages
  let selectedJobIds = $state<Set<string>>(new Set());

  // Query parameters state
  let queryParams = $state<JobsQueryParams>({
    page: 1,
    limit: 25,
    sortBy: 'created',
    sortOrder: 'desc'
  });

  // Search and filter state
  let searchText = $state('');
  let dateSearchText = $state('');
  let selectedCommands = $state<CrawlCommand[]>([]);
  let selectedStatuses = $state<JobStatus[]>([]);
  let hasStartedFilter = $state<boolean | undefined>(undefined);
  let hasFinishedFilter = $state<boolean | undefined>(undefined);
  let hasParentFilter = $state<boolean | undefined>(undefined);

  // Debounced search
  let searchTimeout: number | undefined;
  let dateSearchTimeout: number | undefined;

  // UI state
  let showFilters = $state(false);
  let itemsPerPageOptions = [10, 25, 50, 100];
  
  // Derived values for current page
  const jobs = $derived(jobsData?.data || []);
  const pagination = $derived(jobsData?.pagination);
  const totalItems = $derived(pagination?.totalCount || 0);
  const totalPages = $derived(pagination?.totalPages || 0);
  const startIndex = $derived(pagination ? (pagination.page - 1) * pagination.limit : 0);
  const endIndex = $derived(pagination ? Math.min(startIndex + pagination.limit, pagination.totalCount) : 0);
  const currentPage = $derived(queryParams.page ?? 1);
  const itemsPerPage = $derived(queryParams.limit ?? 25);

  // Filter summary
  const activeFiltersCount = $derived(() => {
    let count = 0;
    if (searchText.trim()) count++;
    if (dateSearchText.trim()) count++;
    if (selectedCommands.length > 0) count++;
    if (selectedStatuses.length > 0) count++;
    if (hasStartedFilter !== undefined) count++;
    if (hasFinishedFilter !== undefined) count++;
    if (hasParentFilter !== undefined) count++;
    return count;
  });

  // Available options for filters
  const commandOptions = Object.values(CrawlCommand).map(cmd => ({ value: cmd, label: cmd }));
  const statusOptions = Object.values(JobStatus).map(status => ({ value: status, label: status }));
  const dateFieldOptions = [
    { value: 'created', label: 'Created' },
    { value: 'updated', label: 'Updated' },
    { value: 'started', label: 'Started' },
    { value: 'finished', label: 'Finished' }
  ];
  const sortableFields = [
    { value: 'created', label: 'Created' },
    { value: 'updated', label: 'Updated' },
    { value: 'started', label: 'Started' },
    { value: 'finished', label: 'Finished' },
    { value: 'id', label: 'ID' },
    { value: 'parent', label: 'Parent' },
    { value: 'status', label: 'Status' },
    { value: 'command', label: 'Command' }
  ];

  const allVisibleSelected = $derived(
    jobs.length > 0 && jobs.every(job => selectedJobIds.has(job.id))
  );
  const someVisibleSelected = $derived(
    jobs.some(job => selectedJobIds.has(job.id)) && !allVisibleSelected
  );

  // Enhanced fetch jobs function with query parameters
  const fetchJobs = async (params: JobsQueryParams = queryParams) => {
    try {
      loading = true;
      const token = (await authClient.getSession())?.data?.session.token;
      if (!token) {
        await goto("/admin/sign-in");
        throw new Error("No authentication token");
      }

      // Build the API URL with parameters
      const url = new URL('/api/admin/jobs', window.location.origin);
      
      // Add pagination
      if (params.page && params.page > 1) {
        url.searchParams.set('page', params.page.toString());
      }
      if (params.limit && params.limit !== 25) {
        url.searchParams.set('limit', params.limit.toString());
      }
      
      // Add sorting
      if (params.sortBy && params.sortBy !== 'created') {
        url.searchParams.set('sortBy', params.sortBy);
      }
      if (params.sortOrder && params.sortOrder !== 'desc') {
        url.searchParams.set('sortOrder', params.sortOrder);
      }
      
      // Add filters
      if (params.command) {
        const commands = Array.isArray(params.command) ? params.command : [params.command];
        url.searchParams.set('command', commands.join(','));
      }
      if (params.status) {
        const statuses = Array.isArray(params.status) ? params.status : [params.status];
        url.searchParams.set('status', statuses.join(','));
      }
      if (params.hasStarted !== undefined) {
        url.searchParams.set('hasStarted', params.hasStarted.toString());
      }
      if (params.hasFinished !== undefined) {
        url.searchParams.set('hasFinished', params.hasFinished.toString());
      }
      if (params.hasParent !== undefined) {
        url.searchParams.set('hasParent', params.hasParent.toString());
      }
      
      // Add search
      if (params.search) {
        url.searchParams.set('search', params.search);
      }
      if (params.dateSearch) {
        url.searchParams.set('dateSearch', params.dateSearch);
      }
      if (params.dateField && params.dateField !== 'created') {
        url.searchParams.set('dateField', params.dateField);
      }
      
      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch jobs: ${response.statusText}`);
      }

      const data = await response.json() as PaginatedJobsResponse;
      jobsData = data;
    } catch (error) {
      console.error("Error fetching jobs:", error);
      toast.error("Failed to fetch jobs", {
        description: error instanceof Error ? error.message : "An unknown error occurred"
      });
    } finally {
      loading = false;
    }
  };

  // Build query parameters from current state
  const buildQueryParams = (): JobsQueryParams => {
    const params: JobsQueryParams = {
      page: queryParams.page,
      limit: queryParams.limit,
      sortBy: queryParams.sortBy,
      sortOrder: queryParams.sortOrder
    };

    // Add search parameters
    if (searchText.trim()) {
      params.search = searchText.trim();
    }
    
    if (dateSearchText.trim()) {
      params.dateSearch = dateSearchText.trim();
      params.dateField = queryParams.dateField || 'created';
    }

    // Add filter parameters
    if (selectedCommands.length > 0) {
      params.command = selectedCommands;
    }
    
    if (selectedStatuses.length > 0) {
      params.status = selectedStatuses;
    }

    if (hasStartedFilter !== undefined) {
      params.hasStarted = hasStartedFilter;
    }
    
    if (hasFinishedFilter !== undefined) {
      params.hasFinished = hasFinishedFilter;
    }
    
    if (hasParentFilter !== undefined) {
      params.hasParent = hasParentFilter;
    }
    return params;
  };

  // Debounced search functions
  const debouncedSearch = () => {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      queryParams.page = 1; // Reset to page 1 on search
      const params = buildQueryParams();
      queryParams = { ...params };
      fetchJobs(params);
    }, 300) as any;
  };

  const debouncedDateSearch = () => {
    if (dateSearchTimeout) clearTimeout(dateSearchTimeout);
    dateSearchTimeout = setTimeout(() => {
      queryParams.page = 1; // Reset to page 1 on search
      const params = buildQueryParams();
      queryParams = { ...params };
      fetchJobs(params);
    }, 300) as any;
  };

  // Filter change handlers
  const handleFilterChange = () => {
    queryParams.page = 1; // Reset to page 1 on filter change
    const params = buildQueryParams();
    queryParams = { ...params };
    fetchJobs(params);
  };

  // Sort change handler
  const handleSort = (field: string) => {
    if (queryParams.sortBy === field) {
      queryParams.sortOrder = queryParams.sortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      queryParams.sortBy = field as any;
      queryParams.sortOrder = 'desc';
    }
    queryParams.page = 1; // Reset to page 1 on sort change
    const params = buildQueryParams();
    queryParams = { ...params };
    fetchJobs(params);
  };

  // Clear all filters
  const clearAllFilters = () => {
    searchText = '';
    dateSearchText = '';
    selectedCommands = [];
    selectedStatuses = [];
    hasStartedFilter = undefined;
    hasFinishedFilter = undefined;
    hasParentFilter = undefined;
    queryParams = {
      page: 1,
      limit: queryParams.limit,
      sortBy: 'created',
      sortOrder: 'desc'
    };
    fetchJobs(queryParams);
  };

  // Initial load
  $effect(() => {
    fetchJobs(queryParams);
  });

  // Watch for search text changes
  $effect(() => {
    if (searchText !== undefined) {
      debouncedSearch();
    }
  });

  // Watch for date search text changes
  $effect(() => {
    if (dateSearchText !== undefined) {
      debouncedDateSearch();
    }
  });

  // Handle page changes
  const handlePageChange = (newPage: number) => {
    queryParams.page = newPage;
    const params = buildQueryParams();
    queryParams = { ...params };
    fetchJobs(params);
  };

  // Handle items per page change
  const handleItemsPerPageChange = (val: string | undefined = undefined) => {
    if (val) {
      queryParams.limit = parseInt(val, 10);
      queryParams.page = 1;
      const params = buildQueryParams();
      queryParams = { ...params };
      fetchJobs(params);
    }
  };

  // Refresh function for external calls
  const refreshJobs = async () => {
    const params = buildQueryParams();
    await fetchJobs(params);
    if (props.onRefresh) {
      await props.onRefresh();
    }
  };

  // Dialog states
  let deleteDialogOpen = $state(false);
  let deleteAllDialogOpen = $state(false);
  let bulkDeleteDialogOpen = $state(false);
  let jobToDelete = $state<string | null>(null);
  let deleteAllConfirmText = $state("");

  const statusToIcon = (status: JobStatus) => {
    switch (status) {
      case JobStatus.queued:
        return Logs;
      case JobStatus.running:
        return Repeat;
      case JobStatus.failed:
        return Cross;
      case JobStatus.finished:
        return Check;
    }
  };

  const handleSelectAll = () => {
    if (allVisibleSelected) {
      // Remove all visible jobs from selection
      jobs.forEach(job => selectedJobIds.delete(job.id));
      selectedJobIds = new Set(selectedJobIds); // Trigger reactivity
    } else {
      // Add all visible jobs to selection
      jobs.forEach(job => selectedJobIds.add(job.id));
      selectedJobIds = new Set(selectedJobIds); // Trigger reactivity
    }
  };

  const handleSelectJob = (jobId: string, checked: boolean) => {
    if (checked) {
      selectedJobIds.add(jobId);
    } else {
      selectedJobIds.delete(jobId);
    }
    selectedJobIds = new Set(selectedJobIds); // Trigger reactivity
  };

  const getAuthToken = async () => {
    const token = (await authClient.getSession())?.data?.session.token;
    if (!token) {
      await goto("/admin/sign-in");
      throw new Error("No authentication token");
    }
    return token;
  };


  const deleteJob = async (jobId: string) => {
    try {
      const token = await getAuthToken();
      const response = await fetch(`/api/admin/jobs?id=${jobId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      const result = await response.json() as { error?: string; success?: boolean; message?: string };

      if (!response.ok) {
        throw new Error(result.error || "Failed to delete job");
      }

      toast.success("Job deleted successfully", {
        description: `Job ${jobId} has been deleted`
      });

      await refreshJobs();
    } catch (error) {
      console.error("Error deleting job:", error);
      toast.error("Failed to delete job", {
        description: error instanceof Error ? error.message : "An unknown error occurred"
      });
    }
  };

  const deleteSelectedJobs = async () => {
    try {
      const token = await getAuthToken();
      const response = await fetch("/api/admin/jobs", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "bulk_delete",
          jobIds: Array.from(selectedJobIds)
        })
      });

      const result = await response.json() as { error?: string; success?: boolean; deletedCount?: number; message?: string };

      if (!response.ok) {
        throw new Error(result.error || "Failed to delete selected jobs");
      }

      toast.success("Selected jobs deleted successfully", {
        description: `${result.deletedCount || 0} jobs have been deleted`
      });

      selectedJobIds = new Set(); // Create new Set to trigger reactivity
      await refreshJobs();
    } catch (error) {
      console.error("Error deleting selected jobs:", error);
      toast.error("Failed to delete selected jobs", {
        description: error instanceof Error ? error.message : "An unknown error occurred"
      });
    }
  };

  const deleteAllJobs = async () => {
    try {
      const token = await getAuthToken();
      const response = await fetch("/api/admin/jobs/bulk", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          confirm: true,
          confirmPhrase: "DELETE ALL JOBS"
        })
      });

      const result = await response.json() as { error?: string; success?: boolean; deletedCount?: number; message?: string };

      if (!response.ok) {
        throw new Error(result.error || "Failed to delete all jobs");
      }

      toast.success("All jobs deleted successfully", {
        description: `${result.deletedCount || 0} jobs have been deleted`
      });

      selectedJobIds = new Set(); // Create new Set to trigger reactivity
      await refreshJobs();
    } catch (error) {
      console.error("Error deleting all jobs:", error);
      toast.error("Failed to delete all jobs", {
        description: error instanceof Error ? error.message : "An unknown error occurred"
      });
    }
  };

  const openDeleteDialog = (jobId: string) => {
    jobToDelete = jobId;
    deleteDialogOpen = true;
  };

  const confirmDelete = async () => {
    if (jobToDelete) {
      await deleteJob(jobToDelete);
      deleteDialogOpen = false;
      jobToDelete = null;
    }
  };

  const confirmBulkDelete = async () => {
    await deleteSelectedJobs();
    bulkDeleteDialogOpen = false;
  };

  const confirmDeleteAll = async () => {
    if (deleteAllConfirmText === "DELETE ALL JOBS") {
      await deleteAllJobs();
      deleteAllDialogOpen = false;
      deleteAllConfirmText = "";
    }
  };

  const truncate = (text: string, n: number = 24) => {
    return (text.length > n) ? text.slice(0, n-1) + '…' : text;
  }
</script>

<svelte:head>
  {@html horizonDark}
</svelte:head>

<!-- Bulk Actions Button -->
{#if totalItems > 0}
  <div class="mb-4 flex justify-end">
    <Button
      variant="destructive"
      onclick={() => {
        deleteAllDialogOpen = true;
      }}
    >
      <Trash2 class="h-4 w-4" />
      Delete All Jobs
    </Button>
  </div>
{/if}

<!-- Search and Filter Controls -->
<div class="mb-6 space-y-4">
  <!-- Search Section -->
  <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
    <!-- Global Search -->
    <div class="flex-1">
      <div class="relative">
        <Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          bind:value={searchText}
          placeholder="Search jobs, paths, branches..."
          class="pl-10"
        />
      </div>
    </div>

    <!-- Date Search -->
    <div class="flex items-center gap-2">
      <Select.Root
        type="single"
        value={queryParams.dateField || 'created'}
        onValueChange={(value) => {
          if (value) {
            queryParams.dateField = value as any;
            if (dateSearchText.trim()) {
              handleFilterChange();
            }
          }
        }}
      >
        <Select.Trigger class="w-24">
          {queryParams.dateField || 'created'}
        </Select.Trigger>
        <Select.Content>
          {#each dateFieldOptions as option}
            <Select.Item value={option.value} label={option.label} />
          {/each}
        </Select.Content>
      </Select.Root>
      <Input
        bind:value={dateSearchText}
        placeholder="Fuzzy date search (e.g., 'yesterday', '2 hours ago')"
        class="w-64"
      />
    </div>

    <!-- Sort Controls -->
    <div class="flex items-center gap-2">
      <Select.Root
        type="single"
        value={queryParams.sortBy || 'created'}
        onValueChange={(value) => {
          console.log('Sort field changed to:', value);
          if (value) {
            queryParams.sortBy = value as any;
            queryParams.page = 1;
            const params = buildQueryParams();
            queryParams = { ...params };
            fetchJobs(params);
          }
        }}
      >
        <Select.Trigger class="w-32">
          Sort: {queryParams.sortBy || 'created'}
        </Select.Trigger>
        <Select.Content>
          {#each sortableFields as field}
            <Select.Item value={field.value} label={field.label} />
          {/each}
        </Select.Content>
      </Select.Root>
      
      <Select.Root
        type="single"
        value={queryParams.sortOrder || 'desc'}
        onValueChange={(value) => {
          console.log('Sort order changed to:', value);
          if (value) {
            queryParams.sortOrder = value as any;
            queryParams.page = 1;
            const params = buildQueryParams();
            queryParams = { ...params };
            fetchJobs(params);
          }
        }}
      >
        <Select.Trigger class="w-20">
          {#if queryParams.sortOrder === 'asc'}
            <SortAsc class="h-4 w-4" />
          {:else}
            <SortDesc class="h-4 w-4" />
          {/if}
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="asc" label="Ascending" />
          <Select.Item value="desc" label="Descending" />
        </Select.Content>
      </Select.Root>
    </div>

    <!-- Filter Toggle -->
    <Button
      variant={showFilters ? "default" : "outline"}
      onclick={() => showFilters = !showFilters}
      class="shrink-0"
    >
      <Filter class="h-4 w-4" />
      Filters
      {#if activeFiltersCount() > 0}
        <span class="ml-1 rounded-full bg-primary-foreground px-1.5 py-0.5 text-xs text-primary">
          {activeFiltersCount()}
        </span>
      {/if}
    </Button>
  </div>

  <!-- Advanced Filters (Collapsible) -->
  {#if showFilters}
    <div class="rounded-lg border bg-muted/30 p-4">
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <!-- Command Filter -->
        <div class="space-y-2">
          <label class="text-sm font-medium">Commands ({selectedCommands.length} selected)</label>
          <div class="max-h-32 overflow-y-auto rounded-md border bg-background p-2">
            <div class="space-y-1">
              {#each commandOptions as option}
                <label class="flex items-center space-x-2">
                  <Checkbox.Root
                    checked={selectedCommands.includes(option.value)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        selectedCommands = [...selectedCommands, option.value];
                      } else {
                        selectedCommands = selectedCommands.filter(cmd => cmd !== option.value);
                      }
                      handleFilterChange();
                    }}
                  />
                  <span class="text-sm">{option.label}</span>
                </label>
              {/each}
            </div>
          </div>
        </div>

        <!-- Status Filter -->
        <div class="space-y-2">
          <label class="text-sm font-medium">Status ({selectedStatuses.length} selected)</label>
          <div class="space-y-1">
            {#each statusOptions as option}
              <label class="flex items-center space-x-2">
                <Checkbox.Root
                  checked={selectedStatuses.includes(option.value)}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      selectedStatuses = [...selectedStatuses, option.value];
                    } else {
                      selectedStatuses = selectedStatuses.filter(status => status !== option.value);
                    }
                    handleFilterChange();
                  }}
                />
                <span class="text-sm">{option.label}</span>
              </label>
            {/each}
          </div>
        </div>

        <!-- Boolean Filters -->
        <div class="space-y-2">
          <label class="text-sm font-medium">Execution State</label>
          <div class="space-y-2">
            <Select.Root
              type="single"
              value={hasStartedFilter === undefined ? 'any' : hasStartedFilter ? 'true' : 'false'}
              onValueChange={(value) => {
                if (value === 'any') {
                  hasStartedFilter = undefined;
                } else if (value === 'true') {
                  hasStartedFilter = true;
                } else if (value === 'false') {
                  hasStartedFilter = false;
                }
                handleFilterChange();
              }}
            >
              <Select.Trigger>
                Has started: {hasStartedFilter === undefined ? 'Any' : hasStartedFilter ? 'Yes' : 'No'}
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="any" label="Any" />
                <Select.Item value="true" label="Yes" />
                <Select.Item value="false" label="No" />
              </Select.Content>
            </Select.Root>
          </div>
        </div>

        <div class="space-y-2">
          <label class="text-sm font-medium">Completion State</label>
          <Select.Root
            type="single"
            value={hasFinishedFilter === undefined ? 'any' : hasFinishedFilter ? 'true' : 'false'}
            onValueChange={(value) => {
              if (value === 'any') {
                hasFinishedFilter = undefined;
              } else if (value === 'true') {
                hasFinishedFilter = true;
              } else if (value === 'false') {
                hasFinishedFilter = false;
              }
              handleFilterChange();
            }}
          >
            <Select.Trigger>
              Has finished: {hasFinishedFilter === undefined ? 'Any' : hasFinishedFilter ? 'Yes' : 'No'}
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="any" label="Any" />
              <Select.Item value="true" label="Yes" />
              <Select.Item value="false" label="No" />
            </Select.Content>
          </Select.Root>
        </div>

        <div class="space-y-2">
          <label class="text-sm font-medium">Parent Relationship</label>
          <Select.Root
            type="single"
            value={hasParentFilter === undefined ? 'any' : hasParentFilter ? 'true' : 'false'}
            onValueChange={(value) => {
              if (value === 'any') {
                hasParentFilter = undefined;
              } else if (value === 'true') {
                hasParentFilter = true;
              } else if (value === 'false') {
                hasParentFilter = false;
              }
              handleFilterChange();
            }}
          >
            <Select.Trigger>
              Has parent: {hasParentFilter === undefined ? 'Any' : hasParentFilter ? 'Yes' : 'No'}
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="any" label="Any" />
              <Select.Item value="true" label="Yes" />
              <Select.Item value="false" label="No" />
            </Select.Content>
          </Select.Root>
        </div>

        <!-- Clear Filters Button -->
        <div class="space-y-2">
          <label class="text-sm font-medium opacity-0">Actions</label>
          <Button
            variant="outline"
            onclick={clearAllFilters}
            disabled={activeFiltersCount() === 0}
            class="w-full"
          >
            <X class="h-4 w-4" />
            Clear All Filters
          </Button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Active Filters Summary -->
  {#if activeFiltersCount() > 0}
    <div class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span>Active filters:</span>
      {#if searchText.trim()}
        <span class="rounded bg-primary/10 px-2 py-1">Search: "{searchText.trim()}"</span>
      {/if}
      {#if dateSearchText.trim()}
        <span class="rounded bg-primary/10 px-2 py-1">Date: "{dateSearchText.trim()}" in {queryParams.dateField || 'created'}</span>
      {/if}
      {#if selectedCommands.length > 0}
        <span class="rounded bg-primary/10 px-2 py-1">Commands: {selectedCommands.length}</span>
      {/if}
      {#if selectedStatuses.length > 0}
        <span class="rounded bg-primary/10 px-2 py-1">Statuses: {selectedStatuses.length}</span>
      {/if}
      {#if hasStartedFilter !== undefined}
        <span class="rounded bg-primary/10 px-2 py-1">Started: {hasStartedFilter ? 'Yes' : 'No'}</span>
      {/if}
      {#if hasFinishedFilter !== undefined}
        <span class="rounded bg-primary/10 px-2 py-1">Finished: {hasFinishedFilter ? 'Yes' : 'No'}</span>
      {/if}
      {#if hasParentFilter !== undefined}
        <span class="rounded bg-primary/10 px-2 py-1">Parent: {hasParentFilter ? 'Yes' : 'No'}</span>
      {/if}
    </div>
  {/if}
</div>

<!-- Bulk Actions Toolbar -->
{#if selectedJobIds.size > 0}
  <div class="mb-4 flex items-center gap-4 rounded-lg border bg-muted/50 p-4">
    <div class="flex items-center gap-2">
      <AlertTriangle class="h-4 w-4 text-orange-500" />
      <span class="text-sm font-medium">
        {selectedJobIds.size} job{selectedJobIds.size === 1 ? '' : 's'} selected across all pages
      </span>
    </div>
    <div class="flex gap-2">
      <Button
        variant="outline"
        onclick={async () => {
          // This would require fetching all jobs from API - for now, warn user
          toast.warning("Feature not implemented", {
            description: "Selecting all jobs across all pages is not yet implemented"
          });
        }}
      >
        Select All {totalItems} Jobs
      </Button>
      <LoadingButton
        variant="destructive"
        icon={Trash2}
        fn={async () => {
          bulkDeleteDialogOpen = true;
        }}
      >
        Delete Selected
      </LoadingButton>
      <Button
        variant="outline"
        onclick={() => {
          selectedJobIds = new Set(); // Create new Set to trigger reactivity
        }}
      >
        <Minus class="h-4 w-4" />
        Clear Selection
      </Button>
    </div>
  </div>
{/if}

<Table.Root class="w-full gap-0.5">
  <Table.Header>
    <Table.Row>
      <Table.Head class="w-[3rem]">
        <Checkbox.Root
          checked={allVisibleSelected}
          indeterminate={someVisibleSelected}
          onCheckedChange={handleSelectAll}
          aria-label="Select all visible jobs"
        />
      </Table.Head>
      <Table.Head class="text-start">{m["admin.dashboard.jobsTable.header.for_area"]()}</Table.Head>
      
      <!-- Sortable Command Header -->
      <Table.Head>
        <Button
          variant="ghost"
          onclick={() => handleSort('command')}
          class="h-auto p-0 font-medium hover:bg-transparent"
        >
          {m["admin.dashboard.jobsTable.header.command"]()}
          {#if queryParams.sortBy === 'command'}
            {#if queryParams.sortOrder === 'asc'}
              <SortAsc class="ml-1 h-3 w-3" />
            {:else}
              <SortDesc class="ml-1 h-3 w-3" />
            {/if}
          {/if}
        </Button>
      </Table.Head>
      
      <!-- Sortable Status Header -->
      <Table.Head>
        <Button
          variant="ghost"
          onclick={() => handleSort('status')}
          class="h-auto p-0 font-medium hover:bg-transparent"
        >
          {m["admin.dashboard.jobsTable.header.status"]()}
          {#if queryParams.sortBy === 'status'}
            {#if queryParams.sortOrder === 'asc'}
              <SortAsc class="ml-1 h-3 w-3" />
            {:else}
              <SortDesc class="ml-1 h-3 w-3" />
            {/if}
          {/if}
        </Button>
      </Table.Head>
      
      <!-- Sortable Updated Header -->
      <Table.Head class="text-center">
        <Button
          variant="ghost"
          onclick={() => handleSort('updated')}
          class="h-auto p-0 font-medium hover:bg-transparent"
        >
          {m["admin.dashboard.jobsTable.header.updated_at"]()}
          {#if queryParams.sortBy === 'updated'}
            {#if queryParams.sortOrder === 'asc'}
              <SortAsc class="ml-1 h-3 w-3" />
            {:else}
              <SortDesc class="ml-1 h-3 w-3" />
            {/if}
          {/if}
        </Button>
      </Table.Head>
      
      <!-- Sortable Started Header -->
      <Table.Head class="text-center">
        <Button
          variant="ghost"
          onclick={() => handleSort('started')}
          class="h-auto p-0 font-medium hover:bg-transparent"
        >
          {m["admin.dashboard.jobsTable.header.started_at"]()}
          {#if queryParams.sortBy === 'started'}
            {#if queryParams.sortOrder === 'asc'}
              <SortAsc class="ml-1 h-3 w-3" />
            {:else}
              <SortDesc class="ml-1 h-3 w-3" />
            {/if}
          {/if}
        </Button>
      </Table.Head>
      
      <!-- Sortable Finished Header -->
      <Table.Head class="text-center">
        <Button
          variant="ghost"
          onclick={() => handleSort('finished')}
          class="h-auto p-0 font-medium hover:bg-transparent"
        >
          {m["admin.dashboard.jobsTable.header.finished_at"]()}
          {#if queryParams.sortBy === 'finished'}
            {#if queryParams.sortOrder === 'asc'}
              <SortAsc class="ml-1 h-3 w-3" />
            {:else}
              <SortDesc class="ml-1 h-3 w-3" />
            {/if}
          {/if}
        </Button>
      </Table.Head>
      
      <!-- Sortable Parent Header -->
      <Table.Head class="text-start">
        <Button
          variant="ghost"
          onclick={() => handleSort('parent')}
          class="h-auto p-0 font-medium hover:bg-transparent"
        >
          {m["admin.dashboard.jobsTable.header.from_job"]()}
          {#if queryParams.sortBy === 'parent'}
            {#if queryParams.sortOrder === 'asc'}
              <SortAsc class="ml-1 h-3 w-3" />
            {:else}
              <SortDesc class="ml-1 h-3 w-3" />
            {/if}
          {/if}
        </Button>
      </Table.Head>
      
      <Table.Head class="w-[5rem]">Actions</Table.Head>
    </Table.Row>
  </Table.Header>
  <Table.Body>
    {#each jobs as job, idx (job.id)}
      <!-- Add key -->
      <Table.Row>
        <Table.Cell>
          <Checkbox.Root
            checked={selectedJobIds.has(job.id)}
            onCheckedChange={(checked) => handleSelectJob(job.id, Boolean(checked))}
            aria-label={`Select job ${job.id}`}
          />
        </Table.Cell>
        <!--<Table.Cell class="text-right">{startIndex + idx + 1}</Table.Cell>-->
        <!--<Table.Cell class="font-mono">{job.id}</Table.Cell>-->
        <Table.Cell class="text-start">
          {#if !!job.forArea}
            <Tooltip.Provider delayDuration={0}>
              <Tooltip.Root>
                <Tooltip.Trigger>
                  {truncate(job.forArea.name || job.forArea.full_path)}
                </Tooltip.Trigger>
                <Tooltip.Content>
                  {job.forArea.type}: {job.forArea.full_path}
                  {#if !!job.branch && job.branch.length > 0}
                    ({job.branch})
                  {/if}
                </Tooltip.Content>
              </Tooltip.Root>
            </Tooltip.Provider>
          {/if}
        </Table.Cell>
        <Table.Cell>{job.command}</Table.Cell>
        <!--<Table.Cell>{job.provider}</Table.Cell>-->
        <Table.Cell>
          <Tooltip.Provider delayDuration={0}>
            <Tooltip.Root>
              <Tooltip.Trigger>
                {@const Icon = statusToIcon(job.status)}
                <Icon />
              </Tooltip.Trigger>
              <Tooltip.Content class="flex flex-col gap-2">
                {#if (job.status === JobStatus.paused || job.status === JobStatus.failed) && job.resumeState}
                  <span class="text-lg font-semibold">{job.status}</span>
                  <Highlight class="p-0 m-0" language={json} code={JSON.stringify(job.resumeState, null, 2)} let:highlighted>
                    <LineNumbers {highlighted} hideBorder />
                  </Highlight>
                {:else}
                  {job.status}
                {/if}
              </Tooltip.Content>
            </Tooltip.Root>
          </Tooltip.Provider>
        </Table.Cell>
        <Table.Cell class="text-center">
          <Tooltip.Provider delayDuration={0}>
            <Tooltip.Root>
              <Tooltip.Trigger>
                <Time timestamp={job.updated_at ?? job.created_at} {format} />
              </Tooltip.Trigger>
              <Tooltip.Content>
                Created: <Time timestamp={job.created_at} format={formatTooltip} />
                {#if job.updated_at}
                  <br /> Updated: <Time timestamp={job.updated_at} format={formatTooltip} />
                {/if}
              </Tooltip.Content>
            </Tooltip.Root>
          </Tooltip.Provider>
        </Table.Cell>
        <Table.Cell class="text-center">
          {#if job.started_at}
            <Time timestamp={job.started_at} {format} />
          {/if}
        </Table.Cell>
        <Table.Cell class="text-center">
          {#if job.finished_at}
            <Time timestamp={job.finished_at} {format} />
          {/if}
        </Table.Cell>
        <Table.Cell class="text-start">
          {#if !!job.fromJob}
            <Tooltip.Provider delayDuration={0}>
              <Tooltip.Root>
                <Tooltip.Trigger>
                  {job.fromJob.command}
                </Tooltip.Trigger>
                <Tooltip.Content class="font-mono">
                  {job.fromJob.id} ({job.fromJob.status})
                </Tooltip.Content>
              </Tooltip.Root>
            </Tooltip.Provider>
          {/if}
        </Table.Cell>
        <!--<Table.Cell class="text-end">{job.childrenCount}</Table.Cell>-->
        <Table.Cell>
          <LoadingButton
            variant="ghost"
            icon={Trash2}
            fn={async () => {
              openDeleteDialog(job.id);
            }}
          >
          </LoadingButton>
        </Table.Cell>
      </Table.Row>
    {/each}
  </Table.Body>
</Table.Root>

<!-- Individual Delete Confirmation Dialog -->
<Dialog.Root bind:open={deleteDialogOpen}>
  <Dialog.Content class="sm:max-w-[425px]">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2">
        <AlertTriangle class="h-5 w-5 text-orange-500" />
        Confirm Job Deletion
      </Dialog.Title>
      <Dialog.Description>
        Are you sure you want to delete job <code class="bg-muted px-1 py-0.5 rounded text-sm font-mono">{jobToDelete}</code>?
        This action cannot be undone.
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => { deleteDialogOpen = false; jobToDelete = null; }}>
        Cancel
      </Button>
      <LoadingButton variant="destructive" icon={Trash2} fn={confirmDelete}>
        Delete Job
      </LoadingButton>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Bulk Delete Confirmation Dialog -->
<Dialog.Root bind:open={bulkDeleteDialogOpen}>
  <Dialog.Content class="sm:max-w-[425px]">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2">
        <AlertTriangle class="h-5 w-5 text-orange-500" />
        Confirm Bulk Deletion
      </Dialog.Title>
      <Dialog.Description>
        Are you sure you want to delete {selectedJobIds.size} selected job{selectedJobIds.size === 1 ? '' : 's'}?
        This action cannot be undone.
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => { bulkDeleteDialogOpen = false; }}>
        Cancel
      </Button>
      <LoadingButton variant="destructive" icon={Trash2} fn={confirmBulkDelete}>
        Delete {selectedJobIds.size} Job{selectedJobIds.size === 1 ? '' : 's'}
      </LoadingButton>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Delete All Jobs Confirmation Dialog -->
<Dialog.Root bind:open={deleteAllDialogOpen}>
  <Dialog.Content class="sm:max-w-[500px]">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2">
        <AlertTriangle class="h-5 w-5 text-red-500" />
        ⚠️ DANGER: Delete All Jobs
      </Dialog.Title>
      <Dialog.Description>
        <div class="space-y-3">
          <p class="text-red-600 font-semibold">
            This will permanently delete ALL {totalItems} jobs in the system.
          </p>
          <p>
            This action is irreversible and will remove all job data, including history and results.
          </p>
          <p>
            To confirm, please type <code class="bg-muted px-1 py-0.5 rounded text-sm font-mono">DELETE ALL JOBS</code> below:
          </p>
        </div>
      </Dialog.Description>
    </Dialog.Header>
    <div class="my-4">
      <input
        type="text"
        bind:value={deleteAllConfirmText}
        placeholder="Type confirmation phrase"
        class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
    </div>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => { deleteAllDialogOpen = false; deleteAllConfirmText = ""; }}>
        Cancel
      </Button>
      <LoadingButton
        variant="destructive"
        icon={Trash2}
        fn={confirmDeleteAll}
        disabled={deleteAllConfirmText !== "DELETE ALL JOBS"}
      >
        Delete All Jobs
      </LoadingButton>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Pagination Controls -->
{#if totalPages > 1}
  <div class="mt-4 flex items-center justify-between">
    <div class="flex items-center gap-2 text-sm text-muted-foreground">
      <span>
        Showing {startIndex + 1} to {endIndex} of {totalItems} jobs
      </span>
      {#if selectedJobIds.size > 0}
        <span class="text-orange-600 font-medium">
          ({selectedJobIds.size} selected across all pages)
        </span>
      {/if}
    </div>
    
    <div class="flex items-center gap-6">
      <div class="flex items-center gap-2">
        <Select.Root
          type="single"
          onValueChange={(v) => handleItemsPerPageChange(v)}
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
          disabled={(queryParams.page ?? 1) === 1 || loading}
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
          onclick={() => handlePageChange(Math.max(1, (queryParams.page ?? 1) - 1))}
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
            const start = Math.max(1, (queryParams.page ?? 1) - 2);
            const end = Math.min(totalPages, start + 4);
            const adjustedStart = Math.max(1, end - 4);
            return adjustedStart + i;
          }) as pageNum}
            <Button
              variant={(queryParams.page ?? 1) === pageNum ? "default" : "outline"}
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
          onclick={() => handlePageChange(Math.min(totalPages, (queryParams.page ?? 1) + 1))}
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
          disabled={(queryParams.page ?? 1) === totalPages || loading}
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
  <div class="mt-4 flex items-center justify-between text-sm text-muted-foreground">
    <span>Showing {totalItems} job{totalItems === 1 ? '' : 's'}</span>
    {#if selectedJobIds.size > 0}
      <span class="text-orange-600 font-medium">
        {selectedJobIds.size} selected
      </span>
    {/if}
  </div>
{/if}
