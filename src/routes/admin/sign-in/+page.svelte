<script lang="ts">
  import { Button } from "$ui/button/index.js";
  import * as Card from "$ui/card/index.js";
  import { authClient } from "$lib/auth-client";
  import { m } from "$paraglide";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { redirect } from "@sveltejs/kit";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import CircleAlert from "lucide-svelte/icons/circle-alert";
  import { goto } from "$app/navigation";

  let email = $state("");
  let password = $state("");
  let errorMsg = $state("");

  async function signin() {
    const { data, error } = await authClient.signIn.email({
      email,
      password
    });
    if (!!data && !error) {
      goto("/admin");
    } else {
      errorMsg = error.message || "";
    }
  }
</script>

<div class="flex h-screen w-full items-center justify-center px-4">
  <Card.Root class="mx-auto max-w-sm min-w-80">
    <Card.Header>
      <Card.Title class="text-2xl">{m["admin.signin.title"]()}</Card.Title>
    </Card.Header>
    <Card.Content>
      <form onsubmit={signin}>
        <div class="grid gap-4">
          {#if errorMsg.length > 0}
            <Alert.Root variant="destructive">
              <CircleAlert class="size-4" />
              <Alert.Title>{m["admin.signin.failed"]()}</Alert.Title>
              <Alert.Description>
                {errorMsg}
              </Alert.Description>
            </Alert.Root>
          {/if}
          <div class="flex w-full max-w-sm flex-col gap-1.5">
            <Label for="email">{m["admin.signin.email"]()}</Label>
            <Input
              type="email"
              bind:value={email}
              id="email"
              placeholder={m["admin.signin.email"]()}
            />
          </div>
          <div class="flex w-full max-w-sm flex-col gap-1.5">
            <Label for="password">{m["admin.signin.password"]()}</Label>
            <Input
              type="password"
              bind:value={password}
              id="password"
              placeholder={m["admin.signin.password"]()}
            />
          </div>
          <Button type="submit" class="w-full">{m["admin.signin.action"]()}</Button>
        </div>
      </form>
    </Card.Content>
  </Card.Root>
</div>
