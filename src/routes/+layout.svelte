<script lang="ts">
  import type { LayoutProps } from './$types';
  import "../app.css";

  let { data, children }: LayoutProps = $props();
</script>

<!-- Added relative positioning to the main container -->
<div class="relative m-0 p-0">
  <section>
    <!-- Added padding-top to avoid overlap -->
    <div class="overflow-hidden">
      {@render children()}
    </div>
  </section>
</div>
