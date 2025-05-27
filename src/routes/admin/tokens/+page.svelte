<script lang="ts">
  import TokensInfo from "$components/TokensInfo.svelte";
  
  let { data } = $props();
</script>

<div class="space-y-6">
  <!-- Page Header -->
  <div>
    <h1 class="text-3xl font-bold">Tokens</h1>
    <p class="text-muted-foreground mt-2">Manage API tokens</p>
  </div>

  <!-- Token Information -->
  <div class="space-y-4">
    <h2 class="text-xl font-semibold">Token Information</h2>
    {#await data.tokenInfos}
      <div class="flex items-center justify-center p-8">
        <div class="text-muted-foreground">Loading tokens...</div>
      </div>
    {:then tokenInfos}
      <TokensInfo infos={(tokenInfos as any).result} />
    {:catch error}
      <div class="text-destructive">Failed to load token information: {error.message}</div>
    {/await}
  </div>
</div>