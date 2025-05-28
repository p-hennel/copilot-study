<script lang="ts">
  import JobsTable from "$lib/components/JobsTable.svelte";
</script>

<div class="space-y-6">
  <!-- Page Header -->
  <div>
    <h1 class="text-3xl font-bold">Job Management</h1>
    <p class="text-muted-foreground mt-2">Monitor and manage system jobs</p>
  </div>

  <!-- Jobs Table -->
  <div class="space-y-4">
    <JobsTable />
  </div>
</div>