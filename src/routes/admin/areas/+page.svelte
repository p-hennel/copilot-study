<script lang="ts">
  import AreasTable from "$lib/components/AreasTable.svelte";
  
  let { data } = $props();
</script>

<div class="space-y-6">
  <!-- Page Header -->
  <div>
    <h1 class="text-3xl font-bold">Survey Areas</h1>
    <p class="text-muted-foreground mt-2">Configure and manage survey areas and regions</p>
  </div>

  <!-- Areas Table -->
  <div class="space-y-4">
    {#await data.areas}
      <div class="flex items-center justify-center p-8">
        <div class="text-muted-foreground">Loading areas...</div>
      </div>
    {:then areas}
      {#if areas && Array.isArray(areas)}
        <AreasTable areas={areas as any[]} />
      {:else}
        <div class="text-center py-8 text-muted-foreground">
          No area data available
        </div>
      {/if}
    {:catch error}
      <div class="text-destructive text-center py-8">
        Failed to load survey areas: {error.message}
      </div>
    {/await}
  </div>
</div>