<script lang="ts">
  import { Button } from "$ui/button";
  import { Skeleton } from "$ui/skeleton";
  import { Textarea } from "$ui/textarea";
  import { toast } from "svelte-sonner";
  import { onMount } from "svelte";
  
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
      <div class="space-y-4">
        <p class="text-sm text-muted-foreground">
          Edit the application settings below. Changes will take effect after saving and may require a restart.
        </p>
        
        <Textarea
          bind:value={settingsYaml}
          class="h-96 font-mono text-sm"
          placeholder="Settings in YAML format..."
          disabled={isLoadingSettings}
        />
        
        <div class="flex gap-2">
          <Button onclick={saveSettings} disabled={isLoadingSettings}>
            {#if isLoadingSettings}
              Saving...
            {:else}
              Save Settings
            {/if}
          </Button>
          
          <Button onclick={fetchSettings} variant="outline" disabled={isLoadingSettings}>
            Reload Settings
          </Button>
        </div>
      </div>
    {/if}
  </div>
</div>