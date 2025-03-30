<script lang="ts">
  import "../app.css"
</script>

<!-- Added relative positioning to the main container -->
<div class="relative m-0 p-0">
  <section>
    <!-- Added padding-top to avoid overlap -->
    <div class="overflow-hidden p-8">
      <slot />
    </div>
  </section>
</div>
