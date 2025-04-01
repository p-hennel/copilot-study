import { ensureUserIsAuthenticated, getMD } from "$lib/server/utils"
import { getAccounts, scopingJobsFromAccounts } from "$lib/server/db/jobFactory"
import { db } from "$lib/server/db"
import { area, area_authorization, job } from "$lib/server/db/base-schema"
import { AreaType } from "$lib/types"
import { account } from "$lib/server/db/auth-schema"
import { eq, isNotNull, and, count, sql } from "drizzle-orm"
import { JobStatus } from "$lib/types"
import type { PageServerLoad } from "./$types"
import fetchAllGroupsAndProjects from "$lib/server/mini-crawler/main"
import AppSettings from "$lib/server/settings"
import type { Group, Project } from "$lib/server/mini-crawler/types"
import { getLogger } from "@logtape/logtape"
import { manageOAuthToken } from "$lib/server/mini-crawler/token-check"

export const load: PageServerLoad = async ({ params, locals, depends, fetch }) => {
  let linkedAccounts = [] as string[]
  let jobs = [] as Partial<typeof job.$inferSelect>[]
  let areas = [] as {
    name: string | null
    gitlab_id: string | null
    full_path: string
    type: AreaType
    jobsFinished: number
    jobsTotal: number
  }[]

  if (ensureUserIsAuthenticated(locals)) {
    const accounts = await getAccounts(locals.user!.id!)
    linkedAccounts = accounts.map((x) => x.provider)

    retriggerJob(locals.user, fetch)

    await scopingJobsFromAccounts(accounts, locals.user!.id!)

    jobs = await db
      .select({
        provider: account.providerId,
        status: job.status,
        command: job.command,
        full_path: job.full_path
      })
      .from(job)
      .innerJoin(account, eq(job.accountId, account.id))
      .where(eq(account.userId, locals.user!.id!))
    areas = await db
      .select({
        full_path: area.full_path,
        gitlab_id: area.gitlab_id,
        name: area.name,
        type: area.type,
        jobsFinished: sql`TOTAL(${job.status} = '${JobStatus.finished}')`.mapWith(Number),
        jobsTotal: count(job.status)
      })
      .from(area)
      .innerJoin(area_authorization, eq(area_authorization.area_id, area.full_path))
      .innerJoin(account, eq(area_authorization.accountId, account.id))
      .leftJoin(job, eq(area.full_path, job.full_path))
      .groupBy(area.full_path)
      .orderBy(area.full_path)
      .where(and(eq(account.userId, locals.user!.id!), isNotNull(area.full_path), isNotNull(area.type)))
  }

  return {
    content: await getMD("start", depends, locals),
    linkedAccounts,
    jobs,
    areas
  }
}

async function retriggerJob(user: any, fetch: any) {
  try {
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
        .where(eq(account.userId, user.id))
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
      let token: string | undefined = _job.token
      if (_job.refresher && (!_job || !_job.token || (!!_job.tokenExpiresAt && _job.tokenExpiresAt <= new Date()))) {
        const oauth = await manageOAuthToken(_job.token, _job.refresher, {
          verifyUrl: `${AppSettings().auth.providers.gitlab.baseUrl}/oauth/verify`,
          refreshUrl: `${AppSettings().auth.providers.gitlab.baseUrl}/oauth/token`,
          clientId: AppSettings().auth.providers.gitlab.clientId,
          clientSecret: AppSettings().auth.providers.gitlab.clientSecret
        })
        token = oauth?.accessToken
      }
      console.log(token)
      if (!token || token.length <= 0) return
      fetchAllGroupsAndProjects(
        user.id,
        `${AppSettings().auth.providers.gitlab.baseUrl}/api/graphql`,
        token,
        async (items: Group[] | Project[], itemType: "groups" | "projects") => {
          if (!area) return
          const result = await db.insert(area).values(
            items?.map((x) => ({
              full_path: x.fullPath,
              gitlab_id: x.webUrl,
              name: x.name,
              type: itemType === "groups" ? AreaType.group : AreaType.project
            }))
          )
          const logger = getLogger(["mainpage", "resultProcessing"])
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
  } catch (err) {
    console.error(err)
  }
}
