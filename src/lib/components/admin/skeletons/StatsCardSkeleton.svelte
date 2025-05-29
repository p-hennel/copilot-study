<script lang="ts">
  import * as Card from "$lib/components/ui/card/index.js";
  import { Skeleton } from "$lib/components/ui/skeleton";
  
  let { count = 4 } = $props();
</script>

<div class="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
  {#each Array(count) as _}
    <Card.Root>
      <Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
        <Skeleton class="h-4 w-20" />
        <Skeleton class="h-4 w-4" />
      </Card.Header>
      <Card.Content>
        <Skeleton class="h-8 w-16" />
        <Skeleton class="h-3 w-24 mt-2" />
      </Card.Content>
    </Card.Root>
  {/each}
</div>