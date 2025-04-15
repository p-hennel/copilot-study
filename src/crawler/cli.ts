#!/usr/bin/env bun
import { getLogger } from "@logtape/logtape";
import { parseArgs } from "util";
import { v4 as uuidv4 } from "uuid";

// Import from subvisor for inter-process communication
import { SupervisorClient } from "../subvisor/client";
import { ProcessState } from "../subvisor/types";

// Import crawler components
import { GitLabCrawler } from "./gitlab-crawler";
import type { AuthConfig, CrawlerConfig } from "./types/config-types";
import { type Job, JOB_PRIORITIES, JobType } from "./types/job-types";
import { ensureDirectoryExists } from "./utils/filesystem";

// Initialize logger
const logger = getLogger(["gitlab-crawler"]);

// Type definition for configuration sent through the socket
// Omitting functions that cannot be serialized
type SerializableCrawlerConfig = Omit<CrawlerConfig, 
  'hooks' | 
  'includeResources.projectFilterFn' | 
  'includeResources.groupFilterFn' | 
  'auth.tokenRefreshCallback'
>;

// Type definition for a crawl job configuration received via the socket
interface CrawlJobConfig {
  // Unique identifier for the job
  id: string;
  
  // Job type from the JobType enum
  type: JobType;
  
  // Resource identifier (projectId, groupId, etc.)
  resourceId: string | number;
  
  // Optional resource path
  resourcePath?: string;
  
  // Optional additional data needed for the job
  data?: Record<string, any>;
  
  // Optional job-specific authentication
  auth?: AuthConfig;
  
  // Optional parent job ID
  parentJobId?: string;
}

const { values } = parseArgs({
  args: Bun.argv,
  options: {
    heartbeat: {
      type: "string",
      default: "5000"
    },
    outputDir: {
      type: "string",
      default: "./data"
    },
    gitlabUrl: {
      type: "string",
      default: "https://gitlab.com"
    },
    concurrency: {
      type: "string",
      default: "5"
    }
  },
  strict: true,
  allowPositionals: true
});

async function main() {
  logger.info("GitLab Crawler service starting up...");

  // Parse command line arguments
  const heartbeatInterval = parseInt(values.heartbeat) || 5000;
  const outputDir = values.outputDir;
  const gitlabUrl = values.gitlabUrl;
  const concurrency = parseInt(values.concurrency) || 5;

  // Ensure output directory exists
  try {
    ensureDirectoryExists(outputDir);
  } catch (error) {
    logger.error(`Failed to create output directory: ${error}`);
    process.exit(1);
  }

  // Create SupervisorClient for IPC
  const client = new SupervisorClient();
  
  // Create base crawler configuration
  // This will be overridden by specific configs when needed
  const baseConfig: CrawlerConfig = {
    gitlabUrl,
    outputDir,
    auth: {
      // Will be overridden by job-specific auth
      oauthToken: '',
    },
    requestsPerSecond: 10,
    concurrency,
    maxRetries: 3,
    retryDelayMs: 5000,
    hooks: {
      // These hooks will report back to the supervisor
      afterJobComplete: async (job, result) => {
        client.emit("jobCompleted", { job, result });
        await checkIdleOrBusy();
      },
      jobFailed: async (job, event) => {
        client.emit("jobFailed", { job, event });
        await checkIdleOrBusy();
      }
    }
  };

  // Initialize crawler instance
  let crawler = new GitLabCrawler(baseConfig);
  let lastState = ProcessState.STARTING;

  // Function to update process state
  const updateState = (newState: ProcessState) => {
    if (newState === lastState) return;
    lastState = newState;
    client.updateState(newState);
    logger.info(`State changed to: ${newState}`);
  };

  // Function to check if the crawler is idle or busy
  const checkIdleOrBusy = async () => {
    if (!crawler.isActive()) {
      updateState(ProcessState.STOPPED);
    } else {
      const stats = crawler.getQueueStats();
      const busy = Object.values(stats).some(({ queued, running }) => {
        return queued > 0 || running > 0;
      });
      updateState(busy ? ProcessState.BUSY : ProcessState.IDLE);
      
      // Send queue stats to supervisor for monitoring
      client.emit("queueStats", stats);
    }
  };

  // Handle connection to supervisor
  client.on("connected", () => {
    logger.info("Connected to supervisor");
    updateState(ProcessState.IDLE);
    client.emit("ready", { 
      service: "gitlab-crawler",
      capabilities: Object.values(JobType)
    });
  });

  // Handle disconnection from supervisor
  client.on("disconnected", () => {
    logger.warn("Disconnected from supervisor, will attempt to reconnect");
  });

  // Handle crawler configuration received via socket
  client.on("crawlerConfig", async (_originId, config?: SerializableCrawlerConfig) => {
    if (!config) {
      logger.warn("Received empty crawler configuration, ignoring");
      return;
    }
    
    logger.info("Received new crawler configuration");
    
    // Create a new crawler with the received configuration plus our hooks
    const newConfig: CrawlerConfig = {
      ...config,
      hooks: {
        afterJobComplete: async (job, result) => {
          client.emit("jobCompleted", { job, result });
          await checkIdleOrBusy();
        },
        jobFailed: async (job, event) => {
          client.emit("jobFailed", { job, event });
          await checkIdleOrBusy();
        }
      }
    };
    
    // Stop current crawler if it exists
    if (crawler && crawler.isActive()) {
      crawler.stop();
    }
    
    // Create new crawler with updated config
    crawler = new GitLabCrawler(newConfig);
    updateState(ProcessState.IDLE);
    
    logger.info("Crawler reconfigured successfully");
  });

  // Handle individual crawl jobs received via socket
  client.on("crawlJob", async (_originId, jobConfig: CrawlJobConfig) => {
    try {
      if (!crawler) {
        logger.error("Cannot process job: crawler not initialized");
        client.emit("jobError", {
          jobId: jobConfig.id,
          error: "Crawler not initialized"
        });
        return;
      }
      
      logger.info(`Received crawl job: ${jobConfig.id} (${jobConfig.type}) for resource ${jobConfig.resourceId}`);
      
      // Create a job from the received configuration
      const job: Job = {
        id: jobConfig.id || `${jobConfig.type}-${jobConfig.resourceId}-${uuidv4()}`,
        type: jobConfig.type,
        resourceId: jobConfig.resourceId,
        resourcePath: jobConfig.resourcePath,
        data: jobConfig.data,
        createdAt: new Date(),
        priority: JOB_PRIORITIES[jobConfig.type] || 0,
        retryCount: 0,
        parentJobId: jobConfig.parentJobId,
        auth: jobConfig.auth // Job-specific authentication
      };
      
      // Enqueue the job
      await crawler.enqueueJob(job);
      
      // Start the crawler if it's not already running
      if (!crawler.isActive()) {
        crawler.resume();
      }
      
      await checkIdleOrBusy();
      
      client.emit("jobAccepted", {
        jobId: job.id,
        timestamp: new Date()
      });
    } catch (error) {
      logger.error(`Failed to process job: ${error}`);
      client.emit("jobError", {
        jobId: jobConfig.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Handle pause command
  client.on("pause", () => {
    logger.info("Received pause command");
    if (crawler && crawler.isActive()) {
      crawler.pause();
      updateState(ProcessState.PAUSED);
    }
  });

  // Handle resume command
  client.on("resume", async () => {
    logger.info("Received resume command");
    if (crawler && !crawler.isActive()) {
      crawler.resume();
      await checkIdleOrBusy();
    }
  });

  // Handle stop command
  client.on("stop", () => {
    logger.info("Received stop command from supervisor");
    updateState(ProcessState.STOPPING);
    if (crawler) crawler.stop();

    // Clean up
    setTimeout(() => {
      client.disconnect();
      process.exit(0);
    }, 1000);
  });

  // Handle status request
  client.on("getStatus", () => {
    if (!crawler) {
      client.emit("status", {
        state: lastState,
        queueStats: {},
        isRunning: false,
        isPaused: false
      });
      return;
    }
    
    const state = crawler.getState();
    client.emit("status", {
      state: lastState,
      queueStats: crawler.getQueueStats(),
      isRunning: crawler.isActive(),
      isPaused: crawler.isPausedState(),
      runningJobs: state.runningJobs,
      queuedJobs: state.queuedJobs,
      resourceCounts: state.resourceCounts
    });
  });

  // Connect to the supervisor
  await client.connect();

  // Set up heartbeat interval
  if (heartbeatInterval > 0) {
    setInterval(() => {
      client.emit("heartbeat");
      checkIdleOrBusy().catch(err => {
        logger.error(`Error in heartbeat: ${err}`);
      });
    }, heartbeatInterval);
  }

  // Setup crawler event listeners for more detailed progress reporting
  crawler.on("JOB_STARTED", (event) => {
    client.emit("jobStarted", event);
  });

  // Keep process running
  process.stdin.resume();

  // Handle process termination signals
  process.on("SIGINT", async () => {
    logger.info("Received SIGINT, shutting down gracefully");
    updateState(ProcessState.STOPPING);
    if (crawler) crawler.stop();
    client.disconnect();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    logger.info("Received SIGTERM, shutting down gracefully");
    updateState(ProcessState.STOPPING);
    if (crawler) crawler.stop();
    client.disconnect();
    process.exit(0);
  });
  
  logger.info("GitLab Crawler service is running and waiting for jobs");
  updateState(ProcessState.IDLE);
}

main().catch((err) => {
  logger.error(`Fatal error in crawler service: ${err}`);
  process.exit(1);
});
