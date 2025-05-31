#!/usr/bin/env bun
/**
 * Mock GitLab crawler that provides a basic interface for demonstrating supervisor functionality
 * without requiring GitLab credentials or access
 */

import { getLogger } from "@logtape/logtape";
import { parseArgs } from "util";
import { v4 as uuidv4 } from "uuid";
import { SupervisorClient } from "../subvisor/client";
import { ProcessState } from "../subvisor/types";

// Initialize logger
const logger = getLogger(["gitlab-crawler"]);

// Parse command line arguments
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
    }
  },
  strict: true,
  allowPositionals: true
});

// Mock job queue
const jobQueue = new Map();
let isActive = false;
let isPaused = false;

async function main() {
  logger.info("Mock GitLab Crawler service starting up...");

  // Parse command line arguments
  const heartbeatInterval = parseInt(values.heartbeat) || 5000;

  // Create SupervisorClient for IPC
  const client = new SupervisorClient();
  
  // Job statistics
  const stats = {
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0
  };

  let lastState = ProcessState.STARTING;

  // Function to update process state
  const updateState = (newState: ProcessState) => {
    if (newState === lastState) return;
    lastState = newState;
    client.updateState(newState);
    logger.info(`State changed to: ${newState}`);
  };

  // Check if crawler is idle or busy
  const checkIdleOrBusy = async () => {
    if (!isActive) {
      updateState(ProcessState.STOPPED);
    } else {
      const busy = stats.running > 0 || stats.queued > 0;
      updateState(busy ? ProcessState.BUSY : ProcessState.IDLE);
      
      // Send queue stats to supervisor for monitoring
      client.emit("queueStats", { 
        totalQueued: stats.queued,
        totalRunning: stats.running
      });
    }
  };

  // Handle connection to supervisor
  client.on("connected", () => {
    logger.info("Connected to supervisor");
    isActive = true;
    updateState(ProcessState.STARTING);
    
    // Emit an immediate ready signal for better visibility
    // The final ready signal will be emitted after auth credentials are received
    client.emit("initializing", { 
      service: "gitlab-crawler",
      status: "Waiting for authentication credentials"
    });
    
    // Log progress for debugging
    logger.info("Crawler connected to supervisor and waiting for auth credentials");
  });

  // Handle disconnection from supervisor
  client.on("disconnected", () => {
    logger.warn("Disconnected from supervisor, will attempt to reconnect");
  });

  // Handle auth credentials received via socket
  client.on("auth_credentials", (_originId, credentials: any) => {
    if (!credentials || typeof credentials !== 'object') {
      logger.warn("Received invalid authentication credentials format");
      return;
    }
    
    logger.info("Received authentication credentials from supervisor");
    
    // Log the token for debugging (don't show full token)
    const tokenStart = credentials.token ? credentials.token.substring(0, 3) : "none";
    logger.info(`Got token starting with: ${tokenStart}***`);
    
    // Immediately notify that we're ready after receiving credentials
    // This helps make sure the supervisor knows we're operational
    setTimeout(() => {
      client.emit("ready", { 
        service: "gitlab-crawler",
        capabilities: ["DISCOVER_GROUPS", "PROJECT_DETAILS", "GROUP_MEMBERS"]
      });
      updateState(ProcessState.IDLE);
    }, 500); // Short delay to ensure processing
  });

  // Handle individual crawl jobs received via socket
  client.on("crawlJob", async (_originId, jobConfig: any) => {
    try {
      logger.info(`Received crawl job: ${jobConfig.id} for resource ${jobConfig.resourceId}`);
      
      // Add job to queue
      jobQueue.set(jobConfig.id, jobConfig);
      stats.queued++;
      
      // Notify that job was accepted
      client.emit("jobAccepted", {
        jobId: jobConfig.id,
        timestamp: new Date()
      });
      
      // Update state
      await checkIdleOrBusy();
      
      // Simulate job processing
      setTimeout(() => processJob(jobConfig.id), 2000);
    } catch (error) {
      logger.error(`Failed to process job: ${error}`);
      client.emit("jobError", {
        jobId: jobConfig.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Process a job (mock implementation)
  async function processJob(jobId: string) {
    const job = jobQueue.get(jobId);
    if (!job) return;
    
    // Remove from queue
    jobQueue.delete(jobId);
    stats.queued--;
    stats.running++;
    
    // Notify that job started
    client.emit("jobStarted", { job });
    
    // Simulate job processing
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Simulate job completion
    stats.running--;
    stats.completed++;
    
    client.emit("jobCompleted", { 
      job,
      result: {
        success: true,
        data: {
          // Mock result data
          resourceId: "mock-resource",
          timestamp: new Date(),
          items: 5,
          progress: 100
        }
      }
    });
    
    // Generate some mock discovered jobs
    const discoveredJobs = [];
    for (let i = 0; i < 2; i++) {
      discoveredJobs.push({
        id: `child-${uuidv4()}`,
        type: "GROUP_MEMBERS",
        resourceId: `mock-resource-${i}`,
        resourcePath: `mock/resource/path-${i}`,
        createdAt: new Date(),
        priority: 1,
        retryCount: 0,
        parentJobId: jobId
      });
    }
    
    client.emit("discoveredJobs", {
      jobs: discoveredJobs,
      timestamp: Date.now()
    });
    
    // Update state
    await checkIdleOrBusy();
  }

  // Handle pause command
  client.on("pause", () => {
    logger.info("Received pause command");
    isPaused = true;
    updateState(ProcessState.PAUSED);
  });

  // Handle resume command
  client.on("resume", async () => {
    logger.info("Received resume command");
    isPaused = false;
    isActive = true;
    await checkIdleOrBusy();
  });

  // Handle stop command
  client.on("stop", () => {
    logger.info("Received stop command from supervisor");
    updateState(ProcessState.STOPPING);
    isActive = false;

    // Clean up
    setTimeout(() => {
      client.disconnect();
      process.exit(0);
    }, 1000);
  });

  // Handle status request
  client.on("getStatus", () => {
    client.emit("status", {
      state: lastState,
      queueStats: {
        queued: stats.queued,
        running: stats.running,
        completed: stats.completed,
        failed: stats.failed
      },
      isRunning: isActive,
      isPaused
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

  // Keep process running
  process.stdin.resume();

  // Handle process termination signals
  process.on("SIGINT", async () => {
    logger.info("Received SIGINT, shutting down gracefully");
    updateState(ProcessState.STOPPING);
    client.disconnect();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    logger.info("Received SIGTERM, shutting down gracefully");
    updateState(ProcessState.STOPPING);
    client.disconnect();
    process.exit(0);
  });
  
  logger.info("Mock GitLab Crawler service is running and waiting for jobs");
  updateState(ProcessState.IDLE);
}

main().catch((err) => {
  logger.error(`Fatal error in crawler service: ${err}`);
  process.exit(1);
});
