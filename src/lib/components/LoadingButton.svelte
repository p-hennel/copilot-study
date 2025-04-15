<script lang="ts">
  import { Button, type ButtonVariant } from "@/button";
  import { LoaderCircle } from "lucide-svelte";

  type LoadingButtonProps = {
    icon: any;
    variant?: ButtonVariant;
    fn: <T>(...rest: any[]) => Promise<T> | T | void | Promise<void>;
    disabled?: boolean;
    children?: any;
  };
  const { children, icon: Icon, fn, disabled, variant }: LoadingButtonProps = $props();

  let loading = $state(false);
</script>

<Button
  {variant}
  onclick={async () => {
    loading = true;
    await fn();
    loading = false;
  }}
  disabled={(disabled ?? false) || loading}
>
  {#if loading}
    <LoaderCircle class="animate-spin" />
  {:else}
    <Icon></Icon>
  {/if}
  {@render children?.()}
</Button>
