<script lang="ts">
  import ProfileWidget from "$components/ProfileWidget.svelte";
  import * as Breadcrumb from "$lib/components/ui/breadcrumb/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { page } from "$app/stores";
  import { Home, Settings, Users, MapPin, Briefcase, Key } from "lucide-svelte";
  
  let { children, data } = $props();

  // Navigation items with icons and paths
  const navItems = [
    { label: "Dashboard", path: "/admin", icon: Home },
    { label: "Tokens", path: "/admin/tokens", icon: Key },
    { label: "Accounts", path: "/admin/accounts", icon: Users },
    { label: "Areas", path: "/admin/areas", icon: MapPin },
    { label: "Jobs", path: "/admin/jobs", icon: Briefcase },
    { label: "Settings", path: "/admin/settings", icon: Settings }
  ];

  // Derived current page info
  const currentPath = $derived($page.url.pathname);
  const currentNavItem = $derived(navItems.find(item =>
    item.path === currentPath ||
    (item.path !== "/admin" && currentPath.startsWith(item.path))
  ) || navItems[0]);
</script>

<div class="min-h-screen bg-background">
  <!-- Top bar with profile -->
  <div class="border-b bg-card">
    <div class="container mx-auto px-4 py-4">
      <ProfileWidget user={data.user} class="mb-0" />
    </div>
  </div>

  <!-- Main navigation -->
  <nav class="border-b bg-muted/40">
    <div class="container mx-auto px-4">
      <!-- Breadcrumb navigation -->
      <div class="flex items-center justify-between py-4">
        <Breadcrumb.Root>
          <Breadcrumb.List>
            <Breadcrumb.Item>
              <Breadcrumb.Link href="/admin">Admin</Breadcrumb.Link>
            </Breadcrumb.Item>
            {#if currentPath !== "/admin" && currentNavItem}
              <Breadcrumb.Separator />
              <Breadcrumb.Item>
                <Breadcrumb.Page>
                  {@const IconComponent = currentNavItem.icon}
                  <IconComponent class="mr-2 h-4 w-4" />
                  {currentNavItem.label}
                </Breadcrumb.Page>
              </Breadcrumb.Item>
            {/if}
          </Breadcrumb.List>
        </Breadcrumb.Root>
      </div>
      
      <!-- Navigation buttons -->
      <div class="flex flex-wrap gap-2 pb-4">
        {#each navItems as item (item.path)}
          <Button
            variant={currentPath === item.path || (item.path !== "/admin" && currentPath.startsWith(item.path)) ? "default" : "outline"}
            size="sm"
            href={item.path}
            class="flex items-center gap-2"
          >
            {@const IconComponent = item.icon}
            <IconComponent class="h-4 w-4" />
            {item.label}
          </Button>
        {/each}
      </div>
    </div>
  </nav>

  <!-- Main content area -->
  <main class="container mx-auto px-4 py-8">
    {@render children()}
  </main>
</div>
