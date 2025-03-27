<script lang="ts">
  import { Button } from "$ui/button/index.js";
  import * as Card from "$ui/card/index.js";
  import { signIn } from "$lib/auth-client";
  import { m } from "$paraglide";
</script>

<Card.Root class="mx-auto max-w-sm min-w-80">
  <Card.Header>
    <Card.Title class="text-2xl">{m["auth.login.title"]()}</Card.Title>
    <Card.Description>{m["auth.login.description"]()}</Card.Description>
  </Card.Header>
  <Card.Content>
    <div class="grid gap-4">
      <Button onclick={signIn} class="w-full">{m["auth.login.action"]()}</Button>
    </div>
    <div class="mt-4 text-center text-sm">
      {m["auth.login.cta.question"]()}
      <a href="##" class="underline"> {m["auth.login.cta.action"]()}</a>
    </div>
  </Card.Content>
</Card.Root>
