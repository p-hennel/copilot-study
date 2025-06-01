import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { eq, desc, and, inArray, gte, sql } from "drizzle-orm";
import { job } from "$lib/server/db/base-schema";
import { JobStatus, TokenProvider } from "$lib/types";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["api", "admin", "jobs"]);

export async function GET({ locals, url }: RequestEvent) {
  if (!locals.session || !locals.user?.id || locals.user.role !== "admin") {
    return json({ error: "Unauthorized!" }, { status: 401 });
  }

  try {
    // Parse pagination parameters
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit') || '25')));
    
    const result = await getJobs(page, limit);
    return json(result);
  } catch (error) {
    logger.error("Error fetching jobs:", { error });
    return json({ error: "Failed to fetch jobs" }, { status: 500 });
  }
}

export async function DELETE({ locals, request, url }: RequestEvent) {
  if (!locals.session || !locals.user?.id || locals.user.role !== "admin") {
    return json({ error: "Unauthorized!" }, { status: 401 });
  }

  try {
    // Check for job ID in URL parameter
    const jobId = url.searchParams.get('id');
    
    if (jobId) {
      // Delete single job by ID from URL parameter
      const deletedJob = await db.delete(job).where(eq(job.id, jobId)).returning();
      
      if (deletedJob.length === 0) {
        return json({ error: "Job not found" }, { status: 404 });
      }

      // Log progress information for audit purposes
      if (deletedJob[0]?.progress) {
        const progress = typeof deletedJob[0].progress === 'string'
          ? JSON.parse(deletedJob[0].progress)
          : deletedJob[0].progress;
        logger.info(`Deleted job ${deletedJob[0].id} had progress:`, {
          processedItems: (progress as any)?.processedItems || (progress as any)?.processed,
          totalItems: (progress as any)?.totalItems || (progress as any)?.total,
          currentDataType: (progress as any)?.currentDataType,
          stage: (progress as any)?.stage,
          operationType: (progress as any)?.operationType,
          itemsByType: (progress as any)?.itemsByType
        });
      }

      logger.info(`Admin deleted job`, { admin: locals.user.email, jobId });
      return json({
        success: true,
        message: `Job ${jobId} deleted successfully`,
        deletedJob: deletedJob[0]
      });
    } else {
      // Check request body for job ID
      const body = await request.json() as { id?: string };
      
      if (!body.id) {
        return json({ error: "Job ID is required" }, { status: 400 });
      }

      const deletedJob = await db.delete(job).where(eq(job.id, body.id)).returning();
      
      if (deletedJob.length === 0) {
        return json({ error: "Job not found" }, { status: 404 });
      }

      logger.info(`Admin deleted job`, { admin: locals.user.email, jobId: body.id });
      return json({
        success: true,
        message: `Job ${body.id} deleted successfully`,
        deletedJob: deletedJob[0]
      });
    }
  } catch (error) {
    logger.error("Error deleting job:", { error });
    return json({ error: "Failed to delete job" }, { status: 500 });
  }
}

export async function POST({ locals, request }: RequestEvent) {
  if (!locals.session || !locals.user?.id || locals.user.role !== "admin") {
    return json({ error: "Unauthorized!" }, { status: 401 });
  }

  try {
    const body = await request.json() as {
      action?: string;
      jobIds?: string[];
      filters?: {
        status?: JobStatus;
        provider?: TokenProvider;
        dateFrom?: string;
        dateTo?: string;
      };
    };
    
    const { action, jobIds, filters } = body;

    if (action === "bulk_delete") {
      if (!jobIds || !Array.isArray(jobIds) || jobIds.length === 0) {
        return json({ error: "Job IDs array is required for bulk deletion" }, { status: 400 });
      }

      // Use transaction for bulk deletion
      const result = await db.transaction(async (tx) => {
        const deletedJobs = await tx.delete(job).where(inArray(job.id, jobIds as string[])).returning();
        
        // Log progress information for audit purposes
        deletedJobs.forEach(deletedJob => {
          if (deletedJob.progress) {
            const progress = typeof deletedJob.progress === 'string'
              ? JSON.parse(deletedJob.progress)
              : deletedJob.progress;
            logger.info(`Bulk deleted job ${deletedJob.id} had progress:`, {
              processedItems: (progress as any)?.processedItems || (progress as any)?.processed,
              totalItems: (progress as any)?.totalItems || (progress as any)?.total,
              currentDataType: (progress as any)?.currentDataType,
              stage: (progress as any)?.stage,
              operationType: (progress as any)?.operationType,
              itemsByType: (progress as any)?.itemsByType
            });
          }
        });
        
        return deletedJobs;
      });

      logger.info(`Admin performed bulk deletion of jobs`, { admin: locals.user.email, count: result.length });
      return json({
        success: true,
        message: `${result.length} jobs deleted successfully`,
        deletedCount: result.length,
        deletedJobs: result
      });
    } else if (action === "bulk_delete_filtered") {
      // Build filter conditions
      const conditions: ReturnType<typeof eq>[] = [];
      
      if (filters?.status && Object.values(JobStatus).includes(filters.status)) {
        conditions.push(eq(job.status, filters.status));
      }
      
      if (filters?.provider && Object.values(TokenProvider).includes(filters.provider)) {
        conditions.push(eq(job.provider, filters.provider));
      }
      
      if (filters?.dateFrom) {
        const fromDate = new Date(filters.dateFrom);
        if (!isNaN(fromDate.getTime())) {
          conditions.push(gte(job.created_at, fromDate));
        }
      }

      if (conditions.length === 0) {
        return json({ error: "At least one filter condition is required for filtered bulk deletion" }, { status: 400 });
      }

      // Use transaction for filtered bulk deletion
      const result = await db.transaction(async (tx) => {
        const deletedJobs = await tx.delete(job).where(and(...conditions)).returning();
        return deletedJobs;
      });

      logger.info(`Admin performed filtered bulk deletion of jobs`, { admin: locals.user.email, count: result.length, filters });
      return json({
        success: true,
        message: `${result.length} jobs deleted successfully with applied filters`,
        deletedCount: result.length,
        deletedJobs: result,
        appliedFilters: filters
      });
    } else {
      return json({ error: "Invalid action. Supported actions: bulk_delete, bulk_delete_filtered" }, { status: 400 });
    }
  } catch (error) {
    logger.error("Error in bulk job operations:", { error });
    return json({ error: "Failed to perform bulk job operation" }, { status: 500 });
  }
}

const getJobs = async (page: number = 1, limit: number = 25) => {
  const offset = (page - 1) * limit;

  // Get total count first
  const totalCountResult = await db
    .select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
    .from(job);
  const totalCount = totalCountResult[0]?.count || 0;

  const jobs = (
    await db.query.job.findMany({
      // Explicitly select all columns or list required ones including resumeState
      // For now, let's assume findMany without 'columns' gets all, including resumeState.
      // If resumeState is missing later, add: columns: { resumeState: true, /* other needed columns */ },
      with: {
        usingAccount: {
          columns: {
            providerId: true
          }
        },
        forArea: true,
        fromJob: {
          columns: {
            id: true,
            command: true,
            status: true,
            started_at: true,
            finished_at: true,
            created_at: true,
            updated_at: true,
          }
        }
      },
      extras: {
        childrenCount: db.$count(job, eq(job.spawned_from, job.id)).as("childrenCount")
      },
      orderBy: [desc(job.id)],
      limit,
      offset
    })
  ).map((x) => {
    const { usingAccount, ...rest } = x;
    return {
      ...rest,
      provider: usingAccount?.providerId ?? undefined
    };
  });

  return {
    data: jobs,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      hasNextPage: page < Math.ceil(totalCount / limit),
      hasPreviousPage: page > 1
    }
  };
};
