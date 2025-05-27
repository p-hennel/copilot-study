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
    <AreasTable />
  </div>
</div>