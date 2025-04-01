import { redirect, type RequestHandler } from "@sveltejs/kit"
import { db } from "$lib/server/db"
import { account } from "$lib/server/db/auth-schema"
import { job, area } from "$lib/server/db/base-schema"
import { eq } from "drizzle-orm"
import fetchAllGroupsAndProjects from "$lib/server/mini-crawler/main"
import AppSettings from "$lib/server/settings"
import type { Group, Project } from "$lib/server/mini-crawler"
import { AreaType } from "$lib/utils"
import { getLogger } from "@logtape/logtape"
import { manageOAuthToken } from "$lib/server/mini-crawler/token-check"

// TODO: Encrypted Mail Tokens

export const GET: RequestHandler = async ({ locals, fetch }) => {
  if (!locals.session || !locals.user || !locals.user.id)
    return redirect(301, "/")
  const _job = (
    await db
      .select({
        id: job.id,
        status: job.status,
        progress: job.progress,
        token: account.accessToken,
        tokenExpiresAt: account.accessTokenExpiresAt,
        refresher: account.refreshToken,
        refreshTokenExpiresAt: account.refreshTokenExpiresAt
      })
      .from(job)
      .innerJoin(account, eq(account.id, job.accountId))
      .where(eq(account.userId, locals.user.id))
      .limit(1)
  ).at(0)
  if (typeof _job?.progress === "string") {
    _job.progress = JSON.parse(_job.progress) as any
  }

  if (_job && _job.token && _job.refresher) {
    console.log("acces: {access} | refresh: {refresh}", {
      access: _job.tokenExpiresAt,
      refresh: _job.refreshTokenExpiresAt
    })
    /*
    const oauth = await manageOAuthToken(_job.token, _job.refresher, {
      verifyUrl: `${AppSettings().auth.providers.gitlab.baseUrl}/oauth/verify`,
      refreshUrl: `${AppSettings().auth.providers.gitlab.baseUrl}/oauth/token`,
      clientId: AppSettings().auth.providers.gitlab.clientId,
      clientSecret: AppSettings().auth.providers.gitlab.clientSecret
    })
    */
    fetchAllGroupsAndProjects(
      locals.user.id,
      `${AppSettings().auth.providers.gitlab.baseUrl}/api/graphql`,
      _job?.token ?? "",
      async (items: Group[] | Project[], itemType: "groups" | "projects") => {
        if (!items || items.length <= 0) return
        console.log("inserting")
        const result = await db.insert(area).values(
          items?.map((x) => ({
            full_path: x.fullPath,
            gitlab_id: x.webUrl,
            name: x.name,
            type: itemType === "groups" ? AreaType.group : AreaType.project
          }))
        )
        const logger = getLogger(["recheck", "resultProcessing"])
        if (result.rowsAffected < items.length) {
          logger.warn("fewer {itemType} affected than received: {affected} < {received}", {
            itemType,
            affected: result.rowsAffected,
            received: items.length
          })
        } else {
          logger.info("Inserted {count} {itemType}", { affected: result.rowsAffected, received: items.length })
        }
      },
      40,
      fetch
    )
  }

  return redirect(301, "/")
}
