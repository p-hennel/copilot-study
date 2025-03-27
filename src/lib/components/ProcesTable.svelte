<script lang="ts">
  import * as Table from "$lib/components/ui/table/index.js";
  import Time from "svelte-time";
  import { m } from "$paraglide";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import Button, { buttonVariants } from "$ui/button/button.svelte";
  import {
    CircleChevronDown,
    CircleChevronUp,
    Cpu,
    MemoryStick,
    MonitorPlay,
    OctagonX,
    Play,
    RefreshCw
  } from "lucide-svelte";
  import { invalidate, invalidateAll } from "$app/navigation";
  import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
  import Separator from "$ui/separator/separator.svelte";
  import { cn, type pm2types } from "$lib/utils";
  import { Ellipsis } from "$ui/breadcrumb";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";

  type ProcessTableProps = {
    processes: pm2types.ProcessDescription[];
    sessionToken: string;
  };

  let data: ProcessTableProps = $props();

  let state = $state({
    loading: false,
    action: null as "start" | "restart" | "stop" | null,
    actionPid: null as string | number | null | undefined
  });

  const triggerRefresh = async () => {
    if (state.loading) return;
    state.loading = true;
    await invalidate("/admin/processes");
    state.loading = false;
  };

  const triggerProcessRun = async (step: number) => {
    if (state.loading) return;
    state.loading = true;
    const target = Math.min(10, Math.max(data.processes.length + step, 0));
    await fetch(`/admin/trigger?scale=${target}`, {
      headers: {
        Authorization: `Bearer ${data.sessionToken}`
      }
    });
    setTimeout(async () => {
      await invalidate("/admin/processes");
      state.loading = false;
    }, 1000);
  };

  const scaleUp = () => {
    triggerProcessRun(1);
  };
  const scaleDown = () => {
    triggerProcessRun(-1);
  };

  const doActionPid = async () => {
    if (state.loading) return;
    state.loading = true;
    await fetch("/admin/kill", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${data.sessionToken}`
      },
      body: JSON.stringify({ pid: state.actionPid, action: state.action })
    });
    state.actionPid = null;
    state.action = null;
    await invalidate("/admin/processes");
    state.loading = false;
  };

  const doNotKillPid = () => {
    state.actionPid = null;
    state.action = null;
  };

  const getDetails = (proc: pm2types.ProcessDescription): (string | undefined)[] => {
    if (!!proc.pm2_env) {
      return [
        `${proc.pm2_env.restart_time} restarts (${proc.pm2_env.unstable_restarts} unstable)`,
        proc.pm2_env.exec_interpreter
      ];
    }
    return [];
  };

  $inspect(data.processes);

  const alertDialogOpen = $derived(
    !!state.actionPid && `${state.actionPid}`.length > 0 && !!state.action
  );
</script>

<AlertDialog.Root
  open={alertDialogOpen}
  onOpenChange={(open) => (open ? undefined : (state.actionPid = null))}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title class="text-4xl font-black">WARNING!</AlertDialog.Title>
      <AlertDialog.Description class="text-lg">
        <p>
          This action <strong>cannot be undone</strong>.<br />
          This will instantly <strong>{state.action}</strong> the process with ID {state.actionPid}.
        </p>
        <Separator class="my-2" />
        <p class="text-destructive font-bold">
          Only proceed if you know what you are doing and are aware of the risks involved.
        </p>
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel onclick={doNotKillPid} class="font-bold"
        >Stop, cancel this.</AlertDialog.Cancel
      >
      <AlertDialog.Action
        class={cn(buttonVariants({ variant: "destructive" }), "font-bold")}
        onclick={doActionPid}
        >{`${state.action?.substring(0, 1).toUpperCase()}${state.action?.substring(1)}`} the Process</AlertDialog.Action
      >
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<Table.Root class="w-full">
  <Table.Header>
    <Table.Row>
      <Table.Head class="w-[4rem] text-right"
        >{m["admin.dashboard.processesTable.header.idx"]()}</Table.Head
      >
      <Table.Head>{m["admin.dashboard.processesTable.header.pid"]()}</Table.Head>
      <Table.Head class="text-center"
        >{m["admin.dashboard.processesTable.header.resources"]()}</Table.Head
      >
      <Table.Head>{m["admin.dashboard.processesTable.header.status"]()}</Table.Head>
      <Table.Head colspan={2}>
        <div class="flex w-full flex-row items-center justify-stretch gap-2 pb-2">
          <div class="mt-2 flex-1 grow place-content-center">
            {m["admin.dashboard.processesTable.header.details"]()}
          </div>
          <Button variant="outline" disabled={state.loading} onclick={triggerRefresh}>
            <RefreshCw />
            {m["admin.dashboard.processesTable.refresh"]()}
          </Button>
          <Button variant="secondary" disabled={state.loading} onclick={scaleUp}>
            <CircleChevronUp />
            {m["admin.dashboard.processesTable.scale-up"]()}
          </Button>
          <Button variant="secondary" disabled={state.loading} onclick={scaleDown}>
            <CircleChevronDown />
            {m["admin.dashboard.processesTable.scale-down"]()}
          </Button>
        </div>
      </Table.Head>
    </Table.Row>
  </Table.Header>
  <Table.Body>
    {#each data.processes as process}
      <Table.Row>
        <Table.Cell class="text-right">{process.pm_id}</Table.Cell>
        <Table.Cell class="text-right">{process.pid}</Table.Cell>
        <Table.Cell class="text-center">
          <div class="grid w-28 grid-cols-2 gap-0">
            <div class="w-5"><Cpu class="size-5" /></div>
            <div class="col-start-2 text-end">{(process.monit?.cpu ?? 0).toFixed(1)}%</div>
            <div class="w-5"><MemoryStick class="size-5" /></div>
            <div class="text-end">{((process.monit?.memory ?? 0) / 1000 / 1000).toFixed(1)}MB</div>
          </div>
        </Table.Cell>
        <Table.Cell class="place-items-start">
          <Tooltip.Provider delayDuration={0}>
            <Tooltip.Root>
              <Tooltip.Trigger>
                {process.pm2_env?.status ?? ""}
              </Tooltip.Trigger>
              <Tooltip.Content>
                <Time timestamp={process.pm2_env?.pm_uptime} format="YYYY-MM-DD HH:mm:ss" />
              </Tooltip.Content>
            </Tooltip.Root>
          </Tooltip.Provider>
        </Table.Cell>
        <Table.Cell class="w-full">
          {#each getDetails(process) as detail, idx}
            {#if idx > 0}
              <br />
            {/if}
            {detail}
          {/each}
        </Table.Cell>
        <Table.Cell class="relative w-24">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              class={cn(
                buttonVariants({ variant: "outline", size: "icon" }),
                "absolute end-2 top-2"
              )}
            >
              <Ellipsis />
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              <DropdownMenu.Item
                disabled={process.pm2_env?.status === "online"}
                onclick={() => {
                  state.actionPid = process.pm_id;
                  state.action = "start";
                }}
              >
                <Play />
                Start
              </DropdownMenu.Item>
              <DropdownMenu.Item
                disabled={process.pm2_env?.status !== "online"}
                onclick={() => {
                  state.actionPid = process.pm_id;
                  state.action = "restart";
                }}
              >
                <RefreshCw />
                Restart
              </DropdownMenu.Item>
              <DropdownMenu.Item
                disabled={process.pm2_env?.status !== "online"}
                onclick={() => {
                  state.actionPid = process.pm_id;
                  state.action = "stop";
                }}
              >
                <OctagonX />
                Stop / Kill
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </Table.Cell>
      </Table.Row>
    {:else}
      <Table.Row>
        <Table.Cell colspan={7} class="text-center text-xl font-semibold">
          {m["admin.dashboard.processesTable.no_processes"]()}
        </Table.Cell>
      </Table.Row>
    {/each}
  </Table.Body>
</Table.Root>
