import { error } from "@sveltejs/kit"
import { db } from "$lib/server/db"
import { area, job } from "$lib/server/db/schema"
import { eq, sql } from "drizzle-orm" // Only import what is used
import { canAccessAreaFiles, fileToCollectionType } from "$lib/server/utils"
import { JobStatus } from "$lib/types"
import AppSettings from "$lib/server/settings" // Assuming settings has dataRoot path
import path from "node:path"
import fs from "node:fs/promises" // For reading directory
import { getLogger } from "@logtape/logtape";

// Logger for data area file listing and access
const logger = getLogger(["routes","data","[...path]"]);


/**
 * Loads area details and lists available data files for a given area path.
 * - Checks authentication and authorization.
 * - Fetches area metadata and job progress.
 * - Lists .jsonl files in the area storage directory.
 * @param locals - SvelteKit locals (session, user)
 * @param params - Route parameters (area path)
 * @returns Area details and file info for UI rendering
 */
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
    throw error(403, "Forbidden")
  }

  // 4. Fetch Area Details (including job counts for progress)
  const areaDetails = await db.query.area.findFirst({
    where: eq(area.full_path, areaPath),
    extras: {
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

  // 5. List Files in Storage Directory
  const filesInfo: Array<{ type: string; size: number; name: string }> = []
  try {
    const storageDir = path.resolve(path.join(AppSettings().paths.dataRoot, areaPath))
    const dirEntries = await fs.readdir(storageDir, { withFileTypes: true })

    for (const entry of dirEntries) {
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        // Only .jsonl files are considered data collections
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

  // 6. Return Data for UI
  return {
    area: areaDetails, // Contains name, path, counts
    files: filesInfo
  }
}
