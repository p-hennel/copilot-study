<script lang="ts">
  import "../app.css";
  import { Button } from "$lib/components/ui/button";
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
  } from "$lib/components/ui/dropdown-menu";
  import { Avatar, AvatarFallback, AvatarImage } from "$lib/components/ui/avatar";
  import { LogOut, Mail, UserCog } from "lucide-svelte"; // Import icons
  import type { LayoutData } from "./$types"; // Import LayoutData type

  // Use standard Svelte export for layout data
  export let data: LayoutData;

  // Reactive user data using standard Svelte reactivity from data prop
  $: user = data.user;

  // Function to get initials for avatar fallback
  function getInitials(name: string | undefined | null): string {
    if (!name) return "?";
    const names = name.trim().split(/\s+/); // Trim and split by whitespace
    if (names.length === 0 || !names[0]) return "?"; // Handle empty or whitespace-only names
    if (names.length === 1) return names[0].charAt(0).toUpperCase();
    // Ensure the last name part exists before accessing charAt
    const lastNamePart = names[names.length - 1];
    if (!lastNamePart) return names[0].charAt(0).toUpperCase(); // Fallback if last part is empty
    return (names[0].charAt(0) + lastNamePart.charAt(0)).toUpperCase();
  }
</script>

<!-- Added relative positioning to the main container -->
<div class="relative container mt-8 min-h-screen pb-8">
  <!-- User Dropdown - Positioned Top Right -->
  {#if user}
    <div class="float-end inline">
      <DropdownMenu>
        <DropdownMenuTrigger>
          <!-- Button acts as the trigger -->
          <Button
            variant="ghost"
            class="relative w-auto cursor-pointer justify-start space-x-2 px-3 py-6"
          >
            <Avatar class="h-8 w-8">
              <AvatarImage src={user.image ?? undefined} alt={user.name ?? "User"} />
              <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
            </Avatar>
            <span class="hidden pr-1 sm:inline-block">{user.name ?? "Account"}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent class="w-56" align="end">
          <DropdownMenuLabel class="flex w-full items-center font-normal">
            <Mail class="mt-0.5 mr-2 h-4 w-4" />
            {user.email ?? "No Email"}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {#if user.role === "admin"}
            <DropdownMenuItem>
              <a href="/admin" class="flex w-full items-center">
                <UserCog class="mr-2 h-4 w-4" />
                <span>Administration</span>
              </a>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          {/if}
          <!-- Logout Item using a link (removed data-sveltekit-reload) -->
          <DropdownMenuItem>
            <a href="/logout" class="flex w-full items-center">
              <LogOut class="mr-2 h-4 w-4" />
              <span>Log out</span>
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  {/if}

  <section>
    <!-- Added padding-top to avoid overlap -->
    <div class="overflow-hidden p-8 pt-16">
      <slot />
    </div>
  </section>
</div>
