import { text } from "@sveltejs/kit"
import path from "node:path"
import { env } from "$env/dynamic/private"
import { db } from "$lib/server/db"
import { account, area, area_authorization, job } from "$lib/server/db/schema"
import { count, eq, and } from "drizzle-orm"
import { JobStatus } from "$lib/types"
import { areAreaJobsFinished, canAccessAreaFiles, fileForAreaPart } from "$lib/server/utils"
import type { RequestEvent } from '@sveltejs/kit';

export async function GET({ locals, params }: { locals: any, params: any }) {
  if (!locals.session || !locals.user?.id || locals.user.role !== "admin") {
    return text("Unauthorized!", { status: 401 })
  }

  const parts = params.path.split("/")
  // Check length first, then access parts[0]
  if (parts.length === 0) {
    return text("Not found!", { status: 404 })
  }
  // Now we know parts.length > 0, so parts[0] is safe to access
  if (parts[0]!.length === 0) {
    // Add non-null assertion
    return text("Not found!", { status: 404 })
  }

  const areaPath = parts.slice(0, parts.length - 1).join("/")

  if (!(await canAccessAreaFiles(areaPath, locals.user.id))) {
    return text("Unauthorized!", { status: 401 })
  }

  if (!(await areAreaJobsFinished(areaPath))) {
    return text("Not complete!", { status: 404 })
  }

  // parts.length is guaranteed > 0 here, so parts[parts.length - 1] exists
  const file = await fileForAreaPart(areaPath, parts[parts.length - 1]!)
  if (!file) {
    return text("Not found!", { status: 404 })
  }

  return new Response(file.stream(), {
    status: 200
  })
}
