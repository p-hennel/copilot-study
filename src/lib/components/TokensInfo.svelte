<script lang="ts">
    import * as Card from "$ui/card/index";
    import Time from "svelte-time/Time.svelte";

  let { infos }: { infos: { provider: string, earliest: Date, latest: Date, countTotal: number, countNoExpiration: number }[] } = $props()
</script>

<div class="flex flex-wrap flex-row">
  {#each infos as info, idx (idx) }
    <Card.Root class="flex-1 max-w-xs">
      <Card.Header>
        <Card.Title class="relative">{info.provider}</Card.Title>
      </Card.Header>
      <Card.Content class="grid grid-cols-2 gap-2">
        <div>Total</div>
        <div>{info.countTotal}</div>
        <div>w/o Expiration</div>
        <div>
          {info.countNoExpiration}
          {#if info.countTotal && info.countTotal > 0}
            ({(info.countNoExpiration/info.countTotal*100).toFixed(2)}%)
          {/if}
        </div>
        <div>Earliest</div>
        <div>
          {#if info.earliest}
            <Time timestamp={info.earliest} />
          {/if}
        </div>
        <div>Latest</div>
        <div>
          {#if info.latest}
            <Time timestamp={info.latest} />
          {/if}
        </div>
      </Card.Content>
    </Card.Root>
  {/each}
</div>