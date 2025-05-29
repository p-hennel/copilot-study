<script lang="ts">
  import AreasTable from "$lib/components/AreasTable.svelte";
  import AdminDataLoader from "$lib/components/admin/AdminDataLoader.svelte";
  
  let { data } = $props();
</script>

<div class="space-y-6">
  <!-- Page Header -->
  <div>
    <h1 class="text-3xl font-bold">Survey Areas</h1>
    <p class="text-muted-foreground mt-2">Configure and manage survey areas and regions</p>
  </div>

  <!-- Areas Table with Consistent Loading -->
  <AdminDataLoader
    data={data.areas}
    loadingType="table"
    operationId="areas-table"
    errorMessage="Failed to load survey areas"
  >
    {#snippet children()}
      <AreasTable />
    {/snippet}
  </AdminDataLoader>
</div>