import { db } from "$lib/server/db"
import { job, type Job, type UpdateJobType } from "$lib/server/db/base-schema"
import { CrawlCommand } from "$lib/utils"
import { getAvailableJobs, spawnNewJobs } from "$lib/server/db/jobFactory"
import { isAdmin, unauthorizedResponse, type AuthorizationScopesResult } from "$lib/server/utils" // Import AuthorizationScopesResult
import { JobStatus, TokenProvider } from "$lib/utils"
import { json } from "@sveltejs/kit"
import { eq } from "drizzle-orm/sql"
import { getLogger } from "$lib/logging" // Import logtape helper

// Define expected request body structure
interface JobUpdateRequest {
  id: string
  status: JobStatus
  provider?: TokenProvider
  data?: AuthorizationScopesResult
}

const logger = getLogger(["backend", "api", "jobs"]) // Logger for this module

export async function GET({ url, locals }) {
  if (!isAdmin(locals)) return unauthorizedResponse()

  const status: JobStatus = (url.searchParams.get("status") as JobStatus) ?? JobStatus.queued
  const cursor: string | null = url.searchParams.get("cursor")
  const perPage = parseInt(url.searchParams.get("perPage") ?? "10")

  const result = await getAvailableJobs(status, cursor, perPage)
  // This console.error seems like debug code, replacing with logger.debug
  logger.debug("Available jobs result", { result })
  return json(result)
}

export async function POST({ request, locals }) {
  if (!isAdmin(locals)) return unauthorizedResponse()

  const data = (await request.json()) as JobUpdateRequest // Assert type

  if (data.id) {
    if (data.status && data.status in JobStatus) {
      const currentJob: Job | undefined = await db.query.job.findFirst({
        where: (table, { eq }) => eq(table.id, data.id)
      })

      if (!!currentJob && !!currentJob.id && currentJob.status !== data.status) {
        if (currentJob.status === JobStatus.finished) {
          return json({ error: "Job already finished!" }, { status: 400 })
        }
        if (currentJob.status !== JobStatus.running && data.status in [JobStatus.failed || JobStatus.finished]) {
          // Fix typo: stauts -> status
          return json({ error: "Job is not running!" }, { status: 400 })
        }
        if (
          data.status === JobStatus.running &&
          ![JobStatus.failed, JobStatus.queued].includes(currentJob.status as JobStatus)
        ) {
          return json({ error: "Job is not ready to be run!" }, { status: 400 })
        }

        const updates: UpdateJobType = {
          status: data.status
        }

        if (data.status === JobStatus.finished) {
          updates.finishedAt = new Date()
          // Only spawn new jobs if the command was authorizationScope AND data.data is present
          if (currentJob.command === CrawlCommand.authorizationScope && data.data) {
            spawnNewJobs(data.provider ?? TokenProvider.gitlab, data.data, currentJob)
          }
        } else if (data.status === JobStatus.running) updates.startedAt = new Date()

        const result = await db.update(job).set(updates).where(eq(job.id, data.id))
        if (result.rowsAffected < 1) return json({ error: "Could not update Database!" }, { status: 500 })
        else return json({ success: true })
      } else if (!job) return json({ error: "job not found!" }, { status: 404 })
      else return json({ error: "status did not change!" }, { status: 400 })
    } else return json({ error: "unknown status" }, { status: 400 })
  } else return json({ error: "missing id" }, { status: 400 })
}
