<script lang="ts">
  import { Separator } from "$ui/separator";
  import Button from "$ui/button/button.svelte";
</script>

<h1 class="text-4xl font-extrabold">Ooops.</h1>
<p>
  You are seeing this page, because the previous url pointed to a non-existant or not-yet-finished
  data collection.
</p>

<Separator class="my-4" />

<Button variant="default" href="/" class="h-16 w-full text-xl font-bold">Take me back!</Button>
