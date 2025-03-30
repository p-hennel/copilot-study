import { json } from "@sveltejs/kit"
import { account, user } from "$lib/server/db/auth-schema"
import { db } from "$lib/server/db"
import { eq, desc } from "drizzle-orm"
import type { AccountInformation, UserInformation } from "$lib/utils"
import { computeHash } from "$lib/server/CryptoHash"

export async function GET({ locals }) {
  if (!locals.session || !locals.user?.id || locals.user.role !== "admin") {
    return json({ error: "Unauthorized!" }, { status: 401 })
  }

  const users = (await getUsers()).map((x) => ({
    ...x,
    email: computeHash(x.email)
  }))

  return json(users)
}

const getUsers = async () => {
  const db_users = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      userCreatedAt: user.createdAt,
      accountProviderId: account.providerId,
      accountCreatedAt: account.createdAt,
      refreshTokenExpiresAt: account.refreshTokenExpiresAt
    })
    .from(user)
    .leftJoin(account, eq(account.userId, user.id))
    .orderBy(desc(user.createdAt))

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
          } as UserInformation & { accounts: AccountInformation[] }
        }
        if (!!user.accountProviderId && !!user.accountCreatedAt) {
          col[user.id]?.accounts.push({
            providerId: user.accountProviderId,
            createdAt: user.accountCreatedAt,
            refreshTokenExpiresAt: user.refreshTokenExpiresAt
          })
        }
        return col
      },
      {} as Record<string, UserInformation & { accounts: AccountInformation[] }>
    )
  )
  return users
}
