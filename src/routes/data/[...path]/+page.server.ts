import { error } from "@sveltejs/kit"
import { db } from "$lib/server/db"
import { area, job } from "$lib/server/db/schema"
import { eq, and, count, sql } from "drizzle-orm" // Added sql import
import { canAccessAreaFiles, areAreaJobsFinished, fileToCollectionType } from "$lib/server/utils"
import { JobStatus } from "$lib/types"
import AppSettings from "$lib/server/settings" // Assuming settings has dataRoot path
import path from "node:path"
import fs from "node:fs/promises" // For reading directory
import { getLogger } from "@logtape/logtape";
const logger = getLogger(["routes","data","[...path]"]);

export async function load({ locals, params }: { locals: any, params: any }) {
  // 1. Authentication Check (already done implicitly by hooks, but double-check)
  if (!locals.session || !locals.user?.id) {
    throw error(401, "Unauthorized")
  }

  // 2. Extract Area Path
  const areaPath = params.path // The [...path] parameter

  // 3. Authorization Check
  const canAccess = await canAccessAreaFiles(areaPath, locals.user.id)
  if (!canAccess && locals.user.role !== "admin") {
    // Allow admin override? Or rely solely on canAccessAreaFiles?
    throw error(403, "Forbidden")
  }

  // 4. Fetch Area Details (including job counts for progress)
  const areaDetails = await db.query.area.findFirst({
    where: eq(area.full_path, areaPath),
    extras: {
      // Use extras for counts
      jobsTotal: sql<number>`(SELECT COUNT(*) FROM ${job} WHERE ${job.full_path} = ${area.full_path})`
        .mapWith(Number)
        .as("jobsTotal"),
      jobsFinished:
        sql<number>`(SELECT COUNT(*) FROM ${job} WHERE ${job.full_path} = ${area.full_path} AND ${job.status} = ${JobStatus.finished})`
          .mapWith(Number)
          .as("jobsFinished")
    }
  })

  if (!areaDetails) {
    throw error(404, "Area not found")
  }

  // 5. Check if Jobs are Finished (Optional - UI can show progress)
  // const jobsFinished = await areAreaJobsFinished(areaPath);
  // if (!jobsFinished) {
  //    // Maybe allow viewing even if not finished, UI shows progress?
  // }

  // 6. List Files in Storage Directory
  let filesInfo: Array<{ type: string; size: number; name: string }> = []
  try {
    const storageDir = path.resolve(path.join(AppSettings().paths.dataRoot, areaPath))
    const dirEntries = await fs.readdir(storageDir, { withFileTypes: true })

    for (const entry of dirEntries) {
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        // Assuming files are .jsonl
        const collectionType = fileToCollectionType(entry.name)
        if (collectionType) {
          const stats = await fs.stat(path.join(storageDir, entry.name))
          filesInfo.push({
            type: collectionType,
            size: stats.size,
            name: entry.name // Include filename for download link
          })
        }
      }
    }
  } catch (err: any) {
    if (err.code === "ENOENT") {
      logger.warn(`Storage directory not found for area ${areaPath}`)
      // Return empty files list, UI will show no files
    } else {
      logger.error(`Error reading storage directory for area ${areaPath}:`, err)
      throw error(500, "Could not list data files")
    }
  }

  // 7. Return Data
  return {
    area: areaDetails, // Contains name, path, counts
    files: filesInfo
  }
}
