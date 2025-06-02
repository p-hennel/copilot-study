import { json } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { area, area_authorization, job } from "$lib/server/db/base-schema"; // Import schemas
import { desc, sql } from "drizzle-orm"; // Removed unused eq, count
import { getLogger } from "@logtape/logtape";
const logger = getLogger(["routes","api","admin","areas"]);

export async function GET({ locals, url }: { url: URL, locals: any }) {
  if (!locals.session || !locals.user?.id || locals.user.role !== "admin") {
    // No need to log unauthorized attempts unless debugging specific issues
    return json({ error: "Unauthorized!" }, { status: 401 });
  }

  try {
    // Parse pagination parameters
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit') || '25')));
    const offset = (page - 1) * limit;

    // Get total count first
    const totalCountResult = await db
      .select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
      .from(area);
    const totalCount = totalCountResult[0]?.count || 0;

    // Fetch areas with pagination and count related accounts and jobs
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
        countJobs:
          sql<number>`(SELECT COUNT(*) FROM ${job} WHERE ${job.full_path} = ${area.full_path})`.mapWith(
            Number
          )
      })
      .from(area)
      .orderBy(desc(area.created_at))
      .limit(limit)
      .offset(offset);

    return json({
      data: areasWithCounts,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasNextPage: page < Math.ceil(totalCount / limit),
        hasPreviousPage: page > 1
      }
    });
  } catch (error) {
    logger.error("Error fetching areas with counts: {error}", { error });
    return json({ error: "Failed to fetch areas" }, { status: 500 });
  }
}

// Removed unused getUsers function and imports
