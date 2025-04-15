import { auth } from "$lib/auth";
import { db } from "$lib/server/db";
import { apikey } from "$lib/server/db/auth-schema";
import AppSettings from "$lib/server/settings";
import { error, json, text } from "@sveltejs/kit";
import { count, eq } from "drizzle-orm";
import { user } from "../../../lib/server/db/auth-schema";

export async function GET({ url }) {
  try {
    const email = url.searchParams.get("user") || "";
    const password = url.searchParams.get("pw") || "";
    const name = url.searchParams.get("name") || "Admin";
    const code = url.searchParams.get("code") || "";

    if (code !== AppSettings().auth.initCode) {
      return error(401, "Not Authorized");
    }
    const userCount = (
      await db.select({ count: count() }).from(user).where(eq(user.email, email))
    ).reduce((prev, now) => prev + now.count, 0);

    const ctx = await auth.$context;

    //const hash = await ctx.password.hash(password)

    let userId: string | undefined = undefined;
    if (userCount <= 0) {
      const usr = await ctx.internalAdapter.createUser({
        name: name,
        email: email,
        role: "admin"
      });

      if (!user) {
        console.log("sign up failed", usr);
        return text("signup failed");
      }
      userId = usr.id;
      const pwd = await ctx.password.hash(password);
      console.log("passwd", pwd);

      const accnt = ctx.internalAdapter.createAccount({
        providerId: "credential",
        accountId: email,
        userId: usr.id,
        password: pwd,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      if (!accnt) {
        console.log("sign up (accounts) failed", accnt);
        return text("signup (accounts) failed");
      }

      await ctx.internalAdapter.updatePassword(usr.id, pwd);
    } else {
      const usrRole = ((
        await db
          .select({ role: user.role, id: user.id })
          .from(user)
          .where(eq(user.email, email))
          .limit(1)
      ).at(0) ?? {}) as { role: string | null; id: undefined };
      console.log("role: ", usrRole);

      if (usrRole.role !== "admin") {
        await db.update(user).set({ role: "admin" }).where(eq(user.id, user.id));
        console.log("updated role");
        //await ctx.internalAdapter.updateUserByEmail(email, { role: "admin" })
      }

      userId = usrRole.id;
    }

    if (!userId) return text("no user id found");

    const oldKey = await db.select().from(apikey).where(eq(apikey.userId, userId)).limit(1);
    if (oldKey.length > 0 && !!oldKey.at(0))
      return json({
        apiKey: oldKey.at(0)?.key
      });
    else {
      const newKey = await auth.api.createApiKey({
        body: {
          userId: userId,
          enabled: true,
          rateLimitEnabled: false,
          permissions: {
            repository: ["read", "write"],
            branch: ["read", "write"]
          }
        }
      });
      return json({
        apiKey: newKey.key
      });
    }
  } catch (e: any) {
    console.error(e);
    return text(`error: ${e}`);
  }
}
