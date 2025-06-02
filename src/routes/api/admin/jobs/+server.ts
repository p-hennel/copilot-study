import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { eq, desc, asc, and, or, inArray, gte, lte, like, isNull, isNotNull, sql } from "drizzle-orm";
import { job } from "$lib/server/db/base-schema";
import { JobStatus, TokenProvider, CrawlCommand } from "$lib/types";
import { getLogger } from "@logtape/logtape";
import { z } from "zod";

const logger = getLogger(["api", "admin", "jobs"]);

// Enhanced query parameters schema
const jobsQuerySchema = z.object({
  // Pagination
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(25),
  
  // Sorting
  sortBy: z.enum(['created', 'updated', 'started', 'finished', 'id', 'parent', 'status', 'command']).default('created'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  
  // Filtering
  command: z.union([
    z.nativeEnum(CrawlCommand),
    z.array(z.nativeEnum(CrawlCommand))
  ]).optional(),
  status: z.union([
    z.nativeEnum(JobStatus),
    z.array(z.nativeEnum(JobStatus))
  ]).optional(),
  hasStarted: z.string().optional().transform(val => val === undefined ? undefined : val === 'true'),
  hasFinished: z.string().optional().transform(val => val === undefined ? undefined : val === 'true'),
  hasParent: z.string().optional().transform(val => val === undefined ? undefined : val === 'true'),
  
  // Searching
  search: z.string().optional(),
  dateSearch: z.string().optional(),
  dateField: z.enum(['created', 'updated', 'started', 'finished']).default('created'),
});

type JobsQueryParams = z.infer<typeof jobsQuerySchema>;

export async function GET({ locals, url }: RequestEvent) {
  if (!locals.session || !locals.user?.id || locals.user.role !== "admin") {
    return json({ error: "Unauthorized!" }, { status: 401 });
  }

  try {
    // Parse and validate query parameters
    const rawParams = Object.fromEntries(url.searchParams.entries());
    
    // Handle array parameters (command, status)
    const processedParams: any = { ...rawParams };
    if (rawParams.command && typeof rawParams.command === 'string') {
      processedParams.command = rawParams.command.includes(',')
        ? rawParams.command.split(',').map(c => c.trim())
        : rawParams.command;
    }
    if (rawParams.status && typeof rawParams.status === 'string') {
      processedParams.status = rawParams.status.includes(',')
        ? rawParams.status.split(',').map(s => s.trim())
        : rawParams.status;
    }
    
    const params = jobsQuerySchema.parse(processedParams);
    const result = await getJobsWithQuery(params);
    return json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn("Invalid query parameters:", { errors: error.errors });
      return json({
        error: "Invalid query parameters",
        details: error.errors
      }, { status: 400 });
    }
    
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

// Date search parser for fuzzy datetime matching
interface DateRange {
  start: Date;
  end: Date;
  precision: 'year' | 'month' | 'day' | 'hour' | 'minute';
}

function parseDateInput(input: string): DateRange | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  
  // Try different date patterns
  const patterns = [
    { regex: /^(\d{4})$/, precision: 'year' as const },                           // 2024
    { regex: /^(\d{4})-(\d{1,2})$/, precision: 'month' as const },              // 2024-01
    { regex: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, precision: 'day' as const },      // 2024-01-15
    { regex: /^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2})$/, precision: 'hour' as const },           // 2024-01-15 14
    { regex: /^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{1,2})$/, precision: 'minute' as const }, // 2024-01-15 14:30
  ];
  
  for (const { regex, precision } of patterns) {
    const match = trimmed.match(regex);
    if (match) {
      return createDateRange(match, precision);
    }
  }
  
  return null;
}

function createDateRange(match: RegExpMatchArray, precision: DateRange['precision']): DateRange {
  const [, year, month, day, hour, minute] = match;
  
  const start = new Date(
    parseInt(year || '1970'),
    month ? parseInt(month) - 1 : 0,
    day ? parseInt(day) : 1,
    hour ? parseInt(hour) : 0,
    minute ? parseInt(minute) : 0,
    0
  );
  
  const end = new Date(start);
  
  // Set end date based on precision
  switch (precision) {
    case 'year':
      end.setFullYear(end.getFullYear() + 1);
      break;
    case 'month':
      end.setMonth(end.getMonth() + 1);
      break;
    case 'day':
      end.setDate(end.getDate() + 1);
      break;
    case 'hour':
      end.setHours(end.getHours() + 1);
      break;
    case 'minute':
      end.setMinutes(end.getMinutes() + 1);
      break;
  }
  
  end.setMilliseconds(end.getMilliseconds() - 1);
  
  return { start, end, precision };
}

// Enhanced jobs query builder
class JobsQueryBuilder {
  private whereConditions: any[] = [];
  private orderByConditions: any[] = [];
  
  addCommandFilter(commands: CrawlCommand | CrawlCommand[]): this {
    const commandArray = Array.isArray(commands) ? commands : [commands];
    if (commandArray.length > 0) {
      this.whereConditions.push(inArray(job.command, commandArray));
    }
    return this;
  }
  
  addStatusFilter(statuses: JobStatus | JobStatus[]): this {
    const statusArray = Array.isArray(statuses) ? statuses : [statuses];
    if (statusArray.length > 0) {
      this.whereConditions.push(inArray(job.status, statusArray));
    }
    return this;
  }
  
  addBooleanFilters(filters: { hasStarted?: boolean; hasFinished?: boolean; hasParent?: boolean }): this {
    if (filters.hasStarted !== undefined) {
      this.whereConditions.push(
        filters.hasStarted
          ? isNotNull(job.started_at)
          : isNull(job.started_at)
      );
    }
    
    if (filters.hasFinished !== undefined) {
      this.whereConditions.push(
        filters.hasFinished
          ? isNotNull(job.finished_at)
          : isNull(job.finished_at)
      );
    }
    
    if (filters.hasParent !== undefined) {
      this.whereConditions.push(
        filters.hasParent
          ? isNotNull(job.spawned_from)
          : isNull(job.spawned_from)
      );
    }
    
    return this;
  }
  
  addGlobalSearch(searchTerm: string): this {
    if (searchTerm.trim()) {
      const searchPattern = `%${searchTerm.trim()}%`;
      // Search in command and full_path (area path)
      this.whereConditions.push(
        or(
          like(job.command, searchPattern),
          like(job.full_path, searchPattern)
        )
      );
    }
    return this;
  }
  
  addDateSearch(dateInput: string, field: 'created' | 'updated' | 'started' | 'finished'): this {
    const dateRange = parseDateInput(dateInput);
    if (dateRange) {
      const dateColumn = this.getDateColumn(field);
      this.whereConditions.push(
        and(
          gte(dateColumn, dateRange.start),
          lte(dateColumn, dateRange.end)
        )
      );
    }
    return this;
  }
  
  addSorting(sortBy: string, order: 'asc' | 'desc'): this {
    const column = this.getSortColumn(sortBy);
    this.orderByConditions.push(
      order === 'desc' ? desc(column) : asc(column)
    );
    return this;
  }
  
  private getDateColumn(field: string) {
    switch (field) {
      case 'created': return job.created_at;
      case 'updated': return job.updated_at;
      case 'started': return job.started_at;
      case 'finished': return job.finished_at;
      default: return job.created_at;
    }
  }
  
  private getSortColumn(sortBy: string) {
    switch (sortBy) {
      case 'created': return job.created_at;
      case 'updated': return job.updated_at;
      case 'started': return job.started_at;
      case 'finished': return job.finished_at;
      case 'id': return job.id;
      case 'parent': return job.spawned_from;
      case 'status': return job.status;
      case 'command': return job.command;
      default: return job.created_at;
    }
  }
  
  async executeWithPagination(page: number, limit: number) {
    const offset = (page - 1) * limit;
    
    // Build WHERE clause
    const whereClause = this.whereConditions.length > 0
      ? and(...this.whereConditions)
      : undefined;
    
    // Execute count query (optimized, minimal data)
    const totalCountResult = await db
      .select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
      .from(job)
      .where(whereClause);
    const totalCount = totalCountResult[0]?.count || 0;
    
    // Execute data query with all relations
    const jobs = await db.query.job.findMany({
      where: whereClause,
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
      orderBy: this.orderByConditions.length > 0 ? this.orderByConditions : [desc(job.created_at)],
      limit,
      offset
    });
    
    // Transform results
    const transformedJobs = jobs.map((x) => {
      const { usingAccount, ...rest } = x;
      return {
        ...rest,
        provider: usingAccount?.providerId ?? undefined
      };
    });

    return {
      data: transformedJobs,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasNextPage: page < Math.ceil(totalCount / limit),
        hasPreviousPage: page > 1
      }
    };
  }
}

// Enhanced getJobs function using the query builder
const getJobsWithQuery = async (params: JobsQueryParams) => {
  const builder = new JobsQueryBuilder();
  
  // Apply filters
  if (params.command) {
    builder.addCommandFilter(params.command);
  }
  
  if (params.status) {
    builder.addStatusFilter(params.status);
  }
  
  builder.addBooleanFilters({
    hasStarted: params.hasStarted,
    hasFinished: params.hasFinished,
    hasParent: params.hasParent
  });
  
  // Apply search
  if (params.search) {
    builder.addGlobalSearch(params.search);
  }
  
  if (params.dateSearch) {
    builder.addDateSearch(params.dateSearch, params.dateField);
  }
  
  // Apply sorting
  builder.addSorting(params.sortBy, params.sortOrder);
  
  return builder.executeWithPagination(params.page, params.limit);
};
