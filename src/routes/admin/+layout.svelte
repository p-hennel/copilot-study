<script lang="ts">
  import ProfileWidget from "$components/ProfileWidget.svelte";
  import * as Breadcrumb from "$lib/components/ui/breadcrumb/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { page } from "$app/stores";
  import { navigating } from '$app/stores';
  import { Home, Settings, Users, MapPin, Briefcase, Key, Activity } from "lucide-svelte";
  import LoadingProvider from "$lib/components/admin/LoadingProvider.svelte";
  import NavigationLoadingBar from "$lib/components/admin/NavigationLoadingBar.svelte";
  import { isNavigationLoading } from "$lib/stores/admin-loading";
  import TableSkeleton from "$lib/components/admin/skeletons/TableSkeleton.svelte";
  import AdminPageSkeleton from "$lib/components/admin/skeletons/AdminPageSkeleton.svelte";
  import StatsCardSkeleton from "$lib/components/admin/skeletons/StatsCardSkeleton.svelte";
  
  let { children, data } = $props();

  // Navigation items with icons and paths
  const navItems = [
    { label: "Dashboard", path: "/admin", icon: Home },
    { label: "Crawler Status", path: "/admin/crawler", icon: Activity },
//    { label: "Tokens", path: "/admin/tokens", icon: Key },
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
  
  // Get destination path during navigation
  const destinationPath = $derived($navigating?.to?.url.pathname || currentPath);
</script>

<LoadingProvider>
  <div class="min-h-screen bg-background">
    <NavigationLoadingBar />
    
    <!-- Main navigation -->
    <nav class="border-b bg-muted/40">
    <div class="container mx-auto px-4">
      <!-- Breadcrumb navigation -->
      <div class="flex items-center justify-between py-4">
        <div class="flex items-center gap-4">
          <Breadcrumb.Root>
            <Breadcrumb.List>
              <Breadcrumb.Item>
                <Breadcrumb.Link href="/">Home</Breadcrumb.Link>
              </Breadcrumb.Item>
              <Breadcrumb.Separator />
              <Breadcrumb.Item>
                <Breadcrumb.Link href="/admin">Admin</Breadcrumb.Link>
              </Breadcrumb.Item>
              {#if currentPath !== "/admin" && currentNavItem}
                <Breadcrumb.Separator />
                <Breadcrumb.Item>
                  <Breadcrumb.Page class="flex items-center">
                    {@const IconComponent = currentNavItem.icon}
                    <IconComponent class="mr-2 h-4 w-4" />
                    {currentNavItem.label}
                  </Breadcrumb.Page>
                </Breadcrumb.Item>
              {/if}
            </Breadcrumb.List>
          </Breadcrumb.Root>
          
          <!-- Loading indicator in breadcrumb area -->
          {#if $isNavigationLoading}
            <div class="flex items-center text-muted-foreground">
              <div class="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full mr-2"></div>
              <span class="text-sm">Loading...</span>
            </div>
          {/if}
        </div>
      </div>
      
      <!-- Navigation buttons -->
      <div class="flex flex-wrap gap-2 pb-4">
        {#if !currentPath.endsWith("/sign-in")}
          {#each navItems as item (item.path)}
            <Button
              variant={currentPath === item.path || (item.path !== "/admin" && currentPath.startsWith(item.path)) ? "default" : "outline"}
              size="sm"
              href={item.path}
              class="flex items-center gap-2"
              disabled={$isNavigationLoading}
            >
              {@const IconComponent = item.icon}
              <IconComponent class="h-4 w-4" />
              {item.label}
            </Button>
          {/each}
        {:else}
          <Button
              variant="outline"
              size="sm"
              href="/"
              class="flex items-center gap-2"
              disabled={$isNavigationLoading}
            >
              <Home class="h-4 w-4" />
              Home
            </Button>
        {/if}

        <div class="grow"></div>
        <div class="card">
          <ProfileWidget user={data.user} class="mb-0 [&_button]:py-2" />
        </div>
      </div>
    </div>
  </nav>

  <!-- Main content area -->
  <main class="container mx-auto px-4 py-8">
    {#if $isNavigationLoading}
      <!-- Show skeleton during navigation based on destination -->
      {#if destinationPath.includes('/accounts')}
        <div class="space-y-6">
          <div class="space-y-2">
            <div class="h-8 w-64 bg-muted rounded animate-pulse"></div>
            <div class="h-4 w-96 bg-muted rounded animate-pulse"></div>
          </div>
          <TableSkeleton columns={7} rows={15} />
        </div>
      {:else if destinationPath.includes('/tokens')}
        <div class="space-y-6">
          <div class="space-y-2">
            <div class="h-8 w-64 bg-muted rounded animate-pulse"></div>
            <div class="h-4 w-96 bg-muted rounded animate-pulse"></div>
          </div>
          <AdminPageSkeleton />
        </div>
      {:else if destinationPath.includes('/areas')}
        <div class="space-y-6">
          <div class="space-y-2">
            <div class="h-8 w-64 bg-muted rounded animate-pulse"></div>
            <div class="h-4 w-96 bg-muted rounded animate-pulse"></div>
          </div>
          <TableSkeleton columns={5} rows={10} />
        </div>
      {:else if destinationPath.includes('/jobs')}
        <div class="space-y-6">
          <div class="space-y-2">
            <div class="h-8 w-64 bg-muted rounded animate-pulse"></div>
            <div class="h-4 w-96 bg-muted rounded animate-pulse"></div>
          </div>
          <TableSkeleton columns={6} rows={12} />
        </div>
      {:else if destinationPath.includes('/crawler')}
       <div class="space-y-6">
         <div class="space-y-2">
           <div class="h-8 w-64 bg-muted rounded animate-pulse"></div>
           <div class="h-4 w-96 bg-muted rounded animate-pulse"></div>
         </div>
         <div class="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
           {#each Array(4) as _}
             <div class="space-y-3">
               <div class="h-4 w-20 bg-muted rounded animate-pulse"></div>
               <div class="h-8 w-16 bg-muted rounded animate-pulse"></div>
             </div>
           {/each}
         </div>
         <div class="grid gap-6 md:grid-cols-2">
           <AdminPageSkeleton />
           <AdminPageSkeleton />
         </div>
       </div>
      {:else if destinationPath.includes('/settings')}
       <div class="space-y-6">
         <div class="space-y-2">
           <div class="h-8 w-64 bg-muted rounded animate-pulse"></div>
           <div class="h-4 w-96 bg-muted rounded animate-pulse"></div>
         </div>
         <AdminPageSkeleton />
       </div>
      {:else}
        <!-- Dashboard skeleton -->
        <div class="space-y-6">
          <div class="space-y-2">
            <div class="h-8 w-64 bg-muted rounded animate-pulse"></div>
            <div class="h-4 w-96 bg-muted rounded animate-pulse"></div>
          </div>
          <StatsCardSkeleton count={4} />
          <div class="grid gap-6 md:grid-cols-2">
            <AdminPageSkeleton />
            <AdminPageSkeleton />
          </div>
        </div>
      {/if}
    {:else}
      {@render children()}
    {/if}
  </main>
  </div>
</LoadingProvider>
