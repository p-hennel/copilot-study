import { parseArgs } from "util";
import { configureLogging } from "../../lib/logging";
import { JobStatus, normalizeURL, CrawlCommand } from "$lib/utils"; // Added CrawlCommand
import type { AvailableJobType } from "$lib/utils";
import { Crawler } from "../gitlab";
import DataStorage from "../utils/datastorage"; // Import DataStorage
import MessageBusClient from "$lib/messaging/MessageBusClient";
import { updateJobResumeState, spawnNewJobs } from "$lib/server/db/jobFactory"; // Import DB functions
import { db } from "$lib/server/db"; // Import db instance for potential direct updates if needed
import { job as jobSchema } from "$lib/server/db/base-schema"; // Import job schema for updates
import { eq } from "drizzle-orm"; // Import eq for updates

// Define the structure of the resume state object
type ResumeState = Record<string, string | null>; // Maps task key (e.g., "groups/path:issues") to cursor

// Define the structure for job data including resume state
type JobWithState = AvailableJobType & {
  resumeState: ResumeState | null;
};


declare module "bun" {
  interface Env {
    GITLAB_GQL_URL: string;
    GITLAB_REST_URL: string;
    JIRA_BASE_URL: string;
    PUBLIC_API_URL: string;
    HMAC_KEY: string;
    HASH_ALG: string;
    DATA_ROOT_PATH?: string;
  }
}

function getParams() {
  const { values } = parseArgs({
    args: Bun.argv,
    options: {
      test: { type: "boolean", multiple: false },
      token: { type: "string", short: "t", multiple: false },
      url: { type: "string", short: "u", multiple: false },
      gql: { type: "string", short: "g", multiple: false },
      rest: { type: "string", short: "r", multiple: false },
      base: { type: "string", short: "b", multiple: false },
      out: { type: "string", short: "o", multiple: false },
      debug: { type: "boolean", short: "d", multiple: false },
      verbose: { type: "boolean", short: "v", multiple: false }
    },
    strict: true,
    allowNegative: true,
    allowPositionals: true
  });

  if (!values.test) {
    if (!values.url || !values.token) {
      throw new Error("Need both url together with token arguments!");
    } // Added missing closing brace
  }
  if (!values.url) values.url = "http://localhost:4000";

  if (!!values.base) {
    values.base = normalizeURL(values.base);
    if (!values.gql) values.gql = `${values.base}/api/graphql`;
    if (!values.rest) values.rest = values.base;
  }
  return values;
}

const params = getParams();
const logger = await configureLogging("runner", params.verbose, params.debug);
logger.debug("parsed params", params);

// --- DataStorage Base Path ---
// Determine the base path for data storage. Use env var or default.
const dataStorageBasePath = Bun.env.DATA_ROOT_PATH ? [Bun.env.DATA_ROOT_PATH] : undefined;
logger.info(`Data storage base path: ${DataStorage.getBaseDir(dataStorageBasePath)}`);
// Ensure the base directory exists (optional here, as DataStorage handles it)
// await DataStorage.prepare(dataStorageBasePath);


/**
 * Fallback: Fetch a job using the API.
 * TODO: Modify API endpoint /api/jobs to return resumeState as well.
 */
async function getJobFromAPI(url: string, token: string): Promise<JobWithState | undefined> { // Keep this definition
  try {
    // Assuming the API endpoint is updated to return resumeState
    const jobsResponse = await fetch(`${url}/api/jobs?perPage=1&status=queued`, { // Fetch queued jobs
      headers: { Auth: `Bearer ${token}` }
    });
    if (!jobsResponse.ok) {
      let text = "";
      try { text = await jobsResponse.text(); } catch (e) {}
      logger.error("Job request failed", { status: jobsResponse.status, statusText: jobsResponse.statusText, text });
      return undefined;
    }
    const result = await jobsResponse.json();
    // Assuming result is an array of jobs, each including resumeState
    if (result && result.length > 0) return result[0] as JobWithState;
  } catch (error) {
    logger.error("Error fetching job from API: {error}", {error});
  }
  return undefined;
}

/**
 * Updates the job status in the database.
 */
async function updateJobStatus(jobId: string, status: JobStatus, finishedAt: Date | null = null): Promise<void> {
    logger.info("Updating job {jobId} status to {status}", { jobId, status });
    try {
        await db.update(jobSchema)
            .set({ status: status, finished_at: finishedAt })
            .where(eq(jobSchema.id, jobId));
    } catch (error) {
        logger.error("Failed to update job status for {jobId}: {error}", { jobId, error });
    }
     // Also report status via IPC if available
    if (process.send) {
        MessageBusClient.reportProgress(jobId, status, { message: `Job status updated to ${status}` });
    }
}


/**
 * Process a job: determine scope, crawl data, manage state.
 */
async function processJob(job: JobWithState): Promise<void> {
  logger.info("Processing job {jobId} ({command} for {fullPath})", { jobId: job.id, command: job.command, fullPath: job.fullPath ?? 'N/A' });

  // Set job status to running
  await updateJobStatus(job.id, JobStatus.running);

  const storage = new DataStorage(dataStorageBasePath, logger.getChild("storage"));
  let crawler: Crawler | null = null; // Initialize crawler later based on provider

  try {
    if (job.provider === "gitlab") {
      // Instantiate the GitLab crawler
      crawler = new Crawler(
        logger.getChild("gitlab"),
        job.baseURL ?? Bun.env.GITLAB_GQL_URL ?? "", // Use job-specific URL if available
        job.baseURL ?? Bun.env.GITLAB_REST_URL ?? "", // Use job-specific URL if available
        job.accessToken ?? "",
        storage // Pass the storage instance
        // TODO: Pass callbacks and IPC emitter later
      );

      if (job.command === CrawlCommand.authorizationScope) {
        logger.info("Determining authorization scope for job {jobId}", { jobId: job.id });
        // Call the actual method
        const scopeResult = await crawler.determineAuthorizationScope();
        // Removed mock result

        if (scopeResult) {
          logger.info("Spawning new jobs based on scope for job {jobId}", { jobId: job.id });
          // Ensure job.provider is passed correctly if needed by spawnNewJobs
          await spawnNewJobs(job.provider, scopeResult, { accountId: job.accountId, id: job.id });
          await updateJobStatus(job.id, JobStatus.finished, new Date());
        } else {
          logger.error("Failed to determine authorization scope for job {jobId}", { jobId: job.id });
          await updateJobStatus(job.id, JobStatus.failed);
        }
      } else {
        // Handle specific crawl commands (Issues, MRs, etc.)
        logger.info("Executing command {command} for {fullPath} (Job: {jobId})", { command: job.command, fullPath: job.fullPath, jobId: job.id });

        // Construct a unique key for the resume state based on command and path
        const resumeKey = `${job.fullPath ?? 'global'}:${job.command}`;
        // Retrieve the start cursor from the job's state
        const startCursor = job.resumeState?.[resumeKey] ?? null;
        logger.debug("Using startCursor: {startCursor} for key {resumeKey}", { startCursor, resumeKey });

        // Call the crawler's main crawl method, passing the start cursor
        const crawlResult = await crawler.crawl(job.command, job.fullPath, startCursor);
        const lastCursor = crawlResult.lastCursor; // Get the returned cursor

        // Update resume state in the database
        // Create or update the resume state object
        const currentResumeState = job.resumeState ?? {};
        const newResumeState = { ...currentResumeState, [resumeKey]: lastCursor };
        await updateJobResumeState(job.id, newResumeState);
        logger.debug("Updated resume state for key {resumeKey} to {lastCursor}", { resumeKey, lastCursor });

        // Determine job status based on the returned cursor
        if (lastCursor === null) {
           // A null cursor indicates this specific command/path combination is complete
           logger.info("Crawl command {command} for {fullPath} completed (Job: {jobId})", { command: job.command, fullPath: job.fullPath ?? 'N/A', jobId: job.id });
           // TODO: More sophisticated logic needed if a job involves multiple steps.
           // For now, assume completion of one command means the job is finished.
           await updateJobStatus(job.id, JobStatus.finished, new Date());
        } else {
             // A non-null cursor means the crawl was paused (e.g., interrupted, rate limited, completed a page)
             logger.info("Crawl command {command} for {fullPath} paused at cursor {lastCursor} (Job: {jobId})", { command: job.command, fullPath: job.fullPath ?? 'N/A', lastCursor, jobId: job.id });
             // Set status back to queued so it can be picked up again to resume
             await updateJobStatus(job.id, JobStatus.queued);
        }
      }
    } else {
      logger.warn("Unsupported provider {provider} for job {jobId}", { provider: job.provider, jobId: job.id });
      await updateJobStatus(job.id, JobStatus.failed);
    }

  } catch (error: any) {
    logger.error("Error processing job {jobId}: {error}\n{stack}", { jobId: job.id, error: error.message, stack: error.stack });
    await updateJobStatus(job.id, JobStatus.failed);
  } finally {
    // Ensure storage is properly closed
    await storage.done();
  }
}
// Removed the extra closing brace here

/**
 * Main runner loop:
 *  - First, try to request a job via IPC (MessageBus)
 *  - If that fails (or IPC is not available), fallback to API polling
 *  - Process the job (including state updates) and then loop.
 */
async function runRunnerContinuously() {
  let shouldContinue = true
  process.on('SIGINT', function() {
    logger.info("SIGINT received, attempting graceful shutdown...");
    shouldContinue = false
  })

  // TODO: Add listener for IPC commands (pause/resume/stop)

  while (shouldContinue) {
    let job: JobWithState | undefined;

    // 1. Request Job via IPC (Primary)
    if (process.send) {
      try {
        // TODO: Update MessageBusClient.requestJob to return JobWithState
        const rawJob = await MessageBusClient.requestJob(10000); // Timeout after 10s
        if (rawJob) {
             // Assuming rawJob needs casting or enrichment with resumeState if not included via IPC
             job = rawJob as JobWithState; // Adjust as needed based on IPC implementation
             logger.info("Received job {jobId} via IPC", { jobId: job.id });
        }
      } catch (error) {
        // Don't log error if it's just a timeout (no job available)
        if (error instanceof Error && !error.message.includes('Timeout')) {
             logger.error("IPC job request failed: {error}", { error });
        }
      }
    }

    // 2. Fetch Job via API (Fallback or if no IPC)
    // Use non-null assertion as getParams throws if these are missing when needed
    if (!job && params.token) { // Only poll API if token is provided
      job = await getJobFromAPI(params.url!, params.token!);
      if (job) {
        logger.info("Received job {jobId} via API polling", { jobId: job.id });
      }
    }

    // 3. Process Job if available
    if (job) {
       // Check job status again before processing (might have changed)
       // TODO: Add check if job status is still 'queued' or 'running' (if resuming)
      await processJob(job);
    } else {
      if (!shouldContinue) break; // Exit loop if shutdown initiated
      logger.debug("No job available. Waiting before next check.");
      // Wait a bit before trying again (e.g., 5 seconds)
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

await runRunnerContinuously();
