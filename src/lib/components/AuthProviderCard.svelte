<script lang="ts">
  import { cn } from "$lib/utils"
  import { TokenProvider } from "$lib/types"
  import { m } from "$paraglide"
  import * as Card from "$ui/card/index"
  import AuthProvider from "./AuthProvider.svelte"
  import { Checkbox } from "$lib/components/ui/checkbox/index.js"
  import { Label } from "$lib/components/ui/label/index.js"

  let {
    iconSize = 12,
    class: className,
    loading = $bindable(),
    onclick,
    textId,
    doneTextId,
    Icon,
    provider,
    linkedAccounts,
    nextUrl,
    isLoggedIn = false
  }: {
    iconSize: 8 | 10 | 12
    class: string
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
  let providerName = $derived.by(() => {
    return {
      name: getProviderText(provider, "name"),
      description: getProviderText(provider, "description")
    }
  })

  function getProviderText(provider: TokenProvider, detail: "name" | "description") {
    try {
      const providerId: keyof typeof m = `auth.providers.${provider}.${detail}`
      return m[providerId]()
    } catch {
      return provider as string
    }
  }

  let acceptedConditions = $state(isLoggedIn)
</script>

<Card.Root class={cn("flex w-full flex-col", className)}>
  <Card.Header>
    <Card.Title class="relative text-2xl">
      {providerName.name}
      <span class={`absolute size-${iconSize} -top-2 right-0 inline-block`}>
        <Icon />
      </span>
    </Card.Title>
  </Card.Header>
  <Card.Content class="mt-0 flex-1 pt-2">
    <p class="text-justify">
      {providerName.description}
    </p>
    <div class="mt-3 flex items-center space-x-2">
      <Checkbox disabled={isLoggedIn} id="terms1" bind:checked={acceptedConditions} />
      <div class="grid gap-1.5 leading-none">
        <Label for="terms1">
          I willingly participate in this study and I am aware that participation is absolutely voluntarily and that I
          can leave this page if I do not want to participate. By checking this box and clicking on authorize below, I
          confirm my participation.
        </Label>
      </div>
    </div>
  </Card.Content>
  <Card.Footer>
    <AuthProvider
      {linkedAccounts}
      bind:loading
      {onclick}
      {textId}
      {isLoggedIn}
      {doneTextId}
      {Icon}
      {provider}
      {nextUrl}
      forceDisabled={!acceptedConditions}
    />
  </Card.Footer>
</Card.Root>
