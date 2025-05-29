<script lang="ts">
  import { adminLoading } from '$lib/stores/admin-loading';
  import { onMount } from 'svelte';
  import AdminPageSkeleton from './skeletons/AdminPageSkeleton.svelte';
  import TableSkeleton from './skeletons/TableSkeleton.svelte';
  import StatsCardSkeleton from './skeletons/StatsCardSkeleton.svelte';
  import CardGridSkeleton from './skeletons/CardGridSkeleton.svelte';
  
  let {
    data,
    loadingType = 'page',
    operationId = crypto.randomUUID(),
    errorMessage = 'Failed to load data',
    children,
    fallback
  }: {
    data: Promise<any>;
    loadingType?: 'page' | 'table' | 'stats' | 'cards';
    operationId?: string;
    errorMessage?: string;
    children: any;
    fallback?: any;
  } = $props();
  
  onMount(() => {
    adminLoading.startOperation({
      id: operationId,
      type: 'data',
      description: 'Loading data...'
    });
    
    return () => {
      adminLoading.endOperation(operationId);
    };
  });
  
  function getSkeletonComponent(type: string) {
    switch (type) {
      case 'table': return TableSkeleton;
      case 'stats': return StatsCardSkeleton;
      case 'cards': return CardGridSkeleton;
      default: return AdminPageSkeleton;
    }
  }
  
  const SkeletonComponent = getSkeletonComponent(loadingType);
</script>

{#await data}
  {#if fallback}
    {@render fallback()}
  {:else if loadingType === 'table'}
    <TableSkeleton />
  {:else if loadingType === 'stats'}
    <StatsCardSkeleton />
  {:else if loadingType === 'cards'}
    <CardGridSkeleton />
  {:else}
    <AdminPageSkeleton />
  {/if}
{:then resolvedData}
  {@render children({ data: resolvedData })}
{:catch error}
  <div class="text-center py-8">
    <div class="text-destructive mb-2">{errorMessage}</div>
    <div class="text-sm text-muted-foreground">{error.message}</div>
  </div>
{/await}