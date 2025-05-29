<script lang="ts">
  import TokensInfo from "$components/TokensInfo.svelte";
  import AdminDataLoader from "$lib/components/admin/AdminDataLoader.svelte";
  
  let { data } = $props();
</script>

<div class="space-y-6">
  <!-- Page Header -->
  <div>
    <h1 class="text-3xl font-bold">Tokens</h1>
    <p class="text-muted-foreground mt-2">Manage API tokens</p>
  </div>

  <!-- Token Information with Consistent Loading -->
  <div class="space-y-4">
    <h2 class="text-xl font-semibold">Token Information</h2>
    <AdminDataLoader
      data={data.tokenInfos}
      loadingType="page"
      operationId="token-infos"
      errorMessage="Failed to load token information"
    >
      {#snippet children({ data: tokenInfos })}
        <TokensInfo infos={(tokenInfos as any).result} />
      {/snippet}
    </AdminDataLoader>
  </div>
</div>