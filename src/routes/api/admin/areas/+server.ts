import { json } from "@sveltejs/kit"
import { db } from "$lib/server/db"
import { area, area_authorization, job } from "$lib/server/db/base-schema" // Import schemas
import { desc, sql } from "drizzle-orm" // Removed unused eq, count
import { getLogger } from "$lib/logging" // Import logtape helper

const logger = getLogger(["backend", "api", "admin", "areas"]) // Logger for this module

export async function GET({ request, locals }) {
  if (!locals.session || !locals.user?.id || locals.user.role !== "admin") {
    // No need to log unauthorized attempts unless debugging specific issues
    return json({ error: "Unauthorized!" }, { status: 401 })
  }

  try {
    // Fetch areas and count related accounts and jobs
    const areasWithCounts = await db
      .select({
        fullPath: area.full_path, // Rename column
        gitlabId: area.gitlab_id, // Include gitlab_id
        name: area.name,
        type: area.type,
        createdAt: area.created_at,
        // Subquery or count for accounts
        countAccounts:
          sql<number>`(SELECT COUNT(*) FROM ${area_authorization} WHERE ${area_authorization.area_id} = ${area.full_path})`.mapWith(
            Number
          ),
        // Subquery or count for jobs
        countJobs: sql<number>`(SELECT COUNT(*) FROM ${job} WHERE ${job.full_path} = ${area.full_path})`.mapWith(Number)
      })
      .from(area)
      .orderBy(desc(area.created_at))

    return json(areasWithCounts)
  } catch (error) {
    console.error("Error fetching areas with counts:", error)
  }
}

// Removed unused getUsers function and imports
