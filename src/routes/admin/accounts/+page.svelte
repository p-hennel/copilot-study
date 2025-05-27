<script lang="ts">
  import UserTable from "$lib/components/UserTable.svelte";
  import { Skeleton } from "$ui/skeleton";
  
  let { data } = $props();

  const randomWidths = ["w-1/2", "w-2/3", "w-3/4", "w-5/6", "w-7/12", "w-10/12", "w-11/12"];
  const getLoadingClassForColumn = (idx: number) => {
    if (idx === 0) return "h-4 w-3/4 ml-auto";
    const randomWidth = randomWidths[Math.floor(Math.random() * randomWidths.length)];
    return `col-span-${idx === 2 ? "4" : "2"} h-4 ${idx > 4 ? "mx-auto " : ""}${randomWidth}`;
  };
  const loadingRows = Array.from({ length: 20 }, () =>
    Array.from({ length: 7 }, (_, idx) => getLoadingClassForColumn(idx))
  );
</script>

<div class="space-y-6">
  <!-- Page Header -->
  <div>
    <h1 class="text-3xl font-bold">User Accounts</h1>
    <p class="text-muted-foreground mt-2">Manage user accounts and permissions</p>
  </div>

  <!-- Users Table -->
  <div class="space-y-4">
    {#await data.users}
      <Skeleton class="my-2 h-4 w-1/12" />
      <Skeleton class="my-2 h-4 w-1/4" />

      <div class="mb-12 grid grid-cols-15 items-center gap-3">
        <div class="row-span-2 content-center">
          <Skeleton class="ml-auto h-6 w-3/4" />
        </div>
        <div class="col-span-2 row-span-2 content-center">
          <Skeleton class="h-6 w-1/2" />
        </div>
        <div class="col-span-4 row-span-2 content-center">
          <Skeleton class="h-6 w-1/3" />
        </div>
        <div class="col-span-2 row-span-2 content-center">
          <Skeleton class="mx-auto h-6 w-3/4" />
        </div>
        <div class="col-span-6 content-center">
          <Skeleton class="mx-auto h-6 w-1/3" />
        </div>
        <Skeleton class="col-span-2 h-6" />
        <Skeleton class="col-span-2 mx-auto h-6 w-2/3" />
        <Skeleton class="col-span-2 mx-auto h-6 w-2/3" />

        {#each loadingRows as row, idxR (idxR)}
          {#each row as col, idxC (idxC)}
            <Skeleton class={col} />
          {/each}
        {/each}
      </div>
    {:then users}
      {#if users && Array.isArray(users)}
        <UserTable users={users as any[]} />
      {:else}
        <div class="text-center py-8 text-muted-foreground">
          No user data available
        </div>
      {/if}
    {:catch error}
      <div class="text-destructive text-center py-8">
        Failed to load user accounts: {error.message}
      </div>
    {/await}
  </div>
</div>