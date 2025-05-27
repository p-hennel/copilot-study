<script lang="ts">
  import JobsTable from "$lib/components/JobsTable.svelte";
  import { toast } from "svelte-sonner";
  
  let { data } = $props();

  // Jobs State with refresh capability
  let jobsData = $state(data.jobs);

  // Jobs Refresh Function
  async function refreshJobs() {
    try {
      const token = await data.sessiontoken;
      const response = await fetch("/api/admin/jobs", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch jobs: ${response.statusText}`);
      }

      const jobs = await response.json();
      jobsData = Promise.resolve(jobs);
      toast.success("Jobs refreshed successfully");
    } catch (error) {
      console.error("Failed to refresh jobs:", error);
      toast.error("Failed to refresh jobs", {
        description: error instanceof Error ? error.message : "An unknown error occurred"
      });
    }
  }
</script>

<div class="space-y-6">
  <!-- Page Header -->
  <div>
    <h1 class="text-3xl font-bold">Job Management</h1>
    <p class="text-muted-foreground mt-2">Monitor and manage system jobs</p>
  </div>

  <!-- Jobs Table -->
  <div class="space-y-4">
    {#await jobsData}
      <div class="flex items-center justify-center p-8">
        <div class="text-muted-foreground">Loading jobs...</div>
      </div>
    {:then jobs}
      {#if jobs && Array.isArray(jobs)}
        <JobsTable jobs={jobs as any[]} onRefresh={refreshJobs} />
      {:else}
        <div class="text-center py-8 text-muted-foreground">
          No job data available
        </div>
      {/if}
    {:catch error}
      <div class="text-destructive text-center py-8">
        Failed to load jobs: {error.message}
      </div>
    {/await}
  </div>
</div>