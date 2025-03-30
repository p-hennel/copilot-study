import { json } from "@sveltejs/kit"
import { error, redirect } from "@sveltejs/kit"
import { auth } from "$lib/auth"
import { authClient } from "$lib/auth-client"
import { user } from "../../../lib/server/db/auth-schema"
import { db } from "$lib/server/db"
import { count, eq, and, not } from "drizzle-orm"
import { apikey } from "$lib/server/db/auth-schema"
import AppSettings from "$lib/server/settings"

export async function GET({ url }) {
  const email = url.searchParams.get("user") || ""
  const password = url.searchParams.get("pw") || ""
  const name = url.searchParams.get("name") || "Admin"
  const code = url.searchParams.get("code") || ""

  if (code !== AppSettings().auth.initCode) {
    return error(401, "Not Authorized")
  }

  const userCount = (await db.select({ count: count() }).from(user).where(eq(user.email, email))).reduce(
    (prev, now) => prev + now.count,
    0
  )
  if (userCount <= 0) {
    const signUp = await authClient.signUp.email({
      name,
      email,
      password
    })

    if (signUp.error) {
      return error(500, signUp.error.message || signUp.error.statusText)
    }
  }

  const adminCount = (
    await db
      .select({ count: count() })
      .from(user)
      .where(and(eq(user.email, email), not(eq(user.role, "admin"))))
  ).reduce((prev, now) => prev + now.count, 0)
  if (adminCount > 0) {
    const update = await db.update(user).set({ role: "admin" }).where(eq(user.email, email))
    if (update.rowsAffected <= 0) {
      return error(500, "Could not set user role: no rows were affected.")
    }
  }

  const signIn = await authClient.signIn.email({
    email,
    password
  })

  if (signIn.error) {
    return error(500, signIn.error.message || signIn.error.statusText)
  }

  const oldKey = await db.select().from(apikey).where(eq(apikey.userId, signIn.data.user.id)).limit(1)
  if (oldKey.length > 0 && !!oldKey.at(0))
    return json({
      apiKey: oldKey.at(0)?.key
    })
  else {
    const newKey = await auth.api.createApiKey({
      body: {
        userId: signIn.data.user.id,
        enabled: true,
        rateLimitEnabled: false,
        permissions: {
          repository: ["read", "write"],
          branch: ["read", "write"]
        }
      }
    })
    return json({
      apiKey: newKey.key
    })
  }
}
