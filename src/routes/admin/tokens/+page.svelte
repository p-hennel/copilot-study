<script lang="ts">
  import TokensInfo from "$components/TokensInfo.svelte";
  import Input from "@/input/input.svelte";
  import { Button } from "$ui/button";
  import { ClipboardCopy } from "@lucide/svelte";
  import { clickToCopy } from "$lib/utils";
  import { toast } from "svelte-sonner";
  
  let { data } = $props();

  let toBeHashed = $state(data.user?.email ?? "");
  let hashedValue = $state("");

  async function hashValue() {
    try {
      const response = await fetch("/api/admin/hash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: toBeHashed })
      });
      const result: any = await response.json();
      if (result.error || !result.success) {
        toast.error("Error hashing value", { description: result.error });
        hashedValue = result.error;
      } else {
        hashedValue = result.hashedValue;
      }
    } catch (error) {
      toast.error("Failed to hash value", { 
        description: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  }
</script>

<div class="space-y-6">
  <!-- Page Header -->
  <div>
    <h1 class="text-3xl font-bold">Tokens</h1>
    <p class="text-muted-foreground mt-2">Manage API tokens and generate hashed values</p>
  </div>

  <!-- Token Information -->
  <div class="space-y-4">
    <h2 class="text-xl font-semibold">Token Information</h2>
    {#await data.tokenInfos}
      <div class="flex items-center justify-center p-8">
        <div class="text-muted-foreground">Loading tokens...</div>
      </div>
    {:then tokenInfos}
      <TokensInfo infos={tokenInfos.result} />
    {:catch error}
      <div class="text-destructive">Failed to load token information: {error.message}</div>
    {/await}
  </div>

  <!-- Hash Generator -->
  <div class="space-y-4">
    <h2 class="text-xl font-semibold">Hash Generator</h2>
    <p class="text-sm text-muted-foreground">
      Generate hashed values for secure storage and comparison.
    </p>
    
    <div class="flex flex-row gap-4">
      <Input
        type="text"
        bind:value={toBeHashed}
        class="font-mono flex-1"
        placeholder="Value to hash"
      />
      <Button onclick={hashValue}>
        Hash Value
      </Button>
    </div>

    <div
      class="flex flex-wrap flex-row cursor-pointer font-mono border-2 border-slate-300 p-2 rounded-md min-h-[2.5rem] items-center"
      use:clickToCopy={hashedValue}
    >
      <ClipboardCopy 
        color={hashedValue && hashedValue.length > 0 ? '#000000' : '#9ca3af'} 
        class="mr-2 flex-shrink-0" 
      />
      <span class="break-all">{hashedValue || "Hashed value will appear here..."}</span>
    </div>
    
    {#if hashedValue}
      <p class="text-xs text-muted-foreground">
        Click the box above to copy the hashed value to clipboard.
      </p>
    {/if}
  </div>
</div>