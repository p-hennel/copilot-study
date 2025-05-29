<script lang="ts">
  import { Skeleton } from "$lib/components/ui/skeleton";
  
  let { 
    columns = 5,
    rows = 10,
    hasHeader = true,
    hasActions = true
  } = $props();
  
  const headerWidths = ["w-1/4", "w-1/3", "w-1/5", "w-1/6", "w-1/8"];
  const cellWidths = ["w-2/3", "w-3/4", "w-1/2", "w-5/6", "w-4/5"];
</script>

<div class="space-y-4">
  <!-- Table header skeleton -->
  {#if hasHeader}
    <div class="grid gap-4" style="grid-template-columns: repeat({columns}, 1fr)">
      {#each Array(columns) as _, i}
        <Skeleton class="h-4 {headerWidths[i % headerWidths.length]}" />
      {/each}
    </div>
    <Skeleton class="h-px w-full" />
  {/if}
  
  <!-- Table rows skeleton -->
  {#each Array(rows) as _, rowIndex}
    <div class="grid gap-4 py-2" style="grid-template-columns: repeat({columns}, 1fr)">
      {#each Array(columns) as _, colIndex}
        {#if hasActions && colIndex === columns - 1}
          <div class="flex gap-2">
            <Skeleton class="h-8 w-16" />
            <Skeleton class="h-8 w-16" />
          </div>
        {:else}
          <Skeleton class="h-4 {cellWidths[colIndex % cellWidths.length]}" />
        {/if}
      {/each}
    </div>
  {/each}
</div>