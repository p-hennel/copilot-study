<script lang="ts">
  import { Button } from "$ui/button/index.js";
  import { Input } from "$ui/input/index.js";
  import { m } from "$paraglide";
</script>

<form class="flex w-full max-w-sm items-center space-x-2" method="POST">
  <Input type="email" placeholder={m["home.email.placeholder"]()} name="email" />
  <Button type="submit">{m["home.email.action"]()}</Button>
</form>
