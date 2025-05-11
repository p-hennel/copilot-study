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
const HEARTBEAT_TIMEOUT = 60000 // 60 seconds

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
  console.log("starting job:", params)
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


if (SUPERVISED) {
  // --- Setup Event Listeners for MessageBusClient ---
  if (messageBusClientInstance) {
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
    })

    messageBusClientInstance.on("error", (error) => {
      logger.error("MessageBusClient Error:", { error })
    })
  } else {
    logger.warn("MessageBusClient not initialized (not running under supervisor?). Crawler communication disabled.")
  }

  // Optional: Monitor heartbeat
  setInterval(() => {
    if (messageBusClientInstance && lastHeartbeat !== 0 && Date.now() - lastHeartbeat > HEARTBEAT_TIMEOUT) {
      logger.warn(
        `No heartbeat or status update received from crawler via supervisor in over ${HEARTBEAT_TIMEOUT / 1000} seconds. Communication might be stale.`
      )
    }
  }, HEARTBEAT_TIMEOUT / 2)

  // Boot the connector immediately to ensure credentials are sent to the supervisor
  // This is crucial for the crawler to start properly
  boot().then(() => {
    if (logger) {
      logger.info("Connector booted successfully - credentials will be sent to supervisor");
    } else {
      console.log("Connector booted successfully - credentials will be sent to supervisor");
    }
    
    // Force log output for debugging
    console.log("Website started and connector booted - credentials should be sent to supervisor");
  }).catch(err => {
    console.error(`Error in data processor: ${err}`);
    //process.exit(1);
  });
}