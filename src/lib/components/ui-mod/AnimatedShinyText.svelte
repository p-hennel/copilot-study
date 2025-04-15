<script lang="ts">
  import { cn } from "$lib/utils";

  export let shimmerWidth = 100;
  let className: any = "";
  export { className as class };
</script>

<p
  style:--shimmer-width="{shimmerWidth}px"
  class={cn(
    "mx-auto max-w-md text-neutral-600/50 ",

    // Shimmer effect
    "animate-shimmer [background-size:var(--shimmer-width)_100%] bg-clip-text [background-position:0_0] bg-no-repeat [transition:background-position_1s_cubic-bezier(.6,.6,0,1)_infinite]",

    // Shimmer gradient
    "bg-gradient-to-r from-transparent via-black/80 via-50% to-transparent ",

    className
  )}
>
  <slot>Shimmer Animation</slot>
</p>
