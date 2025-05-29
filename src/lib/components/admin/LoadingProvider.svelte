<script lang="ts">
  import { adminLoading } from '$lib/stores/admin-loading';
  import { onMount } from 'svelte';
  import { navigating } from '$app/stores';
  
  let { children } = $props();
  
  // Track navigation loading automatically
  $effect(() => {
    if ($navigating) {
      adminLoading.startOperation({
        id: 'navigation',
        type: 'navigation',
        description: 'Navigating...'
      });
    } else {
      adminLoading.endOperation('navigation');
    }
  });
  
  // Clear loading state on unmount
  onMount(() => {
    return () => adminLoading.clear();
  });
</script>

{@render children()}