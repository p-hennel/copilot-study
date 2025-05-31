import { db } from "$lib/server/db";
import { account } from "$lib/server/db/auth-schema";
import { json } from "@sveltejs/kit";
import { count, isNotNull, isNull, max, min } from "drizzle-orm";
import { getLogger } from "@logtape/logtape";
const logger = getLogger(["routes","api","admin","tokenInfos"]);

export async function GET({ locals }) {
  if (!locals.session || !locals.user?.id || locals.user.role !== "admin") {
    return json({ error: "Unauthorized!" }, { status: 401 });
  }

  try {
    const result = await db.select({
      provider: account.providerId,
      earliest: min(account.refreshTokenExpiresAt),
      latest: max(account.refreshTokenExpiresAt),
      countTotal: count(),
      countNoExpiration: count(isNull(account.refreshTokenExpiresAt)) //  sql<number>`COUNT(${account.refreshTokenExpiresAt} IS NULL)`
    })
    .from(account)
    .where(isNotNull(account.refreshToken))
    .groupBy(account.providerId)
    .orderBy(account.providerId)

    return json({
      success: true,
      result
    });
  } catch(err: unknown) {
    logger.error("Exception", {err})
    return json({
      success: false,
      result: null
    })
  }
}
