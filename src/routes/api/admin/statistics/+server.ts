import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { area, job } from "$lib/server/db/base-schema";
import { sql, eq } from "drizzle-orm";
import { AreaType, JobStatus, CrawlCommand } from "$lib/types";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["api", "admin", "statistics"]);

export async function GET({ locals }: RequestEvent) {
  if (!locals.session || !locals.user?.id || locals.user.role !== "admin") {
    return json({ error: "Unauthorized!" }, { status: 401 });
  }

  try {
    // Get areas statistics
    const [totalAreas, groupAreas, projectAreas] = await Promise.all([
      db.select({ count: sql<number>`COUNT(*)`.mapWith(Number) }).from(area),
      db.select({ count: sql<number>`COUNT(*)`.mapWith(Number) }).from(area).where(eq(area.type, AreaType.group)),
      db.select({ count: sql<number>`COUNT(*)`.mapWith(Number) }).from(area).where(eq(area.type, AreaType.project))
    ]);

    // Get jobs statistics
    const [
      totalJobs,
      completedJobs, 
      runningJobs,
      pausedJobs,
      queuedJobs,
      failedJobs,
      discoveryJobs
    ] = await Promise.all([
      db.select({ count: sql<number>`COUNT(*)`.mapWith(Number) }).from(job),
      db.select({ count: sql<number>`COUNT(*)`.mapWith(Number) }).from(job).where(eq(job.status, JobStatus.finished)),
      db.select({ count: sql<number>`COUNT(*)`.mapWith(Number) }).from(job).where(eq(job.status, JobStatus.running)),
      db.select({ count: sql<number>`COUNT(*)`.mapWith(Number) }).from(job).where(eq(job.status, JobStatus.paused)),
      db.select({ count: sql<number>`COUNT(*)`.mapWith(Number) }).from(job).where(eq(job.status, JobStatus.queued)),
      db.select({ count: sql<number>`COUNT(*)`.mapWith(Number) }).from(job).where(eq(job.status, JobStatus.failed)),
      db.select({ count: sql<number>`COUNT(*)`.mapWith(Number) }).from(job).where(eq(job.command, CrawlCommand.GROUP_PROJECT_DISCOVERY))
    ]);

    const statistics = {
      areas: {
        total: totalAreas[0]?.count || 0,
        groups: groupAreas[0]?.count || 0,
        projects: projectAreas[0]?.count || 0
      },
      jobs: {
        total: totalJobs[0]?.count || 0,
        completed: completedJobs[0]?.count || 0,
        active: (runningJobs[0]?.count || 0) + (pausedJobs[0]?.count || 0),
        running: runningJobs[0]?.count || 0,
        paused: pausedJobs[0]?.count || 0,
        queued: queuedJobs[0]?.count || 0,
        failed: failedJobs[0]?.count || 0,
        groupProjectDiscovery: discoveryJobs[0]?.count || 0
      }
    };

    return json(statistics);
  } catch (error) {
    logger.error("Error fetching admin statistics:", { error });
    return json({ error: "Failed to fetch statistics" }, { status: 500 });
  }
}