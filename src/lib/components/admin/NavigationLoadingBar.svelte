<script lang="ts">
  import { isNavigationLoading, isDataLoading } from '$lib/stores/admin-loading';
  
  $: showLoadingBar = $isNavigationLoading || $isDataLoading;
</script>

{#if showLoadingBar}
  <div class="fixed top-0 left-0 right-0 z-50">
    <div class="h-1 bg-primary/20">
      <div class="h-full bg-primary origin-left transition-transform duration-300 animate-pulse"></div>
    </div>
  </div>
{/if}