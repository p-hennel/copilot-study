import { json, type RequestHandler } from "@sveltejs/kit";
import { getLogger } from "$lib/logging";
import AppSettings from "$lib/server/settings";
import { db } from "$lib/server/db";
import { job, type Job } from "$lib/server/db/base-schema";
import { JobStatus, CrawlCommand } from "$lib/types";
import { eq } from "drizzle-orm";
import { isAdmin } from "$lib/server/utils";
import { error } from "@sveltejs/kit";

const logger = getLogger(["backend", "api", "internal2", "tasks", "individual"]);

// GitLab task types
type GitLabTaskType = 
  | "DISCOVER_AREAS"
  | "FETCH_PROJECTS" 
  | "FETCH_GROUPS"
  | "FETCH_PROJECT_DETAILS"
  | "FETCH_GROUP_DETAILS"
  | "FETCH_PROJECT_MEMBERS"
  | "FETCH_GROUP_MEMBERS"
  | "FETCH_ISSUES"
  | "FETCH_MERGE_REQUESTS"
  | "FETCH_COMMITS"
  | "FETCH_BRANCHES"
  | "FETCH_TAGS"
  | "FETCH_PIPELINES"
  | "FETCH_JOBS"
  | "FETCH_DEPLOYMENTS"
  | "FETCH_ENVIRONMENTS"
  | "FETCH_VULNERABILITIES";

interface TaskResponse {
  id: string;
  type: GitLabTaskType;
  status: "queued" | "running" | "completed" | "failed" | "paused";
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  progress?: {
    processed?: number;
    total?: number;
    currentStep?: string;
  };
  error?: string;
  metadata?: {
    resourceId?: string;
    resourceType?: string;
    apiEndpoint?: string;
    branch?: string;
    fromDate?: string;
    toDate?: string;
  };
}

interface TaskUpdateRequest {
  status?: "queued" | "running" | "completed" | "failed" | "paused";
  progress?: {
    processed?: number;
    total?: number;
    currentStep?: string;
  };
  error?: string;
}

/**
 * Convert internal job status to external task status
 */
function mapJobStatusToTaskStatus(jobStatus: JobStatus): TaskResponse["status"] {
  switch (jobStatus) {
    case JobStatus.queued:
      return "queued";
    case JobStatus.running:
      return "running";
    case JobStatus.finished:
      return "completed";
    case JobStatus.failed:
      return "failed";
    case JobStatus.paused:
      return "paused";
    case JobStatus.credential_expired:
    case JobStatus.waiting_credential_renewal:
    case JobStatus.credential_renewed:
      return "paused";
    default:
      return "queued";
  }
}

/**
 * Map internal command to GitLab task type
 */
function mapCommandToGitLabTaskType(command: string): GitLabTaskType {
  const mappings: Record<string, GitLabTaskType> = {
    [CrawlCommand.GROUP_PROJECT_DISCOVERY]: "DISCOVER_AREAS",
    [CrawlCommand.project]: "FETCH_PROJECT_DETAILS",
    [CrawlCommand.group]: "FETCH_GROUP_DETAILS",
    [CrawlCommand.issues]: "FETCH_ISSUES",
    [CrawlCommand.mergeRequests]: "FETCH_MERGE_REQUESTS",
    [CrawlCommand.commits]: "FETCH_COMMITS",
    [CrawlCommand.branches]: "FETCH_BRANCHES",
    [CrawlCommand.tags]: "FETCH_TAGS",
    [CrawlCommand.pipelines]: "FETCH_PIPELINES",
    [CrawlCommand.jobs]: "FETCH_JOBS",
    [CrawlCommand.deployments]: "FETCH_DEPLOYMENTS",
    [CrawlCommand.environments]: "FETCH_ENVIRONMENTS",
    [CrawlCommand.vulnerabilities]: "FETCH_VULNERABILITIES"
  };
  
  return mappings[command] || "FETCH_PROJECT_DETAILS";
}

/**
 * Convert internal job to external task response
 */
function mapJobToTaskResponse(jobRecord: Job): TaskResponse {
  const progress = jobRecord.progress as any;
  
  return {
    id: jobRecord.id,
    type: mapCommandToGitLabTaskType(jobRecord.command as string),
    status: mapJobStatusToTaskStatus(jobRecord.status),
    createdAt: jobRecord.created_at.toISOString(),
    startedAt: jobRecord.started_at?.toISOString(),
    completedAt: jobRecord.finished_at?.toISOString(),
    progress: progress ? {
      processed: progress.processed,
      total: progress.total,
      currentStep: progress.currentDataType || progress.message
    } : undefined,
    error: progress?.error,
    metadata: {
      resourceId: jobRecord.full_path || undefined,
      resourceType: jobRecord.command as string,
      apiEndpoint: jobRecord.gitlabGraphQLUrl || undefined,
      branch: jobRecord.branch || undefined,
      fromDate: jobRecord.from?.toISOString(),
      toDate: jobRecord.to?.toISOString()
    }
  };
}

/**
 * Authenticate request
 */
async function authenticateRequest(request: Request, locals: any): Promise<boolean> {
  const currentCrawlerApiToken = AppSettings().app?.CRAWLER_API_TOKEN;
  const adminCheck = await isAdmin(locals);
  
  if (locals.isSocketRequest || adminCheck) {
    return true;
  }

  if (!currentCrawlerApiToken) {
    return false;
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return false;
  }

  const token = authHeader.substring("Bearer ".length);
  return token === currentCrawlerApiToken;
}

/**
 * GET /api/internal2/tasks/[taskId] - Get specific task details
 */
export const GET: RequestHandler = async ({ params, request, locals }) => {
  const { taskId } = params;

  if (!taskId) {
    return json({ error: "Task ID is required" }, { status: 400 });
  }

  if (!await authenticateRequest(request, locals)) {
    logger.warn(`Task GET: Authentication failed for task ${taskId}`);
    return json({ error: "Authentication failed" }, { status: 401 });
  }

  logger.info(`Retrieving task details for ${taskId}`);

  try {
    const jobRecord = await db.query.job.findFirst({
      where: eq(job.id, taskId),
      with: {
        usingAccount: true
      }
    });

    if (!jobRecord) {
      logger.warn(`Task ${taskId} not found`);
      throw error(404, { message: "Task not found" });
    }

    const taskResponse = mapJobToTaskResponse(jobRecord);

    logger.info(`Retrieved task ${taskId} details`);
    return json({ data: taskResponse }, { status: 200 });

  } catch (err) {
    logger.error(`Error retrieving task ${taskId}:`, { error: err });
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    return json({ error: "Internal server error" }, { status: 500 });
  }
};

/**
 * PUT /api/internal2/tasks/[taskId] - Update task
 */
export const PUT: RequestHandler = async ({ params, request, locals }) => {
  const { taskId } = params;

  if (!taskId) {
    return json({ error: "Task ID is required" }, { status: 400 });
  }

  if (!await authenticateRequest(request, locals)) {
    logger.warn(`Task PUT: Authentication failed for task ${taskId}`);
    return json({ error: "Authentication failed" }, { status: 401 });
  }

  let updateRequest: TaskUpdateRequest;
  try {
    updateRequest = await request.json() as TaskUpdateRequest;
  } catch (err) {
    logger.error(`Error parsing task update request for ${taskId}:`, { error: err });
    return json({ error: "Invalid request body" }, { status: 400 });
  }

  logger.info(`Updating task ${taskId}`, { updateRequest });

  try {
    // Check if task exists
    const existingJob = await db.query.job.findFirst({
      where: eq(job.id, taskId)
    });

    if (!existingJob) {
      logger.warn(`Task ${taskId} not found for update`);
      throw error(404, { message: "Task not found" });
    }

    // Prepare update data
    const updateData: Partial<Job> = {
      updated_at: new Date()
    };

    // Map external status to internal status
    if (updateRequest.status) {
      switch (updateRequest.status) {
        case "queued":
          updateData.status = JobStatus.queued;
          break;
        case "running":
          updateData.status = JobStatus.running;
          if (!existingJob.started_at) {
            updateData.started_at = new Date();
          }
          break;
        case "completed":
          updateData.status = JobStatus.finished;
          updateData.finished_at = new Date();
          break;
        case "failed":
          updateData.status = JobStatus.failed;
          updateData.finished_at = new Date();
          break;
        case "paused":
          updateData.status = JobStatus.paused;
          break;
      }
    }

    // Update progress
    if (updateRequest.progress || updateRequest.error) {
      const currentProgress = (existingJob.progress as any) || {};
      updateData.progress = {
        ...currentProgress,
        ...(updateRequest.progress || {}),
        ...(updateRequest.error ? { error: updateRequest.error } : {})
      };
    }

    // Perform update
    await db.update(job).set(updateData).where(eq(job.id, taskId));

    // Fetch updated job
    const updatedJob = await db.query.job.findFirst({
      where: eq(job.id, taskId),
      with: {
        usingAccount: true
      }
    });

    if (!updatedJob) {
      throw new Error("Failed to retrieve updated job");
    }

    const taskResponse = mapJobToTaskResponse(updatedJob);

    logger.info(`Task ${taskId} updated successfully`);
    return json({ 
      data: taskResponse,
      message: "Task updated successfully"
    }, { status: 200 });

  } catch (err) {
    logger.error(`Error updating task ${taskId}:`, { error: err });
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    return json({ error: "Internal server error" }, { status: 500 });
  }
};

/**
 * DELETE /api/internal2/tasks/[taskId] - Cancel/delete task
 */
export const DELETE: RequestHandler = async ({ params, request, locals }) => {
  const { taskId } = params;

  if (!taskId) {
    return json({ error: "Task ID is required" }, { status: 400 });
  }

  if (!await authenticateRequest(request, locals)) {
    logger.warn(`Task DELETE: Authentication failed for task ${taskId}`);
    return json({ error: "Authentication failed" }, { status: 401 });
  }

  logger.info(`Deleting/canceling task ${taskId}`);

  try {
    // Check if task exists
    const existingJob = await db.query.job.findFirst({
      where: eq(job.id, taskId)
    });

    if (!existingJob) {
      logger.warn(`Task ${taskId} not found for deletion`);
      throw error(404, { message: "Task not found" });
    }

    // If task is running, mark as failed instead of deleting
    if (existingJob.status === JobStatus.running) {
      await db.update(job).set({
        status: JobStatus.failed,
        finished_at: new Date(),
        updated_at: new Date(),
        progress: {
          ...(existingJob.progress as any || {}),
          error: "Task canceled by user request"
        }
      }).where(eq(job.id, taskId));

      logger.info(`Running task ${taskId} marked as failed (canceled)`);
      return json({ 
        message: "Task canceled successfully" 
      }, { status: 200 });
    } else {
      // For non-running tasks, we can safely delete them
      await db.delete(job).where(eq(job.id, taskId));

      logger.info(`Task ${taskId} deleted successfully`);
      return json({ 
        message: "Task deleted successfully" 
      }, { status: 200 });
    }

  } catch (err) {
    logger.error(`Error deleting task ${taskId}:`, { error: err });
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    return json({ error: "Internal server error" }, { status: 500 });
  }
};