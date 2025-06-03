export const SUPERVISED = Bun.env.SUPERVISED === undefined || Bun.env.SUPERVISED === null ? false : (
  typeof Bun.env.SUPERVISED === "string" ? Bun.env.SUPERVISED.toLowerCase() === "true" : (Bun.env.SUPERVISED === 1 || Bun.env.SUPERVISED === true)
)

import { eq, sql } from "drizzle-orm"; // Import needed operators and sql for timestamps

// Import the MessageBusClient for Unix socket IPC
import messageBusClientInstance from "$lib/messaging/MessageBusClient"

// Crawler specific imports (keep as needed)
import { db, safeTimestamp } from "$lib/server/db"
import { job as jobSchema } from "$lib/server/db/schema"
import { JobStatus } from "$lib/types"
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["backend", "supervisor"])

/**
 * Reset all running jobs to queued status when crawler connection is lost
 */
async function resetRunningJobsOnDisconnect(): Promise<void> {
  try {
    logger.info("Supervisor detected connection loss - resetting running jobs to queued status");
    
    const result = await db
      .update(jobSchema)
      .set({
        status: JobStatus.queued,
        started_at: null // Reset start time since job will need to restart
      })
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
      // Use safe timestamp conversion
      updateData.finished_at = safeTimestamp(update.timestamp);
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
      columns: { resumeState: true, status: true }
    })

    if (jobRecord?.resumeState && typeof jobRecord.resumeState === "object") {
      existingProgress = jobRecord.resumeState as Record<string, JobDataTypeProgress>
      logger?.info(`✅ SUPERVISOR: Found existing progress for job ${params.jobId}. Resuming.`)
    } else {
      logger?.info(`🔄 SUPERVISOR: No existing progress found for job ${params.jobId}. Starting fresh.`)
    }

    // Update job status to running if it's not already
    if (jobRecord && jobRecord.status !== JobStatus.running) {
      await db.update(jobSchema)
        .set({
          status: JobStatus.running,
          started_at: sql`(unixepoch())`,
          updated_at: sql`(unixepoch())`
        })
        .where(eq(jobSchema.id, params.jobId));
      logger?.info(`🚀 SUPERVISOR: Updated job ${params.jobId} status to running`);
    }
  } catch (dbError) {
    logger?.error(`❌ SUPERVISOR: Error fetching/updating progress for job ${params.jobId}:`, {
      error: dbError instanceof Error ? dbError.message : String(dbError)
    })
  }

  // Create command with all required properties
  const command: CrawlerCommand = {
    type: "START_JOB",
    ...params,
    progress: existingProgress
  }
  
  const success = sendCommandToCrawler(command)
  if (!success) {
    logger?.warn(`⚠️ SUPERVISOR: Failed to send START_JOB command for job ${params.jobId} - job queued for retry when crawler reconnects`);
    
    // Mark job as queued for retry when connection is restored
    try {
      await db.update(jobSchema)
        .set({
          status: JobStatus.queued,
          progress: {
            ...existingProgress,
            pendingStart: true,
            lastStartAttempt: new Date().toISOString()
          }
        })
        .where(eq(jobSchema.id, params.jobId));
    } catch (updateError) {
      logger?.error(`❌ SUPERVISOR: Failed to mark job ${params.jobId} as queued for retry:`, { error: updateError });
    }
  }
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

// Global flag to prevent duplicate handler registration
let handlersRegistered = false;

if (SUPERVISED) {
  logger.debug("SUPERVISED is true, setting up event listeners...");
  // --- Setup Event Listeners for MessageBusClient ---
  if (messageBusClientInstance && !handlersRegistered) {
    logger.debug("MessageBusClient instance available, initializing event listeners...");
    logger.info("Initializing MessageBusClient event listeners...") // Logger is guaranteed here

    // 🚨 EMERGENCY FIX: Remove ALL existing listeners before registering new ones
    logger.debug("🚨 EMERGENCY: Removing all existing listeners to prevent duplicates");
    messageBusClientInstance.removeAllListeners();
    logger.debug("🚨 EMERGENCY: All listeners removed, proceeding with fresh registration");

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
    
    // 🔍 VALIDATION: Check for duplicate handler registration
    const existingListeners = messageBusClientInstance.listenerCount('tokenRefreshRequest');
    logger.debug("🔍 VALIDATION: Existing tokenRefreshRequest listeners before setup:", { count: existingListeners });
    
    // Only register if no handlers exist yet
    if (existingListeners === 0) {
      logger.debug("🔍 VALIDATION: Registering new token refresh handler (supervised mode)");
      
      messageBusClientInstance.onTokenRefreshRequest(async (requestData) => {
        logger.debug("🔍 VALIDATION: TOKEN REFRESH HANDLER TRIGGERED (supervised mode)");
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
        logger.debug("🔍 VALIDATION: Token refresh request details:", {
          requestId,
          providerId,
          accountId,
          userId,
          timestamp: Date.now()
        });
        
        const response = await fetch('http://localhost:3000/api/internal/refresh-token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-request-source': 'supervisor',
            'x-request-id': requestId
          },
          body: JSON.stringify({
            providerId,
            accountId,
            userId
          })
        });
        
        logger.debug("🔍 VALIDATION: Fetch response details:", {
          requestId,
          status: response.status,
          statusText: response.statusText,
          hasAuthHeader: response.headers.has('www-authenticate')
        });
        
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
    } else {
      logger.debug("🔍 VALIDATION: Skipping handler registration - handlers already exist");
    }
    
    // Mark handlers as registered to prevent duplicates
    handlersRegistered = true;
    logger.debug("Token refresh handler setup completed");

    // Listen for job requests from crawler
    messageBusClientInstance.onJobRequest(async (requestData) => {
      logger.debug("JOB REQUEST HANDLER TRIGGERED");
      logger.debug("Job request data:", { requestData });
      
      if (!messageBusClientInstance) {
        logger.error('MessageBusClient became null during job request processing');
        return;
      }

      try {
        // Use the existing job fetching logic from the /api/internal/jobs/open endpoint
        logger.debug('Fetching jobs via internal endpoint...');
        
        const response = await fetch('http://localhost:3000/api/internal/jobs/open', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'x-request-source': 'unix'
          }
        });

        if (response.ok) {
          const jobs = await response.json();
          
          // Check if response is an error object (new error handling format)
          if (jobs && typeof jobs === 'object' && 'error' in jobs) {
            logger.warn('Job fetching returned error response:', { errorResponse: jobs });
            
            // Send error response back to crawler
            if (messageBusClientInstance) {
              const errorJobs = jobs as { error: string; message?: string };
              messageBusClientInstance.sendJobErrorToCrawler(
                errorJobs.message || errorJobs.error || 'Job provisioning failed',
                requestData.requestId
              );
            }
            return;
          }
          
          logger.debug('Jobs fetched successfully via socket request:', {
            jobCount: Array.isArray(jobs) ? jobs.length : 0
          });
          
          // Send job response back to crawler
          if (messageBusClientInstance) {
            const jobsArray = Array.isArray(jobs) ? jobs : [];
            messageBusClientInstance.sendJobResponseToCrawler(jobsArray);
            logger.debug('Job response sent to crawler successfully');
          } else {
            logger.error('MessageBusClient became null when sending job response');
          }
        } else {
          const responseText = await response.text().catch(() => 'Unable to read response');
          logger.warn(`Job fetching failed with status ${response.status}: ${response.statusText}`, {
            responseBody: responseText
          });
          
          // Send error response back to crawler
          if (messageBusClientInstance) {
            messageBusClientInstance.sendJobErrorToCrawler(
              `Job fetching failed: ${response.status} ${response.statusText}`,
              requestData.requestId
            );
          }
        }
      } catch (error) {
        logger.error('Exception in job request processing:', { error });
        
        // Send error response back to crawler
        if (messageBusClientInstance) {
          messageBusClientInstance.sendJobErrorToCrawler(
            error instanceof Error ? error.message : 'Unknown error during job request',
            requestData.requestId
          );
        }
      }
    });
    
    logger.debug("Job request handler setup completed");

    // Listen for progress updates from crawler
    messageBusClientInstance.onProgressUpdate(async (progressData) => {
      logger.debug("PROGRESS UPDATE HANDLER TRIGGERED");
      logger.debug("Progress update data:", { progressData });
      
      if (!messageBusClientInstance) {
        logger.error('MessageBusClient became null during progress update processing');
        return;
      }

      try {
        // FIXED: Handle the crawler's actual payload structure
        // The crawler sends: { taskId, status, timestamp, [payload data] }
        const payload = {
          taskId: progressData.taskId,
          status: progressData.status || 'processing',
          timestamp: progressData.timestamp || new Date().toISOString(),
          ...progressData // Include all other fields from progressData
        };
        
        logger.debug('Processing progress update via internal endpoint...', { 
          taskId: payload.taskId, 
          status: payload.status,
          hasAreas: !!progressData.areas,
          areasCount: progressData.areas?.length
        });
        
        // Forward to internal progress API with correct payload structure
        const response = await fetch('http://localhost:3000/api/internal/jobs/progress', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-request-source': 'unix'
          },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          logger.debug('Progress update processed successfully via socket');
        } else {
          const errorText = await response.text();
          logger.warn(`Progress update failed with status ${response.status}: ${response.statusText}`, {
            error: errorText,
            payload: payload
          });
        }
      } catch (error) {
        logger.error('Exception in progress update processing:', { error });
      }
    });
    
    logger.debug("Progress update handler setup completed");
   } else {
    logger.debug("MessageBusClient not available in SUPERVISED=true branch");
    logger.warn("MessageBusClient not initialized (not running under supervisor?). Crawler communication disabled.")
  }
} else {
  logger.debug("SUPERVISED is false, but we still need to set up token refresh handlers!");
  logger.debug("Setting up event listeners anyway for token refresh support...");
  
  // Even if not supervised, we still need token refresh handlers for the crawler
  if (messageBusClientInstance && !handlersRegistered) {
    logger.debug("MessageBusClient available in non-supervised mode, setting up token refresh handler...");
    
    // 🚨 EMERGENCY FIX: Remove ALL existing listeners before registering new ones
    logger.debug("🚨 EMERGENCY: Removing all existing listeners (non-supervised mode)");
    messageBusClientInstance.removeAllListeners();
    logger.debug("🚨 EMERGENCY: All listeners removed, proceeding with fresh registration (non-supervised mode)");
    
    // � VALIDATION: Check for duplicate handler registration in non-supervised mode
    const existingListenersNonSup = messageBusClientInstance.listenerCount('tokenRefreshRequest');
    logger.debug("🔍 VALIDATION: Existing tokenRefreshRequest listeners after cleanup:", { count: existingListenersNonSup });
    
    // Register handlers after cleanup
    logger.debug("🔍 VALIDATION: Registering new token refresh handler (non-supervised mode)");
      
      // Set up minimal event listeners including token refresh
      messageBusClientInstance.onTokenRefreshRequest(async (requestData) => {
      logger.debug("🔍 VALIDATION: TOKEN REFRESH HANDLER TRIGGERED (non-supervised mode)");
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
        logger.debug("🔍 VALIDATION (non-supervised): Token refresh request details:", {
          requestId,
          providerId,
          accountId,
          userId,
          timestamp: Date.now()
        });
        
        const response = await fetch('http://localhost:3000/api/internal/refresh-token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-request-source': 'supervisor-non-supervised',
            'x-request-id': requestId
          },
          body: JSON.stringify({
            providerId,
            accountId,
            userId
          })
        });
        
        logger.debug("🔍 VALIDATION (non-supervised): Fetch response details:", {
          requestId,
          status: response.status,
          statusText: response.statusText,
          hasAuthHeader: response.headers.has('www-authenticate')
        });
        
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
    
    // Mark handlers as registered
    handlersRegistered = true;
    logger.debug("Token refresh handler setup completed (non-supervised mode)");

    // Listen for job requests from crawler (non-supervised mode)
    if (messageBusClientInstance) {
      messageBusClientInstance.onJobRequest(async (requestData) => {
      logger.debug("JOB REQUEST HANDLER TRIGGERED (non-supervised mode)");
      logger.debug("Job request data:", { requestData });
      
      if (!messageBusClientInstance) {
        logger.error('MessageBusClient became null during job request processing');
        return;
      }

      try {
        // Use the existing job fetching logic from the /api/internal/jobs/open endpoint
        logger.debug('Fetching jobs via internal endpoint...');
        
        const response = await fetch('http://localhost:3000/api/internal/jobs/open', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'x-request-source': 'unix'
          }
        });

        if (response.ok) {
          const jobs = await response.json();
          logger.debug('Jobs fetched successfully via socket request:', {
            jobCount: Array.isArray(jobs) ? jobs.length : 0
          });
          
          // Send job response back to crawler
          if (messageBusClientInstance) {
            const jobsArray = Array.isArray(jobs) ? jobs : [];
            messageBusClientInstance.sendJobResponseToCrawler(jobsArray);
            logger.debug('Job response sent to crawler successfully');
          } else {
            logger.error('MessageBusClient became null when sending job response');
          }
        } else {
          logger.warn(`Job fetching failed with status ${response.status}: ${response.statusText}`);
          
          // Send error response back to crawler
          if (messageBusClientInstance) {
            messageBusClientInstance.sendJobErrorToCrawler(
              `Job fetching failed: ${response.status} ${response.statusText}`,
              requestData.requestId
            );
          }
        }
      } catch (error) {
        logger.error('Exception in job request processing:', { error });
        
        // Send error response back to crawler
        if (messageBusClientInstance) {
          messageBusClientInstance.sendJobErrorToCrawler(
            error instanceof Error ? error.message : 'Unknown error during job request',
            requestData.requestId
          );
        }
      }
    });
    
    logger.debug("Job request handler setup completed (non-supervised mode)");

    // Listen for progress updates from crawler (non-supervised mode)
    messageBusClientInstance.onProgressUpdate(async (progressData) => {
      logger.debug("PROGRESS UPDATE HANDLER TRIGGERED (non-supervised mode)");
      logger.debug("Progress update data:", { progressData });
      
      if (!messageBusClientInstance) {
        logger.error('MessageBusClient became null during progress update processing');
        return;
      }

      try {
        // FIXED: Handle the crawler's actual payload structure
        // The crawler sends: { taskId, status, timestamp, [payload data] }
        const payload = {
          taskId: progressData.taskId,
          status: progressData.status || 'processing',
          timestamp: progressData.timestamp || new Date().toISOString(),
          ...progressData // Include all other fields from progressData
        };
        
        logger.debug('Processing progress update via internal endpoint...', { 
          taskId: payload.taskId, 
          status: payload.status,
          hasAreas: !!progressData.areas,
          areasCount: progressData.areas?.length
        });
        
        // Forward to internal progress API with correct payload structure
        const response = await fetch('http://localhost:3000/api/internal/jobs/progress', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-request-source': 'unix'
          },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          logger.debug('Progress update processed successfully via socket');
        } else {
          const errorText = await response.text();
          logger.warn(`Progress update failed with status ${response.status}: ${response.statusText}`, {
            error: errorText,
            payload: payload
          });
        }
      } catch (error) {
        logger.error('Exception in progress update processing:', { error });
      }
    });
    
    logger.debug("Progress update handler setup completed (non-supervised mode)");
    }
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
}