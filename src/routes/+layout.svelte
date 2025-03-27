<script lang="ts">
  import "../app.css";
  let { children } = $props();
</script>

<div class="relative container mt-8 pb-8">
  <section>
    <div class="overflow-hidden p-8">
      {@render children()}
    </div>
  </section>
</div>
