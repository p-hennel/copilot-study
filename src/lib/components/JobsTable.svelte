<script lang="ts">
  import Time from "svelte-time";
  import * as Table from "$lib/components/ui/table/index.js";
  import { m } from "$paraglide";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { JobStatus } from "$lib/types";
  import type { AreaType } from "$lib/types";
  import type { CrawlCommand } from "$lib/types";
  import { Check, Cross, Logs, Repeat } from "lucide-svelte";

  type JobInformation = {
    id: string;
    provider: string;
    created_at: Date;
    full_path: string;
    status: JobStatus;
    command: CrawlCommand;
    started_at: Date;
    finished_at: Date;
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
  };

  let data: JobsTableProps = $props();
  const format = $derived(data.format ?? "DD. MMM, HH:mm");

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
</script>

<Table.Root class="w-full gap-0.5">
  <Table.Header>
    <Table.Row>
      <Table.Head class="w-[2.5rem] text-right"
        >{m["admin.dashboard.jobsTable.header.idx"]()}</Table.Head
      >
      <Table.Head>{m["admin.dashboard.jobsTable.header.id"]()}</Table.Head>
      <Table.Head>{m["admin.dashboard.jobsTable.header.command"]()}</Table.Head>
      <Table.Head>{m["admin.dashboard.jobsTable.header.provider"]()}</Table.Head>
      <Table.Head>{m["admin.dashboard.jobsTable.header.status"]()}</Table.Head>
      <Table.Head class="text-center"
        >{m["admin.dashboard.jobsTable.header.created_at"]()}</Table.Head
      >
      <Table.Head class="text-center"
        >{m["admin.dashboard.jobsTable.header.finished_at"]()}</Table.Head
      >
      <Table.Head class="text-center"></Table.Head>
      <!--
      <Table.Head class="text-end">{m["admin.dashboard.jobsTable.header.from_job"]()}</Table.Head>
      <Table.Head class="text-end">{m["admin.dashboard.jobsTable.header.for_area"]()}</Table.Head>
      <Table.Head class="text-end">{m["admin.dashboard.jobsTable.header.children_count"]()}</Table.Head>
      -->
    </Table.Row>
  </Table.Header>
  <Table.Body>
    {#each data.jobs as job, idx (idx)}
      <!-- Add key -->
      <Table.Row>
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
          <Tooltip.Provider delayDuration={0} disabled={!job.started_at}>
            <Tooltip.Root>
              <Tooltip.Trigger>
                <Time timestamp={job.created_at} {format} />
              </Tooltip.Trigger>
              <Tooltip.Content>
                {#if job.started_at}
                  <Time timestamp={job.started_at} {format} />
                {/if}
              </Tooltip.Content>
            </Tooltip.Root>
          </Tooltip.Provider>
        </Table.Cell>
        <Table.Cell class="text-center">
          {#if job.started_at}
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
      </Table.Row>
    {/each}
  </Table.Body>
</Table.Root>
