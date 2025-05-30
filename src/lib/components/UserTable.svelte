<script lang="ts">
  import Time from "svelte-time";
  import { Button } from "$ui/button";
  import * as Table from "$lib/components/ui/table/index.js";
  import { m } from "$paraglide";
  import { dynamicHandleDownloadAsCSV } from "$lib/utils";
  import { type UserInformation } from "$lib/types";
  import { type AccountInformation } from "$lib/types";
  import { Separator } from "$ui/separator";
  import { ArchiveRestore, FileDown } from "lucide-svelte";
  import LoadingButton from "./LoadingButton.svelte";
  import { authClient } from "$lib/auth-client";
  import { goto } from "$app/navigation";
  import { ClipboardCopy, DatabaseBackup, Waypoints } from "@lucide/svelte";

  type UserInformationWithAccounts = UserInformation & { accounts: AccountInformation[] };
  type PreparedUserInformation = UserInformationWithAccounts & {
    firstAccount: AccountInformation | undefined;
  };
  type UserTableProps = {
    users: UserInformationWithAccounts[];
    format?: string;
  };

  let data: UserTableProps = $props();

  const format = $derived(data.format ?? "DD. MMM YY");

  const users: PreparedUserInformation[] = $derived.by(() => {
    return data.users.map((x: UserInformationWithAccounts) => {
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
    data.users.reduce((res, usr) => Math.max(res, usr.accounts.length), 0)
  );
  const lessThanMaxAccounts = $derived(() =>
    data.users.reduce((res, usr) => res + (usr.accounts.length < maxNumAccounts() ? 1 : 0), 0)
  );
</script>

<div class="flex flex-row flex-wrap items-center justify-between">
  <p class="prose justify-between">
    {m["admin.dashboard.summary.total"]({ user_count: data.users.length })}<br />
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
        const idsText = data.users.map(x => x.email).join("\n");
        navigator.clipboard.writeText(idsText);
      }}>
      <ClipboardCopy />
      Copy IDs
    </Button>
    <Button
      variant="default"
      onclick={dynamicHandleDownloadAsCSV(() =>
        data.users.map((x) => ({
          email: x.email,
          accounts: x.accounts.map((x) => x.providerId).join(",")
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
          >{users.length - idx}</Table.Cell
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
          <Table.Cell class="text-center"
            ><Time timestamp={user.firstAccount.createdAt} {format} /></Table.Cell
          >
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
            ><Time timestamp={account.createdAt} {format} /></Table.Cell
          >
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
