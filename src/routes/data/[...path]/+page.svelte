<script lang="ts">
  import Progress from "$ui/progress/progress.svelte";
  import * as Card from "$lib/components/ui/card/index.js";
  // Removed: import type { PageProps } from "./$types"; // Use explicit types below
  import Button from "$ui/button/button.svelte";
  import { FolderOpen } from "lucide-svelte";
  import * as Tooltip from "$ui/tooltip";
  import type { Area } from "$lib/server/db/schema"; // Import Area type if needed, or define inline

  // Define types based on the load function's return value
  type FileInfo = { type: string; size: number; name: string };
  type AreaDetailsWithCounts = Area & { jobsTotal: number; jobsFinished: number }; // Assuming Area is imported or defined
  type PageData = {
    area: AreaDetailsWithCounts;
    files: FileInfo[];
  };

  let { data }: { data: PageData } = $props(); // Use the defined PageData type
  const progressValue = $derived((data.area.jobsFinished / data.area.jobsTotal) * 100);
</script>

<div class="flex items-center justify-between">
  <h1 class="text-4xl font-extrabold">{data.area.name}</h1>
  <span class="ms-2 font-mono">{data.area.full_path}</span>
</div>

<Tooltip.Provider delayDuration={0}>
  <Tooltip.Root>
    <Tooltip.Trigger class="mb-4 w-full">
      <Progress value={progressValue} />
    </Tooltip.Trigger>
    <Tooltip.Content class="font-mono">
      {data.area.jobsFinished}/{data.area.jobsTotal}
    </Tooltip.Content>
  </Tooltip.Root>
</Tooltip.Provider>

<div class="grid gap-4 sm:grid-cols-1 md:grid-cols-2 md:gap-2 xl:grid-cols-3">
  {#each data.files as file}
    <Card.Root class="w-full">
      <Card.Header>
        <Card.Title class="capitalize">{file.type}</Card.Title>
        <Card.Description></Card.Description>
      </Card.Header>
      <Card.Footer class="mt-2 flex justify-between">
        <div class="font-mono text-sm">
          {(file.size / 1000 / 1000).toFixed(1)}MB
        </div>
        <!-- Construct correct download path -->
        <Button variant="secondary" href={`/data/download/${data.area.full_path}/${file.name}`}>
          <FolderOpen />
          Open
        </Button>
      </Card.Footer>
    </Card.Root>
  {/each}
</div>
