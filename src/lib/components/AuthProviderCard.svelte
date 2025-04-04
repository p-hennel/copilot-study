<script lang="ts">
  import { cn } from "$lib/utils"
  import { TokenProvider } from "$lib/types"
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { m } from "$paraglide"
  import * as Card from "$ui/card/index"
  import AuthProvider from "./AuthProvider.svelte"
  import { Checkbox } from "$lib/components/ui/checkbox/index.js"
  import { Switch } from "$lib/components/ui/switch/index.js";
  import { Label } from "$lib/components/ui/label/index.js"
    import AuroraText from "./ui-mod/AuroraText.svelte";

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

  const useSwitch = true
</script>

<Card.Root class={cn("flex w-full flex-col", className)}>
  <Card.Header>
    <Card.Title class="relative">
      <AuroraText class="text-6xl font-black">{providerName.name}</AuroraText>
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
      {#if useSwitch}
        <Switch disabled={isLoggedIn} id={`terms-${provider}`} class="rounded-2xl" bind:checked={acceptedConditions} />
        <Label for={`terms-${provider}`} class="text-md leading-tight">
          I willingly participate in this study and I am aware that participation is absolutely voluntarily and that I can leave this page if I do not want to participate. By checking this box and clicking on authorize below, I confirm my participation.
        </Label>
      {:else}
        <Checkbox disabled={isLoggedIn} id={`terms-${provider}`} class="rounded-2xl" bind:checked={acceptedConditions} />
        <div class="grid gap-1.5 leading-none">
          <Label for={`terms-${provider}`} class="text-md leading-tight">
            I willingly participate in this study and I am aware that participation is absolutely voluntarily and that I
            can leave this page if I do not want to participate. By checking this box and clicking on authorize below, I
            confirm my participation.
          </Label>
        </div>
      {/if}
    </div>
  </Card.Content>
  <Card.Footer>
    <Tooltip.Provider delayDuration={0}>
      <Tooltip.Root>
        <Tooltip.Trigger class="w-full" disabled={acceptedConditions}>
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
  </Tooltip.Trigger>
  <Tooltip.Content side="top" sideOffset={5} class="text-sm">
    Please check the disclaimer-box to indicate your voluntary participation — thank you!
  </Tooltip.Content>
</Tooltip.Root>
</Tooltip.Provider>
  </Card.Footer>
</Card.Root>
