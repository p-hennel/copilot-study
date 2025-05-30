// Use environment variable or default to development mode detection
const dev = process.env.NODE_ENV !== 'production';
import type {
  CrawlerConfig,
  Job,
  JobFailedEvent,
  JobResult
} from "$lib/../crawler";
import { JobType } from "$lib/../crawler";
import { SupervisorClient } from "$lib/../subvisor/client";
import { ProcessState } from "$lib/../subvisor/types";
import { CrawlCommand, JobStatus, TokenProvider } from "$lib/types";
import { getLogger } from "@logtape/logtape";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { job } from "./db/base-schema";
import AppSettings from "./settings";
import { buildAuthCredentials } from "./utils";
// Import the auth IPC client

// Initialize the supervisor client
let client: SupervisorClient;

// Keep track of service heartbeats
const heartbeats: Record<string, Date> = {};

// Keep track of crawler states
const crawlerStates: Record<string, {
  state: ProcessState,
  queueStats?: any,
  runningJobs?: string[],
  queuedJobs?: string[],
  resourceCounts?: Record<string, number>,
  lastActive: Date
}> = {};

/**
 * Send a job to the crawler for processing
 * @param jobData The job data to send
 */
export async function crawlJob(jobData: Job) {
  if (!client) {
    throw new Error("Supervisor client not initialized");
  }
  
  // Create crawl job config from the job data
  const crawlJobConfig = {
    id: jobData.id,
    type: mapCrawlCommandToJobType(jobData.type as string),
    resourceId: jobData.resourceId,
    resourcePath: jobData.resourcePath,
    data: jobData.data,
    auth: {
      // Include auth details from the job or app settings
      oauthToken: jobData.auth?.oauthToken,
      refreshToken: jobData.auth?.refreshToken,
      clientId: jobData.auth?.clientId || AppSettings().auth.providers.gitlab.clientId,
      clientSecret: jobData.auth?.clientSecret || AppSettings().auth.providers.gitlab.clientSecret
    },
    parentJobId: jobData.parentJobId
  };
  
  // Send job to crawler
  client.emit("crawlJob", crawlJobConfig);
  
  // Update job status in DB to running
  try {
    await db.update(job)
      .set({
        status: JobStatus.running,
        started_at: new Date()
      })
      .where(eq(job.id, jobData.id));
  } catch (error) {
    const logger = getLogger(["connector", "main"]);
    logger.error(`Failed to update job status for ${jobData.id}: ${error}`);
  }
  
  return true;
}

/**
 * Get the current heartbeats for all connected services
 */
export function getHeartbeats() {
  return heartbeats;
}

/**
 * Get the current states of all connected crawlers
 */
export function getCrawlerStates() {
  return crawlerStates;
}

/**
 * Map CrawlCommand to GitLab JobType string
 */
function mapCrawlCommandToJobType(command: string): string {
  // Map from CrawlCommand to JobType
  const mapping: Record<CrawlCommand, string> = {
    // Discovery/authorization
    [CrawlCommand.authorizationScope]: JobType.DISCOVER_GROUPS,
    [CrawlCommand.users]: JobType.GROUP_MEMBERS, // Assuming users are often related to group membership context
    [CrawlCommand.timelogs]: JobType.PROJECT_DETAILS, // TODO: Review mapping for timelogs
    [CrawlCommand.workItems]: JobType.PROJECT_ISSUES, // TODO: Review mapping for workItems
    [CrawlCommand.groupProjects]: JobType.GROUP_PROJECTS,
    [CrawlCommand.groupSubgroups]: JobType.DISCOVER_SUBGROUPS,
    [CrawlCommand.GROUP_PROJECT_DISCOVERY]: JobType.GROUP_PROJECT_DISCOVERY,

    // Group services
    [CrawlCommand.group]: JobType.GROUP_DETAILS,
    [CrawlCommand.groupMembers]: JobType.GROUP_MEMBERS,
    [CrawlCommand.groupIssues]: JobType.GROUP_ISSUES,
    [CrawlCommand.epics]: JobType.GROUP_ISSUES, // TODO: Review mapping for epics (closest might be group issues or a new specific job type)
    [CrawlCommand.groupCustomAttributes]: JobType.GROUP_DETAILS, // TODO: Review mapping
    [CrawlCommand.groupAccessRequests]: JobType.GROUP_DETAILS, // TODO: Review mapping
    [CrawlCommand.groupVariables]: JobType.GROUP_DETAILS, // TODO: Review mapping
    [CrawlCommand.groupLabels]: JobType.GROUP_DETAILS, // TODO: Review mapping
    [CrawlCommand.groupBadges]: JobType.GROUP_DETAILS, // TODO: Review mapping
    [CrawlCommand.groupDeployTokens]: JobType.GROUP_DETAILS, // TODO: Review mapping
    [CrawlCommand.groupIssueBoards]: JobType.GROUP_ISSUES, // TODO: Review mapping
    [CrawlCommand.groupMilestones]: JobType.GROUP_DETAILS, // TODO: Review mapping (GitLab groups don't have milestones directly, projects do)
    [CrawlCommand.epicIssues]: JobType.GROUP_ISSUES, // TODO: Review mapping
    [CrawlCommand.epicNotes]: JobType.GROUP_ISSUES, // TODO: Review mapping
    [CrawlCommand.epicDiscussions]: JobType.GROUP_ISSUES, // TODO: Review mapping

    // Project services
    [CrawlCommand.project]: JobType.PROJECT_DETAILS,
    [CrawlCommand.projectVariables]: JobType.PROJECT_DETAILS, // TODO: Review mapping
    [CrawlCommand.projectMembers]: JobType.PROJECT_DETAILS, // TODO: Review mapping (or GROUP_MEMBERS if context implies project members)
    [CrawlCommand.issues]: JobType.PROJECT_ISSUES, // This was duplicated, assuming project context here
    [CrawlCommand.pagesDomains]: JobType.PROJECT_DETAILS, // TODO: Review mapping
    [CrawlCommand.projectCustomAttributes]: JobType.PROJECT_DETAILS, // TODO: Review mapping
    [CrawlCommand.projectStatistics]: JobType.PROJECT_DETAILS, // TODO: Review mapping
    [CrawlCommand.projectBadges]: JobType.PROJECT_DETAILS, // TODO: Review mapping
    [CrawlCommand.projectTemplates]: JobType.PROJECT_DETAILS, // TODO: Review mapping
    [CrawlCommand.projectAccessRequests]: JobType.PROJECT_DETAILS, // TODO: Review mapping
    [CrawlCommand.projectHooks]: JobType.PROJECT_DETAILS, // TODO: Review mapping
    [CrawlCommand.projectIssueBoards]: JobType.PROJECT_ISSUES, // TODO: Review mapping
    [CrawlCommand.freezePeriods]: JobType.PROJECT_DETAILS, // TODO: Review mapping

    // Repository services
    [CrawlCommand.commits]: JobType.PROJECT_BRANCHES, // Or a more specific commit job type if exists
    [CrawlCommand.commitDiscussions]: JobType.PROJECT_MERGE_REQUESTS, // Discussions often on MRs or issues. TODO: Review mapping
    [CrawlCommand.branches]: JobType.PROJECT_BRANCHES,
    [CrawlCommand.tags]: JobType.PROJECT_RELEASES, // Tags are often used for releases. TODO: Review mapping

    // Merge requests, snippets, pipelines, etc.
    [CrawlCommand.mergeRequests]: JobType.PROJECT_MERGE_REQUESTS,
    [CrawlCommand.mergeRequestNotes]: JobType.MERGE_REQUEST_DISCUSSIONS,
    [CrawlCommand.mergeRequestDiscussions]: JobType.MERGE_REQUEST_DISCUSSIONS,
    [CrawlCommand.mergeRequestAwardEmojis]: JobType.MERGE_REQUEST_DISCUSSIONS, // TODO: Review mapping
    [CrawlCommand.projectSnippets]: JobType.PROJECT_DETAILS, // TODO: Review mapping (No specific snippet job type)
    [CrawlCommand.snippets]: JobType.PROJECT_DETAILS, // TODO: Review mapping (No specific snippet job type)
    [CrawlCommand.pipelines]: JobType.PROJECT_PIPELINES,
    [CrawlCommand.pipelineSchedules]: JobType.PROJECT_PIPELINES, // TODO: Review mapping
    [CrawlCommand.jobs]: JobType.PIPELINE_DETAILS, // Assuming these are pipeline jobs. TODO: Review mapping
    [CrawlCommand.deployments]: JobType.PROJECT_RELEASES, // Deployments are related to releases. TODO: Review mapping
    [CrawlCommand.environments]: JobType.PROJECT_DETAILS, // TODO: Review mapping
    [CrawlCommand.pipelineScheduleVariables]: JobType.PROJECT_PIPELINES, // TODO: Review mapping
    [CrawlCommand.pipelineTriggers]: JobType.PROJECT_PIPELINES, // TODO: Review mapping
    [CrawlCommand.containerRegistryRepositories]: JobType.PROJECT_DETAILS, // TODO: Review mapping
    [CrawlCommand.packages]: JobType.PROJECT_DETAILS, // TODO: Review mapping
    [CrawlCommand.vulnerabilities]: JobType.PROJECT_VULNERABILITIES,
    [CrawlCommand.protectedBranches]: JobType.PROJECT_BRANCHES, // TODO: Review mapping
    [CrawlCommand.protectedTags]: JobType.PROJECT_RELEASES, // TODO: Review mapping
    [CrawlCommand.deployKeys]: JobType.PROJECT_DETAILS // TODO: Review mapping
  };
  
  return mapping[command as CrawlCommand] || JobType.PROJECT_DETAILS;
}

/**
 * Map JobType to CrawlCommand (reverse of above)
 */
function mapJobTypeToCrawlCommand(jobType: string): CrawlCommand {
  // Reverse mapping from JobType to CrawlCommand
  const mapping: Record<string, CrawlCommand> = {
    [JobType.DISCOVER_GROUPS]: CrawlCommand.authorizationScope,
    [JobType.DISCOVER_PROJECTS]: CrawlCommand.groupProjects,
    [JobType.DISCOVER_SUBGROUPS]: CrawlCommand.groupSubgroups,
    [JobType.GROUP_DETAILS]: CrawlCommand.group,
    [JobType.GROUP_MEMBERS]: CrawlCommand.users,
    [JobType.GROUP_PROJECTS]: CrawlCommand.groupProjects,
    [JobType.GROUP_ISSUES]: CrawlCommand.issues,
    [JobType.PROJECT_DETAILS]: CrawlCommand.project,
    [JobType.PROJECT_BRANCHES]: CrawlCommand.commits,
    [JobType.PROJECT_MERGE_REQUESTS]: CrawlCommand.mergeRequests,
    [JobType.PROJECT_ISSUES]: CrawlCommand.issues,
    [JobType.PROJECT_MILESTONES]: CrawlCommand.project,
    [JobType.PROJECT_RELEASES]: CrawlCommand.project,
    [JobType.PROJECT_PIPELINES]: CrawlCommand.pipelines,
    [JobType.PROJECT_VULNERABILITIES]: CrawlCommand.vulnerabilities,
    [JobType.MERGE_REQUEST_DISCUSSIONS]: CrawlCommand.mergeRequests,
    [JobType.ISSUE_DISCUSSIONS]: CrawlCommand.issues,
    [JobType.PIPELINE_DETAILS]: CrawlCommand.pipelines,
    [JobType.PIPELINE_TEST_REPORTS]: CrawlCommand.pipelines
  };
  
  return mapping[jobType] || CrawlCommand.project;
}

/**
 * Find pending jobs and send them to the crawler
 */
export async function processQueuedJobs() {
  const logger = getLogger(["connector", "jobs"]);
  
  // Check if any crawler is available
  const availableCrawlers = Object.entries(crawlerStates)
    .filter(([, state]) => 
      state.state === ProcessState.IDLE && 
      Date.now() - state.lastActive.getTime() < 60000); // Within last minute
      
  if (availableCrawlers.length === 0) {
    logger.info("No available crawlers found for processing queued jobs");
    return 0;
  }
  
  try {
    // Find queued jobs that are not being processed
    const queuedJobs = await db.select()
      .from(job)
      .where(
        and(
          eq(job.status, JobStatus.queued),
          isNull(job.started_at)
        )
      )
      .limit(10); // Process in batches
    
    if (queuedJobs.length === 0) {
      return 0;
    }
    
    logger.info(`Found ${queuedJobs.length} queued jobs to process`);
    
    // Process each job
    for (const dbJob of queuedJobs) {
      try {
        const jobData: Partial<Job> = {
          id: dbJob.id,
          type: mapCrawlCommandToJobType(dbJob.command || CrawlCommand.project) as any,
          resourceId: dbJob.full_path || '',
          resourcePath: dbJob.full_path || undefined,
          data: {
            branch: dbJob.branch || undefined,
            from: dbJob.from || undefined,
            to: dbJob.to || undefined,
            resumeState: dbJob.resumeState || undefined
          },
          createdAt: dbJob.created_at ? new Date(dbJob.created_at) : new Date(),
          priority: 0, // Default priority
          retryCount: 0,
          parentJobId: dbJob.spawned_from || undefined
          // Auth will be provided by the app settings in crawlJob
        };
        
        await crawlJob(jobData as Job);
        logger.info(`Sent job ${dbJob.id} to crawler`);
      } catch (error) {
        logger.error(`Failed to process job ${dbJob.id}: ${error}`);
        
        // Mark job as failed
        await db.update(job)
          .set({
            status: JobStatus.failed,
            finished_at: new Date()
          })
          .where(eq(job.id, dbJob.id));
      }
    }
    
    return queuedJobs.length;
  } catch (error) {
    logger.error(`Error processing queued jobs: ${error}`);
    return 0;
  }
}

/**
 * Send crawler configuration to a connected crawler
 * @param crawlerId The ID of the crawler to configure
 */
export async function sendCrawlerConfig(crawlerId: string) {
  const logger = getLogger(["connector", "config"]);
  
  if (!client) {
    throw new Error("Supervisor client not initialized");
  }
  
  try {
    // Create crawler configuration
    const config: CrawlerConfig = {
      gitlabUrl: `${dev ? AppSettings().auth.providers.gitlabCloud.baseUrl : AppSettings().auth.providers.gitlab.baseUrl}`,
      auth: {
        clientId: dev
          ? AppSettings().auth.providers.gitlabCloud.clientId
          : AppSettings().auth.providers.gitlab.clientId,
        clientSecret: dev
          ? AppSettings().auth.providers.gitlabCloud.clientSecret
          : AppSettings().auth.providers.gitlab.clientSecret
      },
      outputDir: AppSettings().paths.archive,
      requestsPerSecond: 10,
      concurrency: 5,
      maxRetries: 3,
      retryDelayMs: 5000,
      // Omitting hooks as they will be set by the crawler
    };
    
    // Send configuration to specific crawler
    client.sendMessage(crawlerId, "crawlerConfig", config);
    logger.info(`Sent configuration to crawler ${crawlerId}`);
    
    return true;
  } catch (error) {
    logger.error(`Failed to send configuration to crawler ${crawlerId}: ${error}`);
    return false;
  }
}

/**
 * Pause a crawler
 * @param crawlerId The ID of the crawler to pause
 */
export function pauseCrawler(crawlerId: string) {
  if (!client) {
    throw new Error("Supervisor client not initialized");
  }
  
  client.sendMessage(crawlerId, "pause");
  return true;
}

/**
 * Resume a crawler
 * @param crawlerId The ID of the crawler to resume
 */
export function resumeCrawler(crawlerId: string) {
  if (!client) {
    throw new Error("Supervisor client not initialized");
  }
  
  client.sendMessage(crawlerId, "resume");
  return true;
}

/**
 * Stop a crawler
 * @param crawlerId The ID of the crawler to stop
 */
export function stopCrawler(crawlerId: string) {
  if (!client) {
    throw new Error("Supervisor client not initialized");
  }
  
  client.sendMessage(crawlerId, "stop");
  return true;
}

/**
 * Request status from a crawler
 * @param crawlerId The ID of the crawler to get status from
 */
export function requestCrawlerStatus(crawlerId: string) {
  if (!client) {
    throw new Error("Supervisor client not initialized");
  }
  
  client.sendMessage(crawlerId, "getStatus");
  return true;
}

async function getAccountIdFromJob(jobId: string|undefined|null) {
  if (!jobId || jobId.length <= 0)
    return null
  return (await db.query.job.findFirst({
    columns: {
      accountId: true
    },
    where: eq(job.id, jobId)
  }))?.accountId
}

/**
 * Initialize the supervisor client and set up event handlers
 */
export async function boot() {
  const logger = getLogger(["connector", "main"]);
  client = new SupervisorClient();

  // Handle connection events
  client.on("connected", () => {
    logger.info("Connected to supervisor");
  });

  client.on("disconnected", () => {
    logger.warn("Disconnected from supervisor, will attempt to reconnect");
  });

  client.on("stop", () => {
    logger.info("Received stop command from supervisor");

    // Clean up
    setTimeout(() => {
      client.disconnect();
      process.exit(0);
    }, 1000);
  });

  // Handle ready event from new crawlers
  client.on("ready", (originId, payload) => {
    logger.info(`Crawler ${originId} is ready with capabilities: ${payload.capabilities.join(', ')}`);
    
    // Store crawler in the active crawlers list
    crawlerStates[originId] = {
      state: ProcessState.IDLE,
      lastActive: new Date()
    };
    
    // Send configuration to the crawler
    sendCrawlerConfig(originId);
    
    // Process any queued jobs as a new crawler is available
    processQueuedJobs().catch(err => {
      logger.error(`Error processing queued jobs after crawler ${originId} ready: ${err}`);
    });
  });

  // Handle job completed events
  client.on("jobCompleted", async (originId, event: { job: Job; result: JobResult }) => {
    logger.info(`Job completed from ${originId}: ${event.job.id}`);
    
    try {
      if (event.result.discoveredJobs && event.result.discoveredJobs.length > 0) {
        const toBeInserted = (await Promise.all(event.result.discoveredJobs.map(async (x) => ({
          accountId: await getAccountIdFromJob(x.parentJobId) ?? "",
          full_path: x.resourcePath,
          command: mapJobTypeToCrawlCommand(x.type),
          spawned_from: x.parentJobId,
          status: JobStatus.queued,
          created_at: new Date()
        })))).filter(x => x.accountId.length > 0)

        const insertResult = await db.insert(job).values(toBeInserted).onConflictDoNothing()

        if (insertResult.rowsAffected < event.result.discoveredJobs.length) {
          logger.debug("Inserted fewer rows ({insertCount}) than discovered ({discoveredCount})", { insertCount: insertResult.rowsAffected, disoveredCount: event.result.discoveredJobs.length, rows: insertResult.rows })
        }
      }
    } catch (error) {
      logger.error(`Failed to insert discovered jobs ${event.job.id} status: ${error}`);
    }

    try {
      // Update job status in the database
      db.update(job)
        .set({
          status: event.result.success ? JobStatus.finished : JobStatus.failed,
          finished_at: new Date(),
          // Store any progress information
          progress: event.result.data?.progress || null
        })
        .where(eq(job.id, event.job.id));
    } catch (error) {
      logger.error(`Failed to update job ${event.job.id} status: ${error}`);
    }
  });
  
  // Handle discovered jobs events - this is a new message type for IPC-based job planning
  client.on("discoveredJobs", async (originId, event: { jobs: Job[]; timestamp: number }) => {
    const autoEnqueueEnabled = true; // Default to true if not explicitly defined in settings
    
    if (event.jobs && event.jobs.length > 0 && autoEnqueueEnabled) {
      logger.info(`Received ${event.jobs.length} discovered jobs from ${originId}`);
      
      // Process each discovered job
      for (const discoveredJob of event.jobs) {
        try {
          // Convert to our DB job format and insert
          const newJob = {
            id: discoveredJob.id,
            command: mapJobTypeToCrawlCommand(discoveredJob.type as string),
            full_path: discoveredJob.resourcePath || String(discoveredJob.resourceId),
            accountId: (discoveredJob as any).accountId || 'system', // Use job's account ID or default to 'system'
            spawned_from: discoveredJob.parentJobId || null,
            status: JobStatus.queued,
            created_at: new Date()
          };
          
          // Insert the discovered job
          logger.info(`Inserting discovered job ${discoveredJob.id} of type ${discoveredJob.type}`);
          await db.insert(job).values(newJob as any); // Use 'as any' to bypass type checking
        } catch (error) {
          logger.error(`Failed to insert discovered job ${discoveredJob.id}: ${error}`);
        }
      }
    }
  });

  // Handle job failed events
  client.on("jobFailed", (originId, event: { job: Job; event: JobFailedEvent }) => {
    logger.error(`Job failed from ${originId}: ${event.job.id}`);
    
    try {
      // Update job status in the database
      db.update(job)
        .set({
          status: JobStatus.failed,
          finished_at: new Date()
        })
        .where(eq(job.id, event.job.id));
    } catch (error) {
      logger.error(`Failed to update failed job ${event.job.id} status: ${error}`);
    }
  });

  // Handle job started events
  client.on("jobStarted", (originId, event: { job: Job }) => {
    logger.info(`Job started from ${originId}: ${event.job.id}`);
    
    // Update running jobs state for the crawler
    if (crawlerStates[originId]) {
      crawlerStates[originId].runningJobs = crawlerStates[originId].runningJobs || [];
      crawlerStates[originId].runningJobs.push(event.job.id);
      crawlerStates[originId].lastActive = new Date();
    }
    
    try {
      // Update job status in the database
      db.update(job)
        .set({
          status: JobStatus.running,
          started_at: new Date()
        })
        .where(eq(job.id, event.job.id));
    } catch (error) {
      logger.error(`Failed to update started job ${event.job.id} status: ${error}`);
    }
  });

  // Handle job accepted events
  client.on("jobAccepted", (originId, event: { jobId: string }) => {
    logger.info(`Job accepted by ${originId}: ${event.jobId}`);
    
    // No database update needed, as the job will soon transition to started
  });

  // Handle job error events
  client.on("jobError", (originId, event: { jobId: string; error: string }) => {
    logger.error(`Job error from ${originId}: ${event.jobId} - ${event.error}`);
    
    try {
      // Update job status in the database
      db.update(job)
        .set({
          status: JobStatus.failed,
          finished_at: new Date()
        })
        .where(eq(job.id, event.jobId));
    } catch (error) {
      logger.error(`Failed to update error job ${event.jobId} status: ${error}`);
    }
  });

  // Handle queue statistics
  client.on("queueStats", (originId, stats) => {
    // Update queue stats in the crawler state
    if (crawlerStates[originId]) {
      crawlerStates[originId].queueStats = stats;
      crawlerStates[originId].lastActive = new Date();
    }
  });

  // Handle status responses
  client.on("status", (originId, status) => {
    logger.info(`Received status from ${originId}: ${status.state}`);
    
    // Update crawler state
    if (crawlerStates[originId]) {
      crawlerStates[originId].state = status.state;
      crawlerStates[originId].queueStats = status.queueStats;
      crawlerStates[originId].runningJobs = status.runningJobs;
      crawlerStates[originId].queuedJobs = status.queuedJobs;
      crawlerStates[originId].resourceCounts = status.resourceCounts;
      crawlerStates[originId].lastActive = new Date();
    } else {
      // New crawler we haven't seen before
      crawlerStates[originId] = {
        state: status.state,
        queueStats: status.queueStats,
        runningJobs: status.runningJobs,
        queuedJobs: status.queuedJobs,
        resourceCounts: status.resourceCounts,
        lastActive: new Date()
      };
    }
    
    // If the crawler is idle, process any queued jobs
    if (status.state === ProcessState.IDLE) {
      processQueuedJobs().catch(err => {
        logger.error(`Error processing queued jobs after status update: ${err}`);
      });
    }
  });

  // Handle heartbeats
  client.on("heartbeat", (originId) => {
    heartbeats[originId] = new Date();
    
    // Update lastActive timestamp for the crawler
    if (crawlerStates[originId]) {
      crawlerStates[originId].lastActive = new Date();
    }
  });

  // Handle state changes
  client.on("stateChange", (originId, newState, oldState) => {
    logger.info(`Process ${originId} changed state from ${oldState} to ${newState}`);
    
    // Update crawler state
    if (crawlerStates[originId]) {
      crawlerStates[originId].state = newState;
      crawlerStates[originId].lastActive = new Date();
    } else {
      crawlerStates[originId] = {
        state: newState,
        lastActive: new Date()
      };
    }
    
    // If the crawler is now idle, process any queued jobs
    if (newState === ProcessState.IDLE) {
      processQueuedJobs().catch(err => {
        logger.error(`Error processing queued jobs after state change: ${err}`);
      });
    }
  });

  // Connect to the supervisor only if it's available
  if (client.isSupervisorAvailable) {
    await client.connect();
    logger.info("Attempted to connect to the supervisor."); // Log attempt

    // Send GitLab authentication credentials to the supervisor for the crawler
    if (client.connected) { // Check if connection was successful
      logger.info("Connected to the supervisor.");
      try {
        logger.info("Sending GitLab authentication credentials to supervisor");
        Bun.sleepSync(125);

        const tokenproviders = Object.values(TokenProvider);
        client.broadcastMessage("auth_credentials", tokenproviders.map(x => buildAuthCredentials(x)));
        logger.info("Successfully sent GitLab credentials to supervisor");
      } catch (error) {
        logger.error(`Error sending credentials to supervisor: ${error}`);
      }
    } else {
      logger.warn("Supervisor client is available but not connected. Skipping credential send.");
    }
  } else {
    logger.warn("Supervisor not available. Skipping supervisor connection and credential send. Crawler functionalities will be disabled.");
  }

  // Set up a periodic check for queued jobs
  const jobCheckInterval = setInterval(() => {
    processQueuedJobs().catch(err => {
      logger.error(`Error in periodic job check: ${err}`);
    });
  }, 60000); // Every minute

  // Set up crawler state cleanup to remove stale crawlers
  const stateCleanupInterval = setInterval(() => {
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000; // 5 minutes
    
    Object.entries(crawlerStates).forEach(([id, state]) => {
      if (now - state.lastActive.getTime() > staleThreshold) {
        logger.info(`Removing stale crawler ${id} (last active: ${state.lastActive.toISOString()})`);
        delete crawlerStates[id];
      }
    });
  }, 10 * 60 * 1000); // Every 10 minutes

  // Handle process termination signals
  process.on("SIGINT", async () => {
    logger.info("Received SIGINT, shutting down gracefully");
    clearInterval(jobCheckInterval);
    clearInterval(stateCleanupInterval);
    client.disconnect();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    logger.info("Received SIGTERM, shutting down gracefully");
    clearInterval(jobCheckInterval);
    clearInterval(stateCleanupInterval);
    client.disconnect();
    process.exit(0);
  });
  
  return {
    client,
    processQueuedJobs,
    sendCrawlerConfig,
    pauseCrawler,
    resumeCrawler,
    stopCrawler
  };
}

/*
// Uncomment to auto-start the connector when imported
boot().catch(err => {
  console.error(`Error in connector: ${err}`);
  process.exit(1);
});
*/