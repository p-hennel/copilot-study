import { json, type RequestHandler } from "@sveltejs/kit";
import { getLogger } from "$lib/logging";
import AppSettings from "$lib/server/settings";
import { db } from "$lib/server/db";
import { job, type Job } from "$lib/server/db/base-schema";
import { JobStatus } from "$lib/types";
import { eq, sql } from "drizzle-orm";
import { isAdmin } from "$lib/server/utils";
import { error } from "@sveltejs/kit";
import { isAuthorizedSocketRequest } from "$lib/server/direct-auth";

const logger = getLogger(["backend", "api", "internal2", "tasks", "progress"]);

interface ProgressUpdateRequest {
  type: "progress" | "status" | "error" | "completed" | "failed";
  processed?: number;
  total?: number;
  currentStep?: string;
  percentage?: number;
  message?: string;
  error?: string;
  metadata?: Record<string, any>;
  timestamp?: string;
}

/**
 * Enhanced authentication with proper precedence and logging using DirectSocketAuth
 */
async function authenticateRequest(request: Request, locals: any, operation: string): Promise<{ success: boolean; method: string }> {
  const currentCrawlerApiToken = AppSettings().app?.CRAWLER_API_TOKEN;
  const isAuthorizedSocket = isAuthorizedSocketRequest(request);
  const adminCheck = await isAdmin(locals);
  
  let authMethod = 'none';
  let authSuccess = false;

  // 1. Check socket bypass (highest precedence)
  if (isAuthorizedSocket) {
    authMethod = 'socket_bypass';
    authSuccess = true;
    logger.info(`Progress ${operation}: Authenticated via authorized socket connection`, {
      requestSource: request.headers.get('x-request-source'),
      clientId: request.headers.get('x-client-id')
    });
  }
  // 2. Check admin session (medium precedence)
  else if (adminCheck) {
    authMethod = 'admin_session';
    authSuccess = true;
    logger.info(`Progress ${operation}: Authenticated via admin session`, {
      userId: locals.user?.id,
      userEmail: locals.user?.email
    });
  }
  // 3. Check API token (lowest precedence)
  else if (currentCrawlerApiToken) {
    const authHeader = request.headers.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring("Bearer ".length);
      if (token === currentCrawlerApiToken) {
        authMethod = 'api_token';
        authSuccess = true;
        // Progress updates are frequent crawler operations, so info level for POST, warn for manual updates
        const logLevel = operation === 'POST' ? 'info' : 'warn';
        const message = `Progress ${operation}: Authenticated via API token` +
                       (operation === 'POST' ? ' - automated crawler progress update' : ' - consider admin session for manual operations');
        logger[logLevel](message, {
          tokenPreview: token.substring(0, 8) + '...'
        });
      } else {
        logger.warn(`Progress ${operation}: Invalid API token provided`, {
          tokenPreview: token.substring(0, 8) + '...'
        });
      }
    } else {
      logger.warn(`Progress ${operation}: Missing or malformed Authorization header for API token auth`);
    }
  }

  if (!authSuccess && !currentCrawlerApiToken) {
    logger.error(`Progress ${operation}: Authentication failed - CRAWLER_API_TOKEN not configured and no admin session`);
  } else if (!authSuccess) {
    logger.error(`Progress ${operation}: Authentication failed - no valid credentials provided`);
  }

  return { success: authSuccess, method: authMethod };
}

/**
 * Convert update type to job status
 */
function mapUpdateTypeToJobStatus(updateType: string, currentStatus: JobStatus): JobStatus {
  switch (updateType) {
    case "progress":
      return currentStatus === JobStatus.queued ? JobStatus.running : currentStatus;
    case "status":
      return currentStatus; // Status updates don't change the job status directly
    case "completed":
      return JobStatus.finished;
    case "failed":
    case "error":
      return JobStatus.failed;
    default:
      return currentStatus;
  }
}

/**
 * POST /api/internal2/tasks/[taskId]/progress - Update task progress
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
  const { taskId } = params;

  if (!taskId) {
    return json({ error: "Task ID is required" }, { status: 400 });
  }

  const authResult = await authenticateRequest(request, locals, 'POST');
  if (!authResult.success) {
    logger.warn(`Progress update: Authentication failed for task ${taskId}`);
    return json({ error: "Authentication failed" }, { status: 401 });
  }

  // Log security metrics for progress updates
  logger.info('Progress POST: Authentication successful for progress update', {
    method: authResult.method,
    taskId,
    endpoint: 'tasks/[taskId]/progress',
    operation: 'update',
    timestamp: new Date().toISOString()
  });

  let progressUpdate: ProgressUpdateRequest;
  try {
    progressUpdate = await request.json() as ProgressUpdateRequest;
  } catch (err) {
    logger.error(`Error parsing progress update for task ${taskId}:`, { error: err });
    return json({ error: "Invalid request body" }, { status: 400 });
  }

  // Validate required fields
  if (!progressUpdate.type) {
    logger.warn(`Missing update type in progress update for task ${taskId}`, { progressUpdate });
    return json({ error: "Missing required field: type" }, { status: 400 });
  }

  logger.info(`Received progress update for task ${taskId}`, { 
    type: progressUpdate.type,
    processed: progressUpdate.processed,
    total: progressUpdate.total,
    message: progressUpdate.message
  });

  try {
    // Check if task exists
    const existingJob = await db.query.job.findFirst({
      where: eq(job.id, taskId)
    });

    if (!existingJob) {
      logger.warn(`Task ${taskId} not found for progress update`);
      throw error(404, { message: "Task not found" });
    }

    // Prepare update data
    const updateData: Partial<Job> = {
      // updated_at will be handled with SQL
    };

    // Map update type to job status
    const newStatus = mapUpdateTypeToJobStatus(progressUpdate.type, existingJob.status);
    if (newStatus !== existingJob.status) {
      updateData.status = newStatus;

      // Set timestamps based on status change - removed direct assignments
      // These will be handled in the database update with SQL functions
    }

    // Update progress data
    const currentProgress = (existingJob.progress as any) || {};
    const newProgress = {
      ...currentProgress,
      lastUpdate: progressUpdate.timestamp || new Date().toISOString(),
      updateType: progressUpdate.type
    };

    // Add progress fields if provided
    if (progressUpdate.processed !== undefined) {
      newProgress.processed = progressUpdate.processed;
    }
    if (progressUpdate.total !== undefined) {
      newProgress.total = progressUpdate.total;
    }
    if (progressUpdate.currentStep) {
      newProgress.currentStep = progressUpdate.currentStep;
      newProgress.currentDataType = progressUpdate.currentStep; // For compatibility
    }
    if (progressUpdate.percentage !== undefined) {
      newProgress.percentage = progressUpdate.percentage;
    }
    if (progressUpdate.message) {
      newProgress.message = progressUpdate.message;
    }
    if (progressUpdate.error) {
      newProgress.error = progressUpdate.error;
    }
    if (progressUpdate.metadata) {
      newProgress.metadata = {
        ...newProgress.metadata,
        ...progressUpdate.metadata
      };
    }

    updateData.progress = newProgress;

    // Perform the update with proper timestamp handling
    if (newStatus === JobStatus.running && !existingJob.started_at) {
      await db.update(job).set({
        ...updateData,
        started_at: sql`(unixepoch())`,
        updated_at: sql`(unixepoch())`
      }).where(eq(job.id, taskId));
    } else if (newStatus === JobStatus.finished || newStatus === JobStatus.failed) {
      await db.update(job).set({
        ...updateData,
        finished_at: sql`(unixepoch())`,
        updated_at: sql`(unixepoch())`
      }).where(eq(job.id, taskId));
    } else {
      await db.update(job).set({
        ...updateData,
        updated_at: sql`(unixepoch())`
      }).where(eq(job.id, taskId));
    }

    logger.info(`Progress updated for task ${taskId}`, {
      type: progressUpdate.type,
      status: newStatus,
      processed: progressUpdate.processed,
      total: progressUpdate.total
    });

    // Prepare response
    const responseData = {
      taskId,
      status: "acknowledged",
      message: `Progress update processed for task ${taskId}`,
      timestamp: new Date().toISOString(),
      currentStatus: newStatus,
      progress: {
        processed: newProgress.processed,
        total: newProgress.total,
        percentage: newProgress.percentage,
        currentStep: newProgress.currentStep,
        message: newProgress.message
      }
    };

    return json({ data: responseData }, { status: 200 });

  } catch (err) {
    logger.error(`Error updating progress for task ${taskId}:`, { error: err });
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    return json({ error: "Internal server error" }, { status: 500 });
  }
};

/**
 * GET /api/internal2/tasks/[taskId]/progress - Get task progress
 */
export const GET: RequestHandler = async ({ params, request, locals }) => {
  const { taskId } = params;

  if (!taskId) {
    return json({ error: "Task ID is required" }, { status: 400 });
  }

  const authResult = await authenticateRequest(request, locals, 'GET');
  if (!authResult.success) {
    logger.warn(`Progress GET: Authentication failed for task ${taskId}`);
    return json({ error: "Authentication failed" }, { status: 401 });
  }

  // Log security metrics
  logger.info('Progress GET: Authentication successful', {
    method: authResult.method,
    taskId,
    endpoint: 'tasks/[taskId]/progress',
    timestamp: new Date().toISOString()
  });

  logger.info(`Retrieving progress for task ${taskId}`);

  try {
    const jobRecord = await db.query.job.findFirst({
      where: eq(job.id, taskId)
    });

    if (!jobRecord) {
      logger.warn(`Task ${taskId} not found for progress retrieval`);
      throw error(404, { message: "Task not found" });
    }

    const progress = (jobRecord.progress as any) || {};

    const progressData = {
      taskId,
      status: jobRecord.status,
      createdAt: jobRecord.created_at.toISOString(),
      startedAt: jobRecord.started_at?.toISOString(),
      completedAt: jobRecord.finished_at?.toISOString(),
      lastUpdate: progress.lastUpdate || jobRecord.updated_at?.toISOString() || new Date().toISOString(),
      progress: {
        processed: progress.processed || 0,
        total: progress.total,
        percentage: progress.percentage,
        currentStep: progress.currentStep || progress.currentDataType,
        message: progress.message,
        error: progress.error,
        metadata: progress.metadata
      },
      timeline: progress.timeline || []
    };

    logger.info(`Retrieved progress for task ${taskId}`);
    return json({ data: progressData }, { status: 200 });

  } catch (err) {
    logger.error(`Error retrieving progress for task ${taskId}:`, { error: err });
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    return json({ error: "Internal server error" }, { status: 500 });
  }
};