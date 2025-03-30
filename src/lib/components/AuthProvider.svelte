<script lang="ts">
  import { Button, type ButtonVariant } from "$ui/button"
  import { BadgeCheck, KeyRound } from "lucide-svelte"
  import { m } from "$paraglide"
  import { linkAccount, signIn } from "$lib/auth-client"
  import { Skeleton } from "$lib/components/ui/skeleton/index.js"
  import type { TokenProvider } from "$lib/utils"
  import { page } from "$app/stores" // Import page store

  let {
    loading = $bindable(),
    onclick,
    textId,
    doneTextId,
    Icon,
    provider,
    linkedAccounts,
    nextUrl = $page.url.pathname, // Add default value
    isLoggedIn = false
  }: {
    loading: boolean
    onclick?: () => void | Promise<void>
    textId: keyof typeof m
    doneTextId?: keyof typeof m
    Icon?: any
    provider: TokenProvider
    linkedAccounts?: string[]
    nextUrl?: string
    isLoggedIn: boolean
  } = $props()
  let accountState = $derived.by(() => {
    const isAuthenticated = !!linkedAccounts && linkedAccounts.includes(provider)
    const variant: ButtonVariant = isAuthenticated ? "outline" : "default"
    return {
      variant,
      isAuthenticated
    }
  })

  const fallbackClickHandler = () => {
    loading = true
    if (isLoggedIn) {
      linkAccount(provider, nextUrl)
    } else {
      signIn(provider, nextUrl)
    }
  }
</script>

<div class="w-full">
  {#if loading}
    <Skeleton class="h-8 w-full" />
  {:else}
    <Button
      disabled={loading}
      onclick={onclick ?? fallbackClickHandler}
      variant={accountState.variant}
      class="w-full cursor-pointer"
    >
      {#if accountState.isAuthenticated}
        <BadgeCheck class="mr-0 size-4" />
      {:else if !!Icon}
        <Icon class="mr-2 size-4" />
      {:else}
        <KeyRound class="mr-2 size-4" />
      {/if}
      {m[!!doneTextId && accountState.isAuthenticated ? doneTextId : textId]({ maxAccounts: {}, user_count: {} })}
    </Button>
  {/if}
</div>
