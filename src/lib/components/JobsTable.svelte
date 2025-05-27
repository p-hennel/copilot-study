<script lang="ts">
  import Time from "svelte-time";
  import * as Table from "$lib/components/ui/table/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import * as Checkbox from "$lib/components/ui/checkbox/index.js";
  import { Button } from "$ui/button";
  import { m } from "$paraglide";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { JobStatus } from "$lib/types";
  import type { AreaType } from "$lib/types";
  import type { CrawlCommand } from "$lib/types";
  import { Check, Cross, Logs, Repeat, Trash2, AlertTriangle, Minus } from "lucide-svelte";
  import LoadingButton from "./LoadingButton.svelte";
  import { authClient } from "$lib/auth-client";
  import { goto } from "$app/navigation";
  import { toast } from "svelte-sonner";

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

  type JobsTableProps = {
    jobs: JobInformation[];
    format?: string;
    onRefresh?: () => Promise<void>;
  };

  let data: JobsTableProps = $props();
  const format = $derived(data.format ?? "DD. MMM, HH:mm");

  // Selection state
  let selectedJobIds = $state<Set<string>>(new Set());
  let allSelected = $derived(selectedJobIds.size === data.jobs.length && data.jobs.length > 0);
  let someSelected = $derived(selectedJobIds.size > 0 && selectedJobIds.size < data.jobs.length);

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
    if (allSelected) {
      selectedJobIds.clear();
    } else {
      selectedJobIds = new Set(data.jobs.map(job => job.id));
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

  const refreshJobs = async () => {
    if (data.onRefresh) {
      await data.onRefresh();
    }
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

      selectedJobIds.clear();
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

      selectedJobIds.clear();
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
</script>

<!-- Bulk Actions Toolbar -->
{#if selectedJobIds.size > 0}
  <div class="mb-4 flex items-center gap-4 rounded-lg border bg-muted/50 p-4">
    <div class="flex items-center gap-2">
      <AlertTriangle class="h-4 w-4 text-orange-500" />
      <span class="text-sm font-medium">
        {selectedJobIds.size} job{selectedJobIds.size === 1 ? '' : 's'} selected
      </span>
    </div>
    <div class="flex gap-2">
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
          selectedJobIds.clear();
        }}
      >
        <Minus class="h-4 w-4" />
        Clear Selection
      </Button>
    </div>
  </div>
{/if}

<!-- Bulk Actions Button -->
{#if data.jobs.length > 0}
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

<Table.Root class="w-full gap-0.5">
  <Table.Header>
    <Table.Row>
      <Table.Head class="w-[3rem]">
        <Checkbox.Root
          checked={allSelected}
          indeterminate={someSelected}
          onCheckedChange={handleSelectAll}
          aria-label="Select all jobs"
        />
      </Table.Head>
      <Table.Head class="w-[2.5rem] text-right"
        >{m["admin.dashboard.jobsTable.header.idx"]()}</Table.Head
      >
      <Table.Head>{m["admin.dashboard.jobsTable.header.id"]()}</Table.Head>
      <Table.Head>{m["admin.dashboard.jobsTable.header.command"]()}</Table.Head>
      <Table.Head>{m["admin.dashboard.jobsTable.header.provider"]()}</Table.Head>
      <Table.Head>{m["admin.dashboard.jobsTable.header.status"]()}</Table.Head>
      <Table.Head class="text-center"
        >{m["admin.dashboard.jobsTable.header.updated_at"]()}</Table.Head
      >
      <Table.Head class="text-center"
        >{m["admin.dashboard.jobsTable.header.started_at"]()}</Table.Head
      >
      <Table.Head class="text-center"
        >{m["admin.dashboard.jobsTable.header.finished_at"]()}</Table.Head
      >
      <Table.Head class="text-center"></Table.Head>
      <Table.Head class="w-[5rem]">Actions</Table.Head>
      <!--
      <Table.Head class="text-end">{m["admin.dashboard.jobsTable.header.from_job"]()}</Table.Head>
      <Table.Head class="text-end">{m["admin.dashboard.jobsTable.header.for_area"]()}</Table.Head>
      <Table.Head class="text-end">{m["admin.dashboard.jobsTable.header.children_count"]()}</Table.Head>
      -->
    </Table.Row>
  </Table.Header>
  <Table.Body>
    {#each data.jobs as job, idx (job.id)}
      <!-- Add key -->
      <Table.Row>
        <Table.Cell>
          <Checkbox.Root
            checked={selectedJobIds.has(job.id)}
            onCheckedChange={(checked) => handleSelectJob(job.id, Boolean(checked))}
            aria-label={`Select job ${job.id}`}
          />
        </Table.Cell>
        <Table.Cell class="text-right">{data.jobs.length - idx}</Table.Cell>
        <Table.Cell class="font-mono">{job.id}</Table.Cell>
        <Table.Cell>{job.command}</Table.Cell>
        <Table.Cell>{job.provider}</Table.Cell>
        <Table.Cell>
          <Tooltip.Provider delayDuration={0}>
            <Tooltip.Root>
              <Tooltip.Trigger>
                {@const Icon = statusToIcon(job.status)}
                <Icon />
              </Tooltip.Trigger>
              <Tooltip.Content>
                {job.status}
                {#if (job.status === JobStatus.paused || job.status === JobStatus.failed) && job.resumeState}
                  <pre class="bg-muted mt-2 max-w-xs overflow-auto rounded p-1 text-xs">
                    {JSON.stringify(job.resumeState, null, 2)}
                  </pre>
                {/if}
              </Tooltip.Content>
            </Tooltip.Root>
          </Tooltip.Provider>
        </Table.Cell>
        <Table.Cell class="text-center">
          <Tooltip.Provider delayDuration={0} disabled={!job.updated_at}>
            <Tooltip.Root>
              <Tooltip.Trigger>
                <Time timestamp={job.updated_at ?? job.created_at} {format} />
              </Tooltip.Trigger>
              <Tooltip.Content>
                Created: <Time timestamp={job.created_at} {format} />
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
        <Table.Cell class="w-1/3">
          <div class="grid w-full grid-cols-3 gap-0.5">
            <div class="italic">{m["admin.dashboard.jobsTable.header.from_job"]()}</div>
            <div class="italic">{m["admin.dashboard.jobsTable.header.for_area"]()}</div>
            <div class="w-1/2 text-end italic">
              {m["admin.dashboard.jobsTable.header.children_count"]()}
            </div>
            <div>
              {#if !!job.fromJob}
                <Tooltip.Provider delayDuration={0}>
                  <Tooltip.Root>
                    <Tooltip.Trigger>
                      {job.fromJob.command}: {job.fromJob.status}
                    </Tooltip.Trigger>
                    <Tooltip.Content class="font-mono">
                      {job.fromJob.id}
                    </Tooltip.Content>
                  </Tooltip.Root>
                </Tooltip.Provider>
              {/if}
            </div>
            <div>
              {#if !!job.forArea}
                <Tooltip.Provider delayDuration={0}>
                  <Tooltip.Root>
                    <Tooltip.Trigger>
                      {job.forArea.full_path}
                      {#if !!job.branch && job.branch.length > 0}
                        <br /> {job.branch}
                      {/if}
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                      {job.forArea.name} ({job.forArea.type})
                    </Tooltip.Content>
                  </Tooltip.Root>
                </Tooltip.Provider>
              {/if}
            </div>
            <div class="w-1/2 text-end">{job.childrenCount}</div>
          </div>
        </Table.Cell>
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
            This will permanently delete ALL {data.jobs.length} jobs in the system.
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
