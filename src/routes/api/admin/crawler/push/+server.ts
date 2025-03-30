import { json } from "@sveltejs/kit"
import { startJob } from "../../../../../hooks.server"
import { db } from "$lib/server/db"
import { CrawlCommand, JobStatus, normalizeURL } from "$lib/utils"
import AppSettings from "$lib/server/settings"
import { job } from "$lib/server/db/base-schema"
import { account } from "$lib/server/db/auth-schema"
import { asc, eq, inArray } from "drizzle-orm"

export async function POST({ locals }: { locals: App.Locals }) {
  if (!locals.session || !locals.user?.id || locals.user.role !== "admin") {
    return json({ error: "Unauthorized!" }, { status: 401 })
  }
  /*
  const job = await db.query.job.findFirst({
    where: (job, { eq, or }) => or(eq(job.status, JobStatus.queued), eq(job.status, JobStatus.failed)),
    with: {
      usingAccount: {
        with: {
          token: true
        }
      }
    },
    orderBy: (job, { asc }) => asc(job.created_at)
  })
  */
  const jobToWorkOn = (
    await db
      .select({
        full_path: job.full_path,
        token: account.accessToken,
        command: job.command,
        id: job.id
      })
      .from(job)
      .innerJoin(account, eq(job.accountId, account.id))
      .where(inArray(job.status, [JobStatus.queued, JobStatus.failed]))
      .orderBy(asc(job.created_at))
  ).at(0)

  if (!jobToWorkOn) {
    return json({ error: "No job found!" }, { status: 404 })
  }

  let apiUrl = normalizeURL(AppSettings().auth.providers.gitlab.baseUrl)
  if (jobToWorkOn.command === CrawlCommand.commits) {
    apiUrl += "/api/v4"
  } else {
    apiUrl += "/api/graphql"
  }

  await startJob({
    targetPath: jobToWorkOn.full_path ?? "",
    gitlabApiUrl: apiUrl,
    gitlabToken: jobToWorkOn.token ?? "",
    dataTypes: commandToDataTypes(jobToWorkOn.command),
    jobId: jobToWorkOn.id
  })

  return json({ success: true })
}

const commandToDataTypes = (command: CrawlCommand): string[] => {
  switch (command) {
    case CrawlCommand.commits:
      return ["commits"]
    case CrawlCommand.workItems:
    case CrawlCommand.issues:
      return ["issues"]
    case CrawlCommand.mergeRequests:
      return ["mergeRequests"]
    case CrawlCommand.pipelines:
      return ["pipelines"]
    case CrawlCommand.group:
      return ["pulls", "milestones", "groupSubgroups", "groupProjects"]
    case CrawlCommand.groupProjects:
      return ["groupProjects", "branches"]
    case CrawlCommand.groupSubgroups:
      return ["snippets"]
    case CrawlCommand.timelogs:
      return ["timelogs"]
    case CrawlCommand.users:
      return [""]
    case CrawlCommand.project:
      return [
        "branches",
        "testSuites",
        "securityReportFindings",
        "codeQualityReports",
        "pipelines",
        "releases",
        "milestones"
      ]
    case CrawlCommand.vulnerabilities:
      return ["vulnerabilities"]
    case CrawlCommand.authorizationScope:
      return ["memberships", "labels"]
    default:
      return [] as string[]
  }
}
