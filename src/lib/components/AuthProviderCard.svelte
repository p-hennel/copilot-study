<script lang="ts">
  import { cn, TokenProvider } from "$lib/utils";
  import { m } from "$paraglide";
  import * as Card from "$ui/card/index";
  import AuthProvider from "./AuthProvider.svelte";

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
    iconSize: 8 | 10 | 12;
    class: string;
    loading: boolean;
    onclick?: () => void | Promise<void>;
    textId: keyof typeof m;
    doneTextId?: keyof typeof m;
    Icon?: any;
    provider: TokenProvider;
    linkedAccounts?: string[];
    nextUrl?: string;
    isLoggedIn: boolean;
  } = $props();
  let providerName = $derived.by(() => {
    return {
      name: getProviderText(provider, "name"),
      description: getProviderText(provider, "description")
    };
  });

  function getProviderText(provider: TokenProvider, detail: "name" | "description") {
    try {
      const providerId: keyof typeof m = `auth.providers.${provider}.${detail}`;
      return m[providerId]();
    } catch {
      return provider as string;
    }
  }
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
    />
  </Card.Footer>
</Card.Root>
