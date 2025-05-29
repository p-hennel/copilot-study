<script lang="ts">
  import * as Card from "$lib/components/ui/card/index.js";
  import { Skeleton } from "$lib/components/ui/skeleton";
  
  let { 
    count = 6,
    columns = 3,
    hasActions = true
  } = $props();
</script>

<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-{columns}">
  {#each Array(count) as _}
    <Card.Root>
      <Card.Header>
        <div class="flex items-center gap-2">
          <Skeleton class="h-5 w-5" />
          <Skeleton class="h-5 w-32" />
        </div>
        <Skeleton class="h-4 w-48 mt-2" />
      </Card.Header>
      {#if hasActions}
        <Card.Content>
          <Skeleton class="h-10 w-full" />
        </Card.Content>
      {/if}
    </Card.Root>
  {/each}
</div>