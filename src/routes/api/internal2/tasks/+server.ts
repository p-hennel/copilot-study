import { json, type RequestHandler } from "@sveltejs/kit";
import { getLogger } from "$lib/logging";
import AppSettings from "$lib/server/settings";
import { db } from "$lib/server/db";
import { job, type Job } from "$lib/server/db/base-schema";
import { JobStatus } from "$lib/types";
import { and, asc, eq, inArray } from "drizzle-orm";
import { isAdmin } from "$lib/server/utils";
import { CrawlCommand, TokenProvider } from "$lib/types";
const logger = getLogger(["backend", "api", "internal2", "tasks"]);

// GitLab task types that match the crawler protocol
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

interface CrawlerTaskRequest {
  type: "task";
  data: {
    id: string;
    type: GitLabTaskType;
    credentials: {
      accessToken: string;
      refreshToken?: string;
    };
    apiEndpoint: string;
    rateLimits?: {
      requestsPerMinute?: number;
      requestsPerHour?: number;
      burstLimit?: number;
    };
    options?: {
      resourceId?: string | number;
      resourceType?: string;
      branch?: string;
      fromDate?: string;
      toDate?: string;
      pagination?: {
        pageSize?: number;
        maxPages?: number;
      };
      filters?: Record<string, any>;
    };
  };
}

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
    error: progress?.error
  };
}

/**
 * Map internal command to GitLab task type
 */
function mapCommandToGitLabTaskType(command: string): GitLabTaskType {
  // This is a simplified mapping - in practice you'd have a more comprehensive mapping
  const mappings: Record<string, GitLabTaskType> = {
    "GROUP_PROJECT_DISCOVERY": "DISCOVER_AREAS",
    "project": "FETCH_PROJECT_DETAILS",
    "group": "FETCH_GROUP_DETAILS",
    "issues": "FETCH_ISSUES",
    "mergeRequests": "FETCH_MERGE_REQUESTS",
    "commits": "FETCH_COMMITS",
    "branches": "FETCH_BRANCHES",
    "tags": "FETCH_TAGS",
    "pipelines": "FETCH_PIPELINES",
    "jobs": "FETCH_JOBS",
    "deployments": "FETCH_DEPLOYMENTS",
    "environments": "FETCH_ENVIRONMENTS",
    "vulnerabilities": "FETCH_VULNERABILITIES"
  };
  
  return mappings[command] || "FETCH_PROJECT_DETAILS";
}

/**
 * Map GitLab task type to internal command
 */
function mapGitLabTaskTypeToCommand(taskType: GitLabTaskType): CrawlCommand {
  const mappings: Record<GitLabTaskType, CrawlCommand> = {
    "DISCOVER_AREAS": CrawlCommand.GROUP_PROJECT_DISCOVERY,
    "FETCH_PROJECTS": CrawlCommand.project,
    "FETCH_GROUPS": CrawlCommand.group,
    "FETCH_PROJECT_DETAILS": CrawlCommand.project,
    "FETCH_GROUP_DETAILS": CrawlCommand.group,
    "FETCH_PROJECT_MEMBERS": CrawlCommand.projectMembers,
    "FETCH_GROUP_MEMBERS": CrawlCommand.groupMembers,
    "FETCH_ISSUES": CrawlCommand.issues,
    "FETCH_MERGE_REQUESTS": CrawlCommand.mergeRequests,
    "FETCH_COMMITS": CrawlCommand.commits,
    "FETCH_BRANCHES": CrawlCommand.branches,
    "FETCH_TAGS": CrawlCommand.tags,
    "FETCH_PIPELINES": CrawlCommand.pipelines,
    "FETCH_JOBS": CrawlCommand.jobs,
    "FETCH_DEPLOYMENTS": CrawlCommand.deployments,
    "FETCH_ENVIRONMENTS": CrawlCommand.environments,
    "FETCH_VULNERABILITIES": CrawlCommand.vulnerabilities
  };
  
  return mappings[taskType] || CrawlCommand.project;
}

/**
 * GET /api/internal2/tasks - Retrieve tasks/jobs
 */
export const GET: RequestHandler = async ({ request, url, locals }) => {
  const currentCrawlerApiToken = AppSettings().app?.CRAWLER_API_TOKEN;
  
  // Authentication
  const adminCheck = await isAdmin(locals);
  if (!currentCrawlerApiToken && !locals.isSocketRequest && !adminCheck) {
    logger.error("Tasks endpoint: CRAWLER_API_TOKEN setting not set");
    return json({ error: "Endpoint disabled due to missing configuration" }, { status: 503 });
  }

  if (!locals.isSocketRequest && !adminCheck) {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      logger.warn("Tasks GET: Missing or malformed Authorization header");
      return json({ error: "Invalid or missing authentication" }, { status: 401 });
    }

    const token = authHeader.substring("Bearer ".length);
    if (token !== currentCrawlerApiToken) {
      logger.warn("Tasks GET: Invalid token provided");
      return json({ error: "Invalid authentication token" }, { status: 401 });
    }
  }

  // Parse query parameters
  const status = url.searchParams.get("status");
  const taskType = url.searchParams.get("type");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "10", 10), 100);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10), 0);

  logger.info(`Tasks GET request`, { status, taskType, limit, offset });

  try {
    // Build query conditions
    const conditions = [];
    
    if (status) {
      const jobStatuses = [];
      switch (status) {
        case "queued":
          jobStatuses.push(JobStatus.queued);
          break;
        case "running":
          jobStatuses.push(JobStatus.running);
          break;
        case "completed":
          jobStatuses.push(JobStatus.finished);
          break;
        case "failed":
          jobStatuses.push(JobStatus.failed);
          break;
        case "paused":
          jobStatuses.push(JobStatus.paused, JobStatus.credential_expired, 
                          JobStatus.waiting_credential_renewal, JobStatus.credential_renewed);
          break;
      }
      
      if (jobStatuses.length > 0) {
        conditions.push(inArray(job.status, jobStatuses));
      }
    }

    // Query jobs
    const jobs = await db.query.job.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      orderBy: [asc(job.created_at)],
      limit,
      offset,
      with: {
        usingAccount: true
      }
    });

    // Convert to task responses
    const tasks = jobs.map(mapJobToTaskResponse);

    logger.info(`Retrieved ${tasks.length} tasks`);

    return json({
      data: tasks,
      meta: {
        total: tasks.length,
        limit,
        offset,
        hasMore: tasks.length === limit
      }
    }, { status: 200 });

  } catch (error) {
    logger.error("Error retrieving tasks:", { error });
    return json({ error: "Internal server error" }, { status: 500 });
  }
};

/**
 * POST /api/internal2/tasks - Create new task
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  const currentCrawlerApiToken = AppSettings().app?.CRAWLER_API_TOKEN;
  
  // Authentication
  const adminCheck = await isAdmin(locals);
  if (!currentCrawlerApiToken && !locals.isSocketRequest && !adminCheck) {
    logger.error("Tasks endpoint: CRAWLER_API_TOKEN setting not set");
    return json({ error: "Endpoint disabled due to missing configuration" }, { status: 503 });
  }

  if (!locals.isSocketRequest && !adminCheck) {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      logger.warn("Tasks POST: Missing or malformed Authorization header");
      return json({ error: "Invalid or missing authentication" }, { status: 401 });
    }

    const token = authHeader.substring("Bearer ".length);
    if (token !== currentCrawlerApiToken) {
      logger.warn("Tasks POST: Invalid token provided");
      return json({ error: "Invalid authentication token" }, { status: 401 });
    }
  }

  let payload: CrawlerTaskRequest;
  try {
    payload = await request.json() as CrawlerTaskRequest;
  } catch (error) {
    logger.error("Error parsing task creation request:", { error });
    return json({ error: "Invalid request body" }, { status: 400 });
  }

  // Validate required fields
  if (!payload.data?.id || !payload.data?.type || !payload.data?.credentials?.accessToken) {
    logger.warn("Invalid task creation request - missing required fields", { payload });
    return json({ error: "Missing required fields: id, type, credentials.accessToken" }, { status: 400 });
  }

  const { id, type, apiEndpoint, options } = payload.data;

  logger.info(`Creating new task`, { id, type, apiEndpoint });

  try {
    // Check if task already exists
    const existingJob = await db.query.job.findFirst({
      where: eq(job.id, id)
    });

    if (existingJob) {
      logger.warn(`Task ${id} already exists`);
      return json({ error: "Task with this ID already exists" }, { status: 409 });
    }

    // Map GitLab task type to internal command
    const mappedCommand = mapGitLabTaskTypeToCommand(type);
    
    // Create job record
    const newJob = {
      id,
      command: mappedCommand,
      status: JobStatus.queued,
      created_at: new Date(),
      updated_at: new Date(),
      started_at: null,
      finished_at: null,
      userId: "system", // You'd get this from authentication
      provider: TokenProvider.gitlab, // Determine from apiEndpoint
      accountId: "temp", // You'd resolve this from credentials
      gitlabGraphQLUrl: apiEndpoint,
      full_path: options?.resourceId ? String(options.resourceId) : null,
      branch: options?.branch || null,
      from: options?.fromDate ? new Date(options.fromDate) : null,
      to: options?.toDate ? new Date(options.toDate) : null,
      spawned_from: null,
      resumeState: null,
      progress: {
        processed: 0,
        total: null,
        message: "Task created"
      }
    };

    await db.insert(job).values(newJob);

    logger.info(`Task ${id} created successfully`);

    return json({
      data: mapJobToTaskResponse(newJob as Job),
      message: "Task created successfully"
    }, { status: 201 });

  } catch (error) {
    logger.error(`Error creating task ${id}:`, { error });
    return json({ error: "Internal server error" }, { status: 500 });
  }
};