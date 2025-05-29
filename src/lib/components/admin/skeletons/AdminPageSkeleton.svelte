<script lang="ts">
  import { Skeleton } from "$lib/components/ui/skeleton";
  
  let {
    title = true,
    description = true,
    headerAction = false,
    children
  }: {
    title?: boolean;
    description?: boolean;
    headerAction?: boolean;
    children?: any;
  } = $props();
</script>

<div class="space-y-6">
  {#if title || description}
    <div class="space-y-2">
      {#if title}
        <Skeleton class="h-8 w-64" />
      {/if}
      {#if description}
        <Skeleton class="h-4 w-96" />
      {/if}
      {#if headerAction}
        <Skeleton class="h-10 w-32" />
      {/if}
    </div>
  {/if}
  
  {#if children}
    {@render children()}
  {/if}
</div>