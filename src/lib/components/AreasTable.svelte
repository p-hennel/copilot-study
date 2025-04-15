<script lang="ts">
  import Time from "svelte-time";
  import * as Table from "$lib/components/ui/table/index.js";
  import { m } from "$paraglide";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { JobStatus } from "$lib/types";
  import { AreaType } from "$lib/types";
  import { Check, Cross, FolderGit2, Logs, Repeat, UsersRound } from "lucide-svelte";

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

  type AreaTableProps = {
    areas: AreaInformation[];
    format?: string;
  };

  let data: AreaTableProps = $props();
  const format = $derived(data.format ?? "DD. MMM, HH:mm");
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
    {#each data.areas as area, idx (area.fullPath)}
      <!-- Add key -->
      <Table.Row>
        <Table.Cell class="text-right">{data.areas.length - idx}</Table.Cell>
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
