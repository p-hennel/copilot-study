import { json } from "@sveltejs/kit";
import { account, user } from "$lib/server/db/auth-schema";
import { db } from "$lib/server/db";
import { eq, desc } from "drizzle-orm";
import type { UserInformation } from "$lib/types";
import type { AccountInformation } from "$lib/types";
import { computeHash } from "$lib/server/CryptoHash";


// List of hashes for which emails should not be re-hashed in the admin user list
const toBeCheckedHashes = [
  "e88281261912cf02aac6795f47bb90ccd83205d65234626e41ffeec091d6b5c3",
  "f8b8a10e549d2f979377bc2e45ad61c9dc3999cfbf968dbe75fe73d0f0467ee2",
  "02140ab95dc7f0b790cd10d93f3a80b04f9e784947248e70134c7a0c4bdf9af3"
]


/**
 * GET endpoint to list all users and their accounts for admin view.
 * Hashes emails for privacy except for certain whitelisted hashes.
 * Only accessible by admin users.
 * @param locals - SvelteKit locals (session, user)
 */
export async function GET({ locals }: { locals: any }) {
  if (!locals.session || !locals.user?.id || locals.user.role !== "admin") {
    return json({ error: "Unauthorized!" }, { status: 401 });
  }

  const shouldHash = toBeCheckedHashes.indexOf(computeHash(((locals.user?.email ?? "") as string).toLowerCase())) < 0;

  const users = (await getUsers()).map((x) => ({
    ...x,
    email: shouldHash ? computeHash(x.email) : x.email,
  }));

  return json(users);
}

const getUsers = async () => {
  const db_users = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      userCreatedAt: user.createdAt,
      accountId: account.id,
      accountProviderId: account.providerId,
      accountCreatedAt: account.createdAt,
      refreshTokenExpiresAt: account.refreshTokenExpiresAt
    })
    .from(user)
    .leftJoin(account, eq(account.userId, user.id))
    .orderBy(desc(user.createdAt), account.providerId, desc(account.createdAt));

  const users = Object.values(
    db_users.reduce(
      (col, user) => {
        if (!(user.id in col)) {
          col[user.id] = {
            id: user.id,
            name: user.name,
            email: user.email,
            createdAt: user.userCreatedAt,
            accounts: [] as AccountInformation[]
          } as UserInformation & { accounts: AccountInformation[] };
        }
        if (!!user.accountProviderId && !!user.accountCreatedAt) {
          col[user.id]?.accounts.push({
            id: user.accountId,
            providerId: user.accountProviderId,
            createdAt: user.accountCreatedAt,
            refreshTokenExpiresAt: user.refreshTokenExpiresAt
          });
        }
        return col;
      },
      {} as Record<string, UserInformation & { accounts: AccountInformation[] }>
    )
  );
  return users;
};
