<script lang="ts">
  import BorderBeam from "$components/ui-mod/BorderBeam.svelte";
  import SparklesText from "$components/ui-mod/SparklesText.svelte";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { ContentType, type Content } from "$lib/types";
  import { m } from "$paraglide";
  import * as icons from "@lucide/svelte";
  import Markdown from "svelte-exmarkdown";

  let { contents, user }: { contents: Content[]; user?: object } = $props();
</script>

<p class="mb-0">
  {m["home.intro"]()}
</p>

{#each contents as content, idx (idx)}
  {#if content.type === ContentType.Markdown}
    <Markdown md={content.content} />
  {:else if content.type === ContentType.Alert}
    <Alert.Root class="relative mx-auto my-12 max-w-200 rounded-3xl">
      {#if !user}
        <BorderBeam duration={4} borderWidth={2.5} />
      {/if}
      {#if content.icon}
        {@const Icon = icons[content.icon]}
        <Icon class="mt-2.5" color="#581c87" strokeWidth={2} size={64} />
      {/if}
      <Alert.Title>
        <h1
          class="mb-0 ml-12 text-center text-3xl font-bold tracking-tighter md:text-4xl lg:text-6xl"
        >
          <SparklesText
            colors={{ first: "#fcd34d", second: "#fda4af" }}
            sparklesCount={8}
            lifespanMin={12}
            lifespanFactor={22}
            textClass="bg-gradient-to-tl from-slate-900 via-purple-900 to-slate-900 bg-clip-text text-transparent"
            text={content.title}
          />
        </h1>
      </Alert.Title>
      <Alert.Description class="ml-12 text-center md:text-lg lg:text-xl">
        {content.content}
      </Alert.Description>
    </Alert.Root>
  {/if}
{/each}
