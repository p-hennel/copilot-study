<script lang="ts">
  import { Button } from "$ui/button";
  import { Skeleton } from "$ui/skeleton";
  import { Textarea } from "$ui/textarea";
  import { toast } from "svelte-sonner";
  import { onMount } from "svelte";
  import * as Tabs from "$lib/components/ui/tabs/index.js";
  import Highlight, { LineNumbers } from "svelte-highlight";
  import yaml from "svelte-highlight/languages/yaml";
  import * as highlightStyle from "svelte-highlight/styles/intellij-light";
  
  let { data } = $props();

  // Settings Tab State
  let settingsYaml = $state("");
  let isLoadingSettings = $state(false);
  let settingsError = $state<string | null>(null);

  async function fetchSettings() {
    isLoadingSettings = true;
    settingsError = null;
    try {
      const response = await fetch("/api/admin/settings");
      if (!response.ok) {
        throw new Error(`Failed to fetch settings: ${response.statusText}`);
      }
      const result = (await response.json()) as { yaml?: string; error?: string };
      if (result.yaml) {
        settingsYaml = result.yaml;
      } else {
        throw new Error(result.error || "Received invalid response from server");
      }
    } catch (error: any) {
      settingsError = error.message || "An unknown error occurred";
      toast.error("Failed to load settings", { description: settingsError ?? "" });
    } finally {
      isLoadingSettings = false;
    }
  }

  async function saveSettings() {
    isLoadingSettings = true;
    settingsError = null;
    try {
      const response = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yaml: settingsYaml })
      });
      const result = (await response.json()) as {
        success?: boolean;
        message?: string;
        error?: string;
        details?: any;
      };
      if (!response.ok || !result.success) {
        throw new Error(result.error || `Failed to save settings: ${response.statusText}`);
      }
      toast.success(result.message || "Settings saved successfully!");
    } catch (error: any) {
      settingsError = error.message || "An unknown error occurred";
      toast.error("Failed to save settings", { description: settingsError ?? "" });
    } finally {
      isLoadingSettings = false;
    }
  }

  onMount(() => {
    // Fetch settings when the component mounts
    fetchSettings();
  });
</script>

{#snippet btns(fullWidth: boolean = false)}
  <div class={`flex-1 grow flex flex-row gap-2 justify-end ${fullWidth ? 'w-full max-w-full min-w-full' : ''}`}>
    <Button onclick={fetchSettings} variant="outline" disabled={isLoadingSettings}>
      Reload Settings
    </Button>

    <Button onclick={saveSettings} disabled={isLoadingSettings}>
      {#if isLoadingSettings}
        Saving...
      {:else}
        Save Settings
      {/if}
    </Button>
  </div>
{/snippet}

{#snippet editor(value: string, highlighting: boolean)}
  <div class="flex flex-col">
    <div class="relative mb-4">
      {#if highlighting}
        <Highlight class="rounded-2xl z-0 pointer-events-none" language={yaml} code={settingsYaml} let:highlighted>
          <LineNumbers {highlighted} hideBorder />
        </Highlight>
      {/if}
      <div class="z-10 ml-[3px] pl-14 pt-2 -mt-[1px] absolute top-0 w-full h-full">
        <Textarea
          bind:value={settingsYaml}
          class={`pl-2 pt-2 z-20 font-mono text-md h-full w-full max-h-full resize-none block ${highlighting ? 'text-transparent caret-red-500' : 'bg-white'}`}
          placeholder="Settings in YAML format..."
          disabled={isLoadingSettings}
        />
      </div>
      {#if !highlighting}
        <Highlight class="rounded-2xl z-0 pointer-events-none" language={yaml} code={settingsYaml} let:highlighted>
          <LineNumbers {highlighted} hideBorder />
        </Highlight>
      {/if}
    </div>

    {@render btns(true)}
  </div>
{/snippet}

<svelte:head>
  {@html highlightStyle.default}
</svelte:head>

<div class="space-y-6">
  <!-- Page Header -->
  <div>
    <h1 class="text-3xl font-bold">System Settings</h1>
    <p class="text-muted-foreground mt-2">Configure application settings in YAML format</p>
  </div>

  <!-- Settings Editor -->
  <div class="space-y-4">
    <h2 class="text-xl font-semibold">Application Settings (YAML)</h2>
    
    {#if isLoadingSettings}
      <div class="space-y-4">
        <p class="text-muted-foreground">Loading settings...</p>
        <Skeleton class="h-96 w-full" />
      </div>
    {:else if settingsError}
      <div class="space-y-4">
        <p class="text-destructive">Error loading settings: {settingsError}</p>
        <Button onclick={fetchSettings} variant="outline">
          Retry Loading Settings
        </Button>
      </div>
    {:else}
      <div class="flex flex-col gap-2">
        <div class="flex flex-row justify-between">
          <p class="text-sm text-muted-foreground">
            Edit the application settings below. Changes will take effect after saving and may require a restart.
          </p>
          <div class="flex gap-2">
            {@render btns()}
          </div>
        </div>

        <Tabs.Root value="preview" class="w-full">
          <Tabs.List class="ml-16 mb-0">
            <Tabs.Trigger value="preview">Preview</Tabs.Trigger>
            <Tabs.Trigger value="editor">Highlighted Editor</Tabs.Trigger>
            <Tabs.Trigger value="simple-editor">Simple Editor</Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="preview">
            <Highlight class="rounded-2xl" language={yaml} code={settingsYaml} let:highlighted>
              <LineNumbers {highlighted} hideBorder />
            </Highlight>
          </Tabs.Content>
          <Tabs.Content value="editor">
            {@render editor(settingsYaml, true)}
          </Tabs.Content>
          <Tabs.Content value="simple-editor">
            {@render editor(settingsYaml, false)}
          </Tabs.Content>
        </Tabs.Root>
      </div>
    {/if}
  </div>
</div>