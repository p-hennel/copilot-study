<script lang="ts">
  import { page } from "$app/stores";
  import { linkAccount, signIn } from "$lib/auth-client";
  import { Skeleton } from "$lib/components/ui/skeleton/index.js";
  import type { TokenProvider } from "$lib/types";
  import { m } from "$paraglide";
  import { Button, type ButtonVariant } from "$ui/button";
  import { BadgeCheck, KeyRound } from "lucide-svelte";
  // Import page store

  let {
    loading = $bindable(),
    onclick,
    textId,
    doneTextId,
    Icon,
    provider,
    linkedAccounts,
    nextUrl = $page.url.pathname, // Add default value
    isLoggedIn = false,
    forceDisabled = false
  }: {
    loading: boolean;
    onclick?: () => void | Promise<void>;
    textId: keyof typeof m;
    doneTextId?: keyof typeof m;
    Icon?: any;
    provider: TokenProvider;
    linkedAccounts?: string[];
    nextUrl?: string;
    isLoggedIn: boolean;
    forceDisabled: boolean;
  } = $props();
  let accountState = $derived.by(() => {
    const isAuthenticated = !!linkedAccounts && linkedAccounts.includes(provider);
    const variant: ButtonVariant = isAuthenticated ? "outline" : "default";
    return {
      variant,
      isAuthenticated
    };
  });

  const fallbackClickHandler = () => {
    loading = true;
    if (isLoggedIn) {
      linkAccount(provider, nextUrl);
    } else {
      signIn(provider, nextUrl);
    }
  };
</script>

<div class="w-full">
  {#if loading}
    <Skeleton class="h-8 w-full" />
  {:else}
    <Button
      disabled={loading || forceDisabled}
      onclick={onclick ?? fallbackClickHandler}
      variant={accountState.variant}
      class="w-full cursor-pointer py-6 text-2xl"
    >
      {#if accountState.isAuthenticated}
        <BadgeCheck class="mr-0 size-4" />
      {:else if !!Icon}
        <Icon class="mr-2 size-8" />
      {:else}
        <KeyRound class="mr-2 size-4" />
      {/if}
      {m[!!doneTextId && accountState.isAuthenticated ? doneTextId : textId]({
        maxAccounts: {},
        user_count: {}
      })}
    </Button>
  {/if}
</div>
