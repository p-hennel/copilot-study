<script lang="ts">
  import { cn } from "$lib/utils";
  import Button from "$ui/button/button.svelte"
  import * as Card from "$ui/card/index"
  import { Globe, Mail } from "lucide-svelte";

  let data: { mail: string, url: string, name: string, title: string, role: string, subject: string, cc: string[], class?: string } = $props()
</script>

<Card.Root class={cn("flex w-xs flex-col", data.class)}>
  <Card.Header class="flex flex-row flex-wrap place-items-center">
    <Card.Title class="flex-1 text-2xl">
      {data.title} {data.name}
    </Card.Title>
    <Card.Description>
      {data.role}
    </Card.Description>
  </Card.Header>
  <Card.Footer class="flex gap-4 pt-2">
    <Button
      variant="outline"
      target="_blank"
      href={`mailto:${data.mail}?subject=${encodeURIComponent(data.subject)}&cc=${data.cc.join(",")}`}>
      <Mail class="mr-2 size-4" />
      Mail
    </Button>
    <Button
      variant="outline"
      target="_blank"
      href={data.url}>
      <Globe class="mr-2 size-4" />
      Website
    </Button>
  </Card.Footer>
</Card.Root>