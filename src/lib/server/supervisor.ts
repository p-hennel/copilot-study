export const SUPERVISED = Bun.env.SUPERVISED === undefined || Bun.env.SUPERVISED === null ? false : (
  typeof Bun.env.SUPERVISED === "string" ? Bun.env.SUPERVISED.toLowerCase() === "true" : (Bun.env.SUPERVISED === 1 || Bun.env.SUPERVISED === true)
)

import { eq } from "drizzle-orm"; // Import needed operators

// Import the MessageBusClient for Unix socket IPC
import messageBusClientInstance from "$lib/messaging/MessageBusClient"

// Crawler specific imports (keep as needed)
import { db } from "$lib/server/db"
import { job as jobSchema } from "$lib/server/db/schema"
import { JobStatus } from "$lib/types"
// eq is already imported above
import { boot } from "$lib/server/connector"
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["backend", "supervisor"])

/**
 * Reset all running jobs to queued status when crawler connection is lost
 */
async function resetRunningJobsOnDisconnect(): Promise<void> {
  try {
    logger.info("Supervisor detected connection loss - resetting running jobs to queued status");
    
    // Log the values being set to diagnose the TypeError
    const updateValues = {
      status: JobStatus.queued,
      started_at: undefined // Use undefined instead of null for Drizzle timestamp fields
    };
    logger.debug("Setting job update values:", { updateValues });
    
    const result = await db
      .update(jobSchema)
      .set(updateValues)
      .where(eq(jobSchema.status, JobStatus.running));
    
    if (result.rowsAffected > 0) {
      logger.info(`Successfully reset ${result.rowsAffected} running jobs to queued status`);
    } else {
      logger.info("No running jobs found to reset");
    }
  } catch (error) {
    logger.error("Failed to reset running jobs to queued status:", { error });
  }
}

// Define crawler-related types
interface JobCompletionUpdate {
  jobId: string;
  status: 'completed' | 'failed' | 'paused';
  timestamp: number;
  error?: string;
  progress?: any;
}

interface CrawlerCommand {
  type: string;
  [key: string]: any;
}

interface CrawlerStatus {
  running: boolean;
  paused: boolean;
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  lastHeartbeat?: number;
  lastUpdated?: number;
}

interface JobDataTypeProgress {
  cursor?: string;
  page?: number;
  processed?: number;
  total?: number;
  [key: string]: any;
}

interface StartJobCommand extends CrawlerCommand {
  type: 'START_JOB';
  jobId: string;
  fullPath: string;
  command: string;
  branch?: string;
  from?: Date;
  to?: Date;
  progress?: Record<string, JobDataTypeProgress>;
}

// --- State Variables ---
// These are now defined after potential logger initialization
let lastHeartbeat: number = 0
let currentCrawlerStatus: CrawlerStatus | null = null
const HEARTBEAT_TIMEOUT = 30000 // 30 seconds - matches cache and MessageBusClient timeout

// --- Helper Functions ---
// Defined after potential logger initialization

/**
 * Handles detailed job updates (completed, failed, paused) received via IPC. Updates the database.
 */
async function handleJobUpdate(update: JobCompletionUpdate) {
  // Use logger safely with optional chaining, in case initialization failed
  logger?.info(`Handling job update for ${update.jobId}`, { status: update.status })

  let dbStatus: JobStatus
  switch (update.status) {
    case "completed":
      dbStatus = JobStatus.finished
      break
    case "failed":
      dbStatus = JobStatus.failed
      break
    case "paused":
      dbStatus = JobStatus.paused
      break
    default: {
      logger?.error(`Invalid status received in jobUpdate: ${update.status}`)
      return
    }
  }

  try {
    const updateData: Partial<typeof jobSchema.$inferInsert> = {
      status: dbStatus,
      resumeState: update.progress ?? null
    }

    if (update.status === "completed" || update.status === "failed") {
      updateData.finished_at = new Date(update.timestamp)
      if (update.status === "completed") {
        updateData.resumeState = null
      }
    }
    if (update.status === "failed" && update.error) {
      logger?.error(`Job ${update.jobId} failed`, { error: update.error })
    }

    const result = await db.update(jobSchema).set(updateData).where(eq(jobSchema.id, update.jobId))

    if (result.rowsAffected === 0) {
      logger?.warn(`DB update for job ${update.jobId} (status: ${dbStatus}) affected 0 rows.`)
    } else {
      logger?.info(`Successfully updated job ${update.jobId} status to ${dbStatus} in DB.`)
    }
  } catch (error) {
    logger?.error(`Failed to update DB for job ${update.jobId} (status: ${dbStatus}):`, { error })
  }
}

/**
 * Sends a command to the crawler process via the MessageBusClient (stdin/stdout).
 */
export function sendCommandToCrawler(command: CrawlerCommand): boolean {
  if (!SUPERVISED) {
    logger?.debug("Not supervised, cannot send command to crawler", { command })
    return false
  }
  if (!messageBusClientInstance) {
    logger?.error("Cannot send command: MessageBusClient not available (not running under supervisor?).", { command })
    return false
  }

  try {
    logger?.info(`Sending command to crawler via MessageBusClient: ${command.type}`, { command })
    messageBusClientInstance.sendCommandToCrawler(command)
    return true
  } catch (error) {
    logger?.error("Failed to send command to crawler via MessageBusClient:", { error, command })
    return false
  }
}

export async function startJob(params: Omit<StartJobCommand, "type" | "progress">) {
  let existingProgress: Record<string, JobDataTypeProgress> | undefined = undefined
  try {
    const jobRecord = await db.query.job.findFirst({
      where: eq(jobSchema.id, params.jobId),
      columns: { resumeState: true }
    })

    if (jobRecord?.resumeState && typeof jobRecord.resumeState === "object") {
      existingProgress = jobRecord.resumeState as Record<string, JobDataTypeProgress>
      logger?.info(`Found existing progress for job ${params.jobId}. Resuming.`)
    } else {
      logger?.info(`No existing progress found for job ${params.jobId}. Starting fresh.`)
    }
  } catch (dbError) {
    logger?.error(`Error fetching progress for job ${params.jobId} from DB:`, { error: dbError })
  }

  // Create command with all required properties
  const command: CrawlerCommand = {
    type: "START_JOB",
    ...params,
    progress: existingProgress
  }
  sendCommandToCrawler(command)
}

export function pauseCrawler() {
  sendCommandToCrawler({ type: "PAUSE_CRAWLER" })
}

export function resumeCrawler() {
  sendCommandToCrawler({ type: "RESUME_CRAWLER" })
}

/**
 * Returns the last known status received from the crawler.
 * @returns {CrawlerStatus | null} The crawler status object or null if no status received or disconnected.
 */
export function getCrawlerStatus(): CrawlerStatus | null {
  return currentCrawlerStatus
}

export function getLastHeartbeat(): number {
  return lastHeartbeat
}


logger.debug("SUPERVISED value:", { supervised: SUPERVISED });
logger.debug("messageBusClientInstance available:", { available: !!messageBusClientInstance });

if (SUPERVISED) {
  logger.debug("SUPERVISED is true, setting up event listeners...");
  // --- Setup Event Listeners for MessageBusClient ---
  if (messageBusClientInstance) {
    logger.debug("MessageBusClient instance available, initializing event listeners...");
    logger.info("Initializing MessageBusClient event listeners...") // Logger is guaranteed here

    messageBusClientInstance.onStatusUpdate((status) => {
      currentCrawlerStatus = status
      lastHeartbeat = status.lastHeartbeat || Date.now()
    })

    messageBusClientInstance.onJobUpdate((update) => {
      handleJobUpdate(update)
    })

    messageBusClientInstance.onHeartbeat((payload: unknown) => {
      if (
        typeof payload === "object" &&
        payload !== null &&
        "timestamp" in payload &&
        typeof payload.timestamp === "number"
      ) {
        lastHeartbeat = payload.timestamp
      } else {
        logger.warn("Received heartbeat with invalid or missing timestamp:", { payload })
        lastHeartbeat = Date.now()
      }
    })

    messageBusClientInstance.onShutdown((signal) => {
      logger.warn(`Received shutdown signal (${signal || "unknown"}) via IPC. Backend should terminate gracefully.`)
      currentCrawlerStatus = null
    })

    messageBusClientInstance.onDisconnected(() => {
      logger.warn(`IPC connection to supervisor lost (stdin closed or errored).`)
      currentCrawlerStatus = null
      lastHeartbeat = 0
      
      // Reset running jobs to queued when connection is lost
      resetRunningJobsOnDisconnect();
    })

    messageBusClientInstance.on("error", (error) => {
      logger.error("MessageBusClient Error:", { error })
    })

    // Listen for token refresh requests
    logger.info("Setting up token refresh request handler...");
    logger.debug("MessageBusClient instance available:", { available: !!messageBusClientInstance });
    
    // Test if event listener is working
    messageBusClientInstance.on('tokenRefreshRequest', (data) => {
      logger.debug("tokenRefreshRequest event fired in supervisor", { data });
    });
    
    messageBusClientInstance.onTokenRefreshRequest(async (requestData) => {
      logger.debug("TOKEN REFRESH HANDLER TRIGGERED");
      logger.debug("Handler received data:", { requestData });
      logger.info("Received token refresh request via MessageBus", { requestData });
      logger.info("Processing token refresh request:", { requestData });
      
      if (!messageBusClientInstance) {
        logger.error('MessageBusClient became null during token refresh processing');
        return;
      }
      
      try {
        const { requestId, providerId, accountId, userId } = requestData;
        logger.debug("Extracted request parameters:", { requestId, providerId, accountId, userId });
        
        // Call our internal token refresh API
        logger.debug("Making fetch request to localhost:3000/api/internal/refresh-token");
        const response = await fetch('http://localhost:3000/api/internal/refresh-token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            providerId,
            accountId,
            userId
          })
        });
        
        logger.debug("Fetch response status:", { status: response.status, statusText: response.statusText });
        
        if (response.ok) {
          const tokenData = await response.json() as {
            success?: boolean;
            accessToken?: string;
            expiresAt?: string;
            refreshToken?: string;
            providerId?: string;
          };
          logger.debug('Token refresh successful', { tokenData });
          logger.debug('Sending response to crawler', { requestId });
          
          // Send successful response back to crawler
          if (messageBusClientInstance) {
            messageBusClientInstance.sendTokenRefreshResponse(requestId, {
              success: true,
              accessToken: tokenData.accessToken,
              expiresAt: tokenData.expiresAt,
              refreshToken: tokenData.refreshToken,
              providerId: tokenData.providerId
            });
            logger.debug('Response sent to crawler successfully');
          } else {
            logger.error('MessageBusClient became null when sending response');
          }
        } else {
          logger.debug("Fetch response not OK, reading error data...");
          const errorData = await response.json() as {
            error?: string;
          };
          logger.error('Token refresh failed with error data:', { errorData });
          
          // Send error response back to crawler
          if (messageBusClientInstance) {
            logger.debug('Sending error response to crawler');
            messageBusClientInstance.sendTokenRefreshResponse(requestId, {
              success: false,
              error: errorData.error || 'Token refresh failed'
            });
            logger.debug('Error response sent to crawler');
          }
        }
      } catch (error) {
        logger.error('Exception in token refresh processing:', { error });
        
        // Send error response back to crawler
        if (messageBusClientInstance) {
          logger.debug('Sending exception error response to crawler');
          messageBusClientInstance.sendTokenRefreshResponse(requestData.requestId, {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error during token refresh'
          });
          logger.debug('Exception error response sent to crawler');
        }
      }
    });
    
    logger.debug("Token refresh handler setup completed");
  } else {
    logger.debug("MessageBusClient not available in SUPERVISED=true branch");
    logger.warn("MessageBusClient not initialized (not running under supervisor?). Crawler communication disabled.")
  }
} else {
  logger.debug("SUPERVISED is false, but we still need to set up token refresh handlers!");
  logger.debug("Setting up event listeners anyway for token refresh support...");
  
  // Even if not supervised, we still need token refresh handlers for the crawler
  if (messageBusClientInstance) {
    logger.debug("MessageBusClient available in non-supervised mode, setting up token refresh handler...");
    
    // Set up minimal event listeners including token refresh
    messageBusClientInstance.onTokenRefreshRequest(async (requestData) => {
      logger.debug("TOKEN REFRESH HANDLER TRIGGERED (non-supervised mode)");
      logger.debug("Handler received data:", { requestData });
      
      if (!messageBusClientInstance) {
        logger.error('MessageBusClient became null during token refresh processing');
        return;
      }
      
      try {
        const { requestId, providerId, accountId, userId } = requestData;
        logger.debug("Extracted request parameters:", { requestId, providerId, accountId, userId });
        
        // Call our internal token refresh API
        logger.debug("Making fetch request to localhost:3000/api/internal/refresh-token");
        const response = await fetch('http://localhost:3000/api/internal/refresh-token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            providerId,
            accountId,
            userId
          })
        });
        
        logger.debug("Fetch response status:", { status: response.status, statusText: response.statusText });
        
        if (response.ok) {
          const tokenData = await response.json() as {
            success?: boolean;
            accessToken?: string;
            expiresAt?: string;
            refreshToken?: string;
            providerId?: string;
          };
          logger.debug('Token refresh successful', { tokenData });
          logger.debug('Sending response to crawler', { requestId });
          
          // Send successful response back to crawler
          if (messageBusClientInstance) {
            messageBusClientInstance.sendTokenRefreshResponse(requestId, {
              success: true,
              accessToken: tokenData.accessToken,
              expiresAt: tokenData.expiresAt,
              refreshToken: tokenData.refreshToken,
              providerId: tokenData.providerId
            });
            logger.debug('Response sent to crawler successfully');
          } else {
            logger.error('MessageBusClient became null when sending response');
          }
        } else {
          logger.debug("Fetch response not OK, reading error data...");
          const errorData = await response.json() as {
            error?: string;
          };
          logger.error('Token refresh failed with error data:', { errorData });
          
          // Send error response back to crawler
          if (messageBusClientInstance) {
            logger.debug('Sending error response to crawler');
            messageBusClientInstance.sendTokenRefreshResponse(requestId, {
              success: false,
              error: errorData.error || 'Token refresh failed'
            });
            logger.debug('Error response sent to crawler');
          }
        }
      } catch (error) {
        logger.error('Exception in token refresh processing:', { error });
        
        // Send error response back to crawler
        if (messageBusClientInstance) {
          logger.debug('Sending exception error response to crawler');
          messageBusClientInstance.sendTokenRefreshResponse(requestData.requestId, {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error during token refresh'
          });
          logger.debug('Exception error response sent to crawler');
        }
      }
    });
    
    logger.debug("Token refresh handler setup completed (non-supervised mode)");
  } else {
    logger.debug("MessageBusClient not available in non-supervised mode either");
  }

  // Monitor heartbeat and reset jobs if connection is stale
  setInterval(() => {
    if (messageBusClientInstance && lastHeartbeat !== 0 && Date.now() - lastHeartbeat > HEARTBEAT_TIMEOUT) {
      logger.warn(
        `No heartbeat or status update received from crawler via supervisor in over ${HEARTBEAT_TIMEOUT / 1000} seconds. Communication might be stale.`
      )
      
      // Reset running jobs if heartbeat timeout indicates lost connection
      if (Date.now() - lastHeartbeat > HEARTBEAT_TIMEOUT * 2) { // Wait 2x timeout before resetting jobs
        logger.warn("Extended heartbeat timeout detected - resetting running jobs to queued");
        resetRunningJobsOnDisconnect();
        lastHeartbeat = 0; // Reset to prevent repeated calls
      }
    }
  }, 10000) // Check every 10 seconds for more responsive timeout detection

  // Boot the connector immediately to ensure credentials are sent to the supervisor
  // This is crucial for the crawler to start properly
  boot().then(() => {
    logger.info("Connector booted successfully - credentials will be sent to supervisor");
    
    // Force log output for debugging
    logger.info("Website started and connector booted - credentials should be sent to supervisor");
  }).catch(err => {
    logger.error(`Error in data processor:`, { error: err });
    //process.exit(1);
  });
}