<script lang="ts">
  import { cn } from "$lib/utils"
  import { m } from "$paraglide"
  import Button from "$ui/button/button.svelte"
  import * as Card from "$ui/card/index"
  import { Progress } from "$ui/progress"
  import { FolderOpen } from "lucide-svelte"
  import * as Tooltip from "$lib/components/ui/tooltip/index.js"

  let {
    area,
    class: className
  }: {
    area: {
      full_path: string
      name: string | null
      //      gitlab_id: string | null;
      type: "group" | "project"
      jobsFinished: number
      jobsTotal: number
    }
    class?: string
  } = $props()
</script>

<Card.Root class={cn("flex w-xs flex-col", className)}>
  <Card.Header class="flex flex-row flex-wrap place-items-center">
    <Card.Title class="flex-1 text-2xl">
      {area.name ?? area.full_path}
    </Card.Title>
    <Card.Description>
      {`${area.type.substring(0, 1).toUpperCase()}${area.type.substring(1)}`}
    </Card.Description>
  </Card.Header>
  <Card.Content class="border-b-1 pt-2 pb-4">
    {area.full_path}
  </Card.Content>
  <Card.Footer class="flex gap-4 pt-2">
    <div class="flex-1">
      <Tooltip.Provider delayDuration={0}>
        <Tooltip.Root>
          <Tooltip.Trigger class="w-full">
            <Progress value={area.jobsFinished / area.jobsTotal} max={1} />
          </Tooltip.Trigger>
          <Tooltip.Content>
            {area.jobsFinished} of {area.jobsTotal} finished. More jobs might be added.
          </Tooltip.Content>
        </Tooltip.Root>
      </Tooltip.Provider>
    </div>
    <Button
      variant="outline"
      disabled={area.jobsFinished < area.jobsTotal}
      target="_blank"
      href={area.jobsFinished < area.jobsTotal ? undefined : `/data/${area.full_path}`}
    >
      <FolderOpen class="mr-2 size-4" />
      Open
    </Button>
  </Card.Footer>
</Card.Root>
