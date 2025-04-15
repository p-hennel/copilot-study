import { dev } from "$app/environment";
import type {
  CrawlerConfig,
  Job,
  JobFailedEvent,
  JobResult
} from "$lib/../crawler";
import { JobType } from "$lib/../crawler";
import { SupervisorClient } from "$lib/../subvisor/client";
import { ProcessState } from "$lib/../subvisor/types";
import { CrawlCommand, JobStatus } from "$lib/types";
import { getLogger } from "@logtape/logtape";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { job } from "./db/base-schema";
import AppSettings from "./settings";

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
    [CrawlCommand.authorizationScope]: JobType.DISCOVER_GROUPS,
    [CrawlCommand.group]: JobType.GROUP_DETAILS,
    [CrawlCommand.project]: JobType.PROJECT_DETAILS,
    [CrawlCommand.commits]: JobType.PROJECT_BRANCHES,
    [CrawlCommand.mergeRequests]: JobType.PROJECT_MERGE_REQUESTS,
    [CrawlCommand.issues]: JobType.PROJECT_ISSUES,
    [CrawlCommand.vulnerabilities]: JobType.PROJECT_VULNERABILITIES,
    [CrawlCommand.pipelines]: JobType.PROJECT_PIPELINES,
    [CrawlCommand.timelogs]: JobType.PROJECT_DETAILS, // No direct mapping
    [CrawlCommand.users]: JobType.GROUP_MEMBERS,
    [CrawlCommand.workItems]: JobType.PROJECT_ISSUES, // No direct mapping
    [CrawlCommand.groupProjects]: JobType.GROUP_PROJECTS,
    [CrawlCommand.groupSubgroups]: JobType.DISCOVER_SUBGROUPS
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
      // Update job status in the database
      db.update(job)
        .set({
          status: event.result.success ? JobStatus.finished : JobStatus.failed,
          finished_at: new Date(),
          // Store any progress information
          progress: event.result.data?.progress || null
        })
        .where(eq(job.id, event.job.id));
      
      // Process any discovered jobs if configuration allows
      // Note: We'll check a flag that might be in settings or just default to true
      const autoEnqueueEnabled = true; // Default to true if not explicitly defined in settings
      
      if (event.result.discoveredJobs && event.result.discoveredJobs.length > 0 && autoEnqueueEnabled) {
        
        logger.info(`Processing ${event.result.discoveredJobs.length} discovered jobs from ${event.job.id}`);
        
        // Process each discovered job
        for (const discoveredJob of event.result.discoveredJobs) {
          try {
            // Convert to our DB job format and insert
            const newJob = {
              id: discoveredJob.id,
              command: mapJobTypeToCrawlCommand(discoveredJob.type as string),
              full_path: discoveredJob.resourcePath || String(discoveredJob.resourceId),
              accountId: (event.job as any).accountId || 'system', // Use parent job account ID or default to 'system'
              spawned_from: event.job.id,
              status: JobStatus.queued,
              created_at: new Date()
            };
            
            // Ensure accountId is always set
            if (newJob.accountId) {
              // Insert the discovered job
              await db.insert(job).values(newJob as any); // Use 'as any' to bypass type checking
            } else {
              logger.warn(`Cannot insert discovered job ${discoveredJob.id} without accountId`);
            }
          } catch (error) {
            logger.error(`Failed to insert discovered job ${discoveredJob.id}: ${error}`);
          }
        }
      }
    } catch (error) {
      logger.error(`Failed to update job ${event.job.id} status: ${error}`);
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

  // Connect to the supervisor
  await client.connect();
  logger.info("Connected to the supervisor");

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