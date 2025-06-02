<script lang="ts">
  import UserTable from "$lib/components/UserTable.svelte";
  import AdminDataLoader from "$lib/components/admin/AdminDataLoader.svelte";
  
  let { data } = $props();
</script>

<div class="space-y-6">
  <!-- Page Header -->
  <div>
    <h1 class="text-3xl font-bold">User Accounts</h1>
    <p class="text-muted-foreground mt-2">Manage user accounts and permissions</p>
  </div>

  <!-- Users Table with Consistent Loading -->
  <AdminDataLoader
    data={data.users}
    loadingType="table"
    operationId="users-table"
    errorMessage="Failed to load user accounts"
  >
    {#snippet children({ data: users }: {data:{users:any}})}
      {#if users && Array.isArray(users)}
        <UserTable users={users as any[]} />
      {:else}
        <div class="text-center py-8 text-muted-foreground">
          No user data available
        </div>
      {/if}
    {/snippet}
  </AdminDataLoader>
</div>