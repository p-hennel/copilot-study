<script lang="ts">
  import Time from "svelte-time";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { Button } from "$ui/button";
  import * as Table from "$lib/components/ui/table/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import { m } from "$paraglide";
  import { dynamicHandleDownloadAsCSV } from "$lib/utils";
  import { type UserInformation } from "$lib/types";
  import { type AccountInformation } from "$lib/types";
  import { Separator } from "$ui/separator";
  import { ArchiveRestore, FileDown, ChevronLeft, ChevronRight, ChevronFirst, ChevronLast, Loader2 } from "lucide-svelte";
  import LoadingButton from "./LoadingButton.svelte";
  import { authClient } from "$lib/auth-client";
  import { goto } from "$app/navigation";
  import { toast } from "svelte-sonner";
  import { ClipboardCopy, DatabaseBackup, Waypoints } from "@lucide/svelte";

  type UserInformationWithAccounts = UserInformation & { accounts: AccountInformation[] };
  type PreparedUserInformation = UserInformationWithAccounts & {
    firstAccount: AccountInformation | undefined;
  };

  type PaginatedUsersResponse = {
    data: UserInformationWithAccounts[];
    pagination: {
      page: number;
      limit: number;
      totalCount: number;
      totalPages: number;
      hasNextPage: boolean;
      hasPreviousPage: boolean;
    };
  };

  type UserTableProps = {
    users?: UserInformationWithAccounts[]; // For backward compatibility
    format?: string;
    onRefresh?: () => Promise<void>;
  };

  let props: UserTableProps = $props();
  const format = $derived(props.format ?? "DD. MMM YY");
  const formatTooltip = $derived(props.format ?? "DD. MMM YYYY, HH:mm:ss");

  // Pagination state
  let currentPage = $state(1);
  let itemsPerPage = $state(25);
  let itemsPerPageOptions = [10, 25, 50, 100];
  let loading = $state(false);
  let usersData = $state<PaginatedUsersResponse | null>(null);

  // Fetch users data from API
  const fetchUsers = async (page: number = currentPage, limit: number = itemsPerPage) => {
    try {
      loading = true;
      const token = (await authClient.getSession())?.data?.session.token;
      if (!token) {
        await goto("/admin/sign-in");
        throw new Error("No authentication token");
      }

      const response = await fetch(`/api/admin/users?page=${page}&limit=${limit}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch users: ${response.statusText}`);
      }

      const data = await response.json() as PaginatedUsersResponse;
      usersData = data;
    } catch (error) {
      console.error("Error fetching users:", error);
      toast.error("Failed to fetch users", {
        description: error instanceof Error ? error.message : "An unknown error occurred"
      });
      // Fallback to props.users if API fails
      if (props.users) {
        usersData = {
          data: props.users,
          pagination: {
            page: 1,
            limit: props.users.length,
            totalCount: props.users.length,
            totalPages: 1,
            hasNextPage: false,
            hasPreviousPage: false
          }
        };
      }
    } finally {
      loading = false;
    }
  };

  // Initial load and reactive updates
  $effect(() => {
    if (props.users) {
      // Use provided users data (backward compatibility)
      usersData = {
        data: props.users,
        pagination: {
          page: 1,
          limit: props.users.length,
          totalCount: props.users.length,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false
        }
      };
    } else {
      // Fetch from API
      fetchUsers(currentPage, itemsPerPage);
    }
  });

  // Handle page changes
  const handlePageChange = (newPage: number) => {
    currentPage = newPage;
  };

  // Handle items per page change
  const handleItemsPerPageChange = (val:string|undefined = undefined) => {
    if (val) {
      itemsPerPage = parseInt(val, 10);
    }
    currentPage = 1;
    if (!props.users) {
      fetchUsers(1, itemsPerPage);
    }
  };

  // Refresh function for external calls
  const refreshUsers = async () => {
    if (!props.users) {
      await fetchUsers(currentPage, itemsPerPage);
    }
    if (props.onRefresh) {
      await props.onRefresh();
    }
  };

  // Derived values for display
  const rawUsers = $derived(usersData?.data || []);
  const pagination = $derived(usersData?.pagination);
  const totalItems = $derived(pagination?.totalCount || 0);
  const totalPages = $derived(pagination?.totalPages || 0);
  const startIndex = $derived(pagination ? (pagination.page - 1) * pagination.limit : 0);
  const endIndex = $derived(pagination ? Math.min(startIndex + pagination.limit, pagination.totalCount) : 0);

  const users: PreparedUserInformation[] = $derived.by(() => {
    return rawUsers.map((x: UserInformationWithAccounts) => {
      if (x.accounts.length > 0)
        return {
          ...x,
          accounts: [...x.accounts].slice(1),
          firstAccount: x.accounts[0]
        } as PreparedUserInformation;
      else {
        return {
          ...x,
          firstAccount: undefined
        } as PreparedUserInformation;
      }
    });
  });

  const maxNumAccounts = $derived(() =>
    rawUsers.reduce((res, usr) => Math.max(res, usr.accounts.length), 0)
  );
  const lessThanMaxAccounts = $derived(() =>
    rawUsers.reduce((res, usr) => res + (usr.accounts.length < maxNumAccounts() ? 1 : 0), 0)
  );
</script>

<div class="flex flex-row flex-wrap items-center justify-between">
  <p class="prose justify-between">
    {m["admin.dashboard.summary.total"]({ user_count: totalItems })}<br />
    {m["admin.dashboard.summary.lessThanMaxAccounts"]({
      maxAccounts: maxNumAccounts(),
      user_count: lessThanMaxAccounts() <= 0 ? "None" : lessThanMaxAccounts()
    })}
  </p>
  <div class="flex flex-row gap-4">
    <LoadingButton
      variant="secondary"
      icon={ArchiveRestore}
      fn={async () => {
        const token = (await authClient.getSession())?.data?.session.token;
        if (!token) return goto("/admin/sign-in");
        await fetch("/api/admin/backup", {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
      }}
    >
      Backup (Mail)
    </LoadingButton>
    <Button
      target="_blank"
      href="/admin/backup">
      <DatabaseBackup />
      Backup
    </Button>
    <Button
      variant="secondary"
      onclick={async () => {
        const idsText = rawUsers.map((x: UserInformationWithAccounts) => x.email).join("\n");
        navigator.clipboard.writeText(idsText);
      }}>
      <ClipboardCopy />
      Copy IDs
    </Button>
    <Button
      variant="default"
      onclick={dynamicHandleDownloadAsCSV(() =>
        rawUsers.map((x: UserInformationWithAccounts) => ({
          email: x.email,
          accounts: x.accounts.map((acc: AccountInformation) => acc.providerId).join(",")
        }))
      )}
    >
      <FileDown />
      CSV Export
    </Button>
  </div>
</div>

<Separator class="my-4" />

<Table.Root>
  <Table.Header>
    <Table.Row>
      <Table.Head rowspan={2} class="w-[4rem] text-right"
        >{m["admin.dashboard.userTable.header.idx"]()}</Table.Head
      >
      <!--<Table.Head rowspan={2}>{m["admin.dashboard.userTable.header.name"]()}</Table.Head>-->
      <Table.Head rowspan={2}>{m["admin.dashboard.userTable.header.email"]()}</Table.Head>
      <Table.Head rowspan={2}>{m["admin.dashboard.userTable.header.created"]()}</Table.Head>
      <Table.Head colspan={4} class="text-center"
        >{m["admin.dashboard.userTable.header.accounts"]()}</Table.Head
      >
    </Table.Row>
    <Table.Row>
      <Table.Head>{m["admin.dashboard.userTable.header.provider"]()}</Table.Head>
      <Table.Head class="text-center">{m["admin.dashboard.userTable.header.created"]()}</Table.Head>
      <Table.Head class="text-center">{m["admin.dashboard.userTable.header.expires"]()}</Table.Head>
      <Table.Head></Table.Head>
    </Table.Row>
  </Table.Header>
  <Table.Body>
    {#each users as user, idx (idx)}
      <Table.Row>
        <Table.Cell rowspan={user.accounts.length + 1} class="text-right"
          >{startIndex + idx + 1}</Table.Cell
        >
        <!--<Table.Cell rowspan={user.accounts.length + 1}>{user.name}</Table.Cell>-->
        <Table.Cell rowspan={user.accounts.length + 1}>
          {#if user.email.includes("@")}
            <Button variant="ghost" href={`mailto:${user.email}`}>{user.email}</Button>
          {:else}
            {user.email}
          {/if}
        </Table.Cell>
        <Table.Cell rowspan={user.accounts.length + 1}
          ><Time timestamp={user.createdAt} {format} /></Table.Cell
        >
        {#if !user.firstAccount}
          <Table.Cell colspan={4} class="text-center"
            >{m["admin.dashboard.userTable.no_accounts"]()}</Table.Cell
          >
        {:else}
          <Table.Cell>{user.firstAccount.providerId}</Table.Cell>
          <Table.Cell class="text-center">
            <Tooltip.Provider delayDuration={0}>
              <Tooltip.Root>
                <Tooltip.Trigger>
                  <Time timestamp={user.firstAccount.createdAt} {format} />
                </Tooltip.Trigger>
                <Tooltip.Content>
                  <Time timestamp={user.firstAccount.createdAt} format={formatTooltip} />
                </Tooltip.Content>
              </Tooltip.Root>
            </Tooltip.Provider>
          </Table.Cell>
          <Table.Cell class="text-center">
            {#if !!user.firstAccount.refreshTokenExpiresAt}
              <Time timestamp={user.firstAccount.refreshTokenExpiresAt} {format} />
            {/if}
          </Table.Cell>
          <Table.Cell class="text-right">
            {#if !!user.firstAccount.id}
            <LoadingButton
              variant="secondary"
              icon={Waypoints}
              fn={async () => {
                if (!user.firstAccount) return;
                const token = (await authClient.getSession())?.data?.session.token;
                if (!token) return goto("/admin/sign-in");
                await fetch("/api/admin/recheck", {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${token}`
                  },
                  body: `{
                    "accountId": "${user.firstAccount.id}",
                    "userId": "${user.id}",
                    "provider": "${user.firstAccount.providerId}"
                  }`
                });
              }}
            >
              Re-Check
            </LoadingButton>
            {/if}
          </Table.Cell>
        {/if}
      </Table.Row>
      {#each user.accounts as account, idx2 (idx2)}
        <Table.Row>
          <Table.Cell>{account.providerId}</Table.Cell>
          <Table.Cell class="text-center"
            >
            <Tooltip.Provider delayDuration={0}>
              <Tooltip.Root>
                <Tooltip.Trigger>
                  <Time timestamp={account.createdAt} {format} />
                </Tooltip.Trigger>
                <Tooltip.Content>
                  <Time timestamp={account.createdAt} format={formatTooltip} />
                </Tooltip.Content>
              </Tooltip.Root>
            </Tooltip.Provider>
          </Table.Cell>
          <Table.Cell class="text-center">
            {#if !!account.refreshTokenExpiresAt}
              <Time timestamp={account.refreshTokenExpiresAt} {format} />
            {/if}
          </Table.Cell>
          <Table.Cell class="text-right">
            <LoadingButton
              variant="secondary"
              icon={Waypoints}
              fn={async () => {
                const token = (await authClient.getSession())?.data?.session.token;
                if (!token) return goto("/admin/sign-in");
                await fetch("/api/admin/recheck", {
                  headers: {
                    Authorization: `Bearer ${token}`
                  },
                  body: `{
                    "accountId": "${account.id}",
                    "userId": "${user.id}",
                    "provider": "${account.providerId}"
                  }`
                });
              }}
            >
              Re-Check
            </LoadingButton>
          </Table.Cell>
        </Table.Row>
      {/each}
    {/each}
  </Table.Body>
</Table.Root>

<!-- Pagination Controls -->
{#if totalPages > 1}
  <div class="mt-4 flex items-center justify-between">
    <div class="flex items-center gap-2 text-sm text-muted-foreground">
      <span>
        Showing {startIndex + 1} to {endIndex} of {totalItems} users
      </span>
    </div>
    
    <div class="flex items-center gap-6">
      <div class="flex items-center gap-2">
        <Select.Root
          type="single"
          onValueChange={(v) => {currentPage = 1; handleItemsPerPageChange(v)}}
          value={`${itemsPerPage}`}>
          <Select.Trigger>
            <span class="text-sm text-muted-foreground">
              Items per page: {itemsPerPage}
            </span>
          </Select.Trigger>
          <Select.Content>
            {#each itemsPerPageOptions as option}
              <Select.Item value={`${option}`} label={`${option}`} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

      <div class="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={currentPage === 1 || loading}
          onclick={() => handlePageChange(1)}
          class="w-8 h-8 p-0"
          aria-label="Go to first page"
        >
          {#if loading}
            <Loader2 class="h-4 w-4 animate-spin" />
          {:else}
            <ChevronFirst class="h-4 w-4" />
          {/if}
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={!pagination?.hasPreviousPage || loading}
          onclick={() => handlePageChange(Math.max(1, currentPage - 1))}
          class="w-8 h-8 p-0"
        >
          {#if loading}
            <Loader2 class="h-4 w-4 animate-spin" />
          {:else}
            <ChevronLeft class="h-4 w-4" />
          {/if}
        </Button>

        <div class="flex items-center gap-1">
          {#each Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            const start = Math.max(1, currentPage - 2);
            const end = Math.min(totalPages, start + 4);
            const adjustedStart = Math.max(1, end - 4);
            return adjustedStart + i;
          }) as pageNum}
            <Button
              variant={currentPage === pageNum ? "default" : "outline"}
              size="sm"
              onclick={() => handlePageChange(pageNum)}
              disabled={loading}
              class="w-8 h-8 p-0"
            >
              {pageNum}
            </Button>
          {/each}
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={!pagination?.hasNextPage || loading}
          onclick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
          class="w-8 h-8 p-0"
        >
          {#if loading}
            <Loader2 class="h-4 w-4 animate-spin" />
          {:else}
            <ChevronRight class="h-4 w-4" />
          {/if}
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={currentPage === totalPages || loading}
          onclick={() => handlePageChange(totalPages)}
          class="w-8 h-8 p-0"
          aria-label="Go to last page"
        >
          {#if loading}
            <Loader2 class="h-4 w-4 animate-spin" />
          {:else}
            <ChevronLast class="h-4 w-4" />
          {/if}
        </Button>
      </div>
    </div>
  </div>
{:else}
  <div class="mt-4 text-sm text-muted-foreground">
    Showing {totalItems} user{totalItems === 1 ? '' : 's'}
  </div>
{/if}
