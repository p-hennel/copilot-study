<script lang="ts">
  import { buttonVariants } from "$lib/components/ui/button"
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
  } from "$lib/components/ui/dropdown-menu"
  import { Avatar, AvatarFallback, AvatarImage } from "$lib/components/ui/avatar"
  import { Home, LogOut, Mail, UserCog } from "lucide-svelte" // Import icons
  import type { User } from "better-auth/types"
  import { cn } from "$lib/utils"
  import { page } from "$app/state"

  let { user, class: className }: { user: User & { role: string }; class?: string } = $props() // Use standard Svelte export for user data

  const isAdminArea = page.url.pathname.startsWith("/admin") // Check if the current URL is in the admin area

  // Function to get initials for avatar fallback
  function getInitials(name: string | undefined | null): string {
    if (!name) return "?"
    const names = name.trim().split(/\s+/) // Trim and split by whitespace
    if (names.length === 0 || !names[0]) return "?" // Handle empty or whitespace-only names
    if (names.length === 1) return names[0].charAt(0).toUpperCase()
    // Ensure the last name part exists before accessing charAt
    const lastNamePart = names[names.length - 1]
    if (!lastNamePart) return names[0].charAt(0).toUpperCase() // Fallback if last part is empty
    return (names[0].charAt(0) + lastNamePart.charAt(0)).toUpperCase()
  }
</script>

<!-- User Dropdown - Positioned Top Right -->
{#if user}
  <div class={cn("float-end inline-block", className)}>
    <DropdownMenu>
      <DropdownMenuTrigger
        class={cn(
          buttonVariants({ variant: "ghost" }),
          "relative w-auto cursor-pointer justify-start space-x-2 px-3 py-6 "
        )}
      >
        <Avatar class="h-8 w-8">
          <AvatarImage src={user.image ?? undefined} alt={user.name ?? "User"} class="mt-0" />
          <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
        </Avatar>
        <span class="hidden pr-1 sm:inline-block">{user.name ?? "Account"}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent class="w-56" align="end">
        <DropdownMenuLabel class="flex w-full items-center font-normal">
          <Mail class="mt-0.5 mr-2 h-4 w-4" />
          {user.email ?? "No Email"}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {#if user.role === "admin"}
          <DropdownMenuItem>
            {#if isAdminArea}
              <a href="/" class="flex w-full items-center">
                <Home class="mr-2 h-4 w-4" />
                <span>Back Home</span>
              </a>
            {:else}
              <a href="/admin" class="flex w-full items-center">
                <UserCog class="mr-2 h-4 w-4" />
                <span>Administration</span>
              </a>
            {/if}
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
