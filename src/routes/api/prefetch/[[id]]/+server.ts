import { db } from "$lib/server/db"
import { account } from "$lib/server/db/auth-schema"
import { job } from "$lib/server/db/base-schema"
import { isAdmin, unauthorizedResponse } from "$lib/server/utils"
import { json, type RequestHandler } from "@sveltejs/kit"
import { eq } from "drizzle-orm"

export const GET: RequestHandler = async ({ locals, params }) => {
  if (!isAdmin(locals)) return unauthorizedResponse()

  let _job
  if (params.id) {
    _job = await db.query.job.findFirst({
      where: (table, { eq }) => eq(table.id, params.id ?? "")
    })
  } else {
    _job = (
      await db
        .select({
          id: job.id,
          status: job.status,
          progress: job.progress
        })
        .from(job)
        .innerJoin(account, eq(account.id, job.accountId))
        .where(eq(account.userId, locals.user.id))
        .limit(1)
    ).at(0)
    if (typeof _job?.progress === "string") {
      _job.progress = JSON.parse(_job.progress) as any
    }
  }

  if (!_job) {
    return json({ success: false, message: `no job found with id ${params.id}` })
  }

  return json({ status: _job.status, progress: _job.progress })
}
