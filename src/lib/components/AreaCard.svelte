<script lang="ts">
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { cn } from "$lib/utils";
  import Button from "$ui/button/button.svelte";
  import * as Card from "$ui/card/index";
  import { Progress } from "$ui/progress";
  import { FolderOpen } from "lucide-svelte";

  let {
    area,
    class: className
  }: {
    area: {
      full_path: string;
      name: string | null;
      //      gitlab_id: string | null;
      type: "group" | "project";
      jobsFinished: number;
      jobsTotal: number;
    };
    class?: string;
  } = $props();
  const finished = $derived(
    area.jobsTotal &&
      area.jobsTotal > 0 &&
      area.jobsFinished &&
      area.jobsFinished > 0 &&
      area.jobsFinished >= area.jobsTotal
  );

  const allowDataAccessAnyway = area.jobsFinished && area.jobsFinished > 0

</script>

<Card.Root class={cn("flex flex-col", className)}>
  <Card.Header>
    <Card.Title class="text-xl">
      {area.name ?? area.full_path}
    </Card.Title>
  </Card.Header>
  <Card.Content class="place-items-top flex grow flex-row flex-wrap border-b-1 pt-2 pb-4">
    <p class="flex-1">{area.full_path}</p>
    <Card.Description>
      {`${area.type.substring(0, 1).toUpperCase()}${area.type.substring(1)}`}
    </Card.Description>
  </Card.Content>
  <Card.Footer class="mt-3 mb-0 flex place-items-center gap-4 pt-2">
    <div class="flex-1">
      <Tooltip.Provider delayDuration={0}>
        <Tooltip.Root>
          <Tooltip.Trigger class="w-full">
            <Progress
              value={area.jobsTotal && area.jobsTotal > 0 ? area.jobsFinished / area.jobsTotal : 0}
              max={1}
            />
          </Tooltip.Trigger>
          <Tooltip.Content>
            {area.jobsFinished}
            {area.jobsTotal && area.jobsTotal > 0 ? `of ${area.jobsTotal}` : ""} jobs finished. More
            jobs might be added.
          </Tooltip.Content>
        </Tooltip.Root>
      </Tooltip.Provider>
    </div>
    <Button
      variant="outline"
      disabled={!finished && !allowDataAccessAnyway}
      target="_blank"
      href={!finished && !allowDataAccessAnyway ? undefined : `/data/${area.full_path}`}
    >
      <FolderOpen class="mr-2 size-4" />
      Open
    </Button>
  </Card.Footer>
</Card.Root>
