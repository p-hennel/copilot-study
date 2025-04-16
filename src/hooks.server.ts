import { auth } from "$lib/auth"
import { paraglideMiddleware } from "$lib/paraglide/server"
import type { Handle } from "@sveltejs/kit"
import { sequence } from "@sveltejs/kit/hooks"
import { svelteKitHandler } from "better-auth/svelte-kit"
// Removed socket.io and HTTP-based imports

// Import AppSettings and initialize early
import { getDb } from "$lib/server/db"; // Import getDb
import { user as userSchema } from "$lib/server/db/schema"; // Import user schema
import AppSettings, { type Settings } from "$lib/server/settings"
import { and, eq, inArray, isNull, not, or } from "drizzle-orm"; // Import needed operators

// Import logtape helpers
import { configureLogging } from "$lib/logging"
import type { Logger } from "@logtape/logtape"

let settings: Settings | null = null
let logger: Logger | null = null // Initialize logger to null

import doMigration from '$lib/server/db/migration'

// --- Top-Level Async Initialization ---
// SvelteKit supports top-level await in hooks.server.ts
try {
  // Assign the configured logger instance

  const bunHomeData = path.join("/home/bun/data/logs")
  logger = await configureLogging("backend", existsSync(bunHomeData) ? bunHomeData : process.cwd())
  logger?.info("Logging configured for backend.") // Use optional chaining
  logger?.info("AppSettings initialized successfully.") // Use optional chaining

  settings = AppSettings() // Ensure settings are loaded on server start
  console.error(settings.auth.providers.gitlab.discoveryUrl)
  if (settings.baseUrl) {
    logger = await configureLogging("backend", settings.baseUrl)
    logger?.info("Logging reconfigured for backend.") // Use optional chaining
    logger?.info("AppSettings reinitialized successfully.") // Use optional chaining
  }
  doMigration(settings.paths.database)

  // --- Admin Role Synchronization ---
  const syncAdminRoles = async () => {
    // Use optional chaining within this function as well
    logger?.info("Synchronizing admin roles...")
    if (!settings?.auth?.admins) {
      logger?.warn("No admin emails defined in settings. Skipping admin sync.")
      return
    }

    const adminEmails = settings.auth.admins.map((admin) => admin.email).filter(Boolean)

    if (adminEmails.length === 0) {
      logger?.info("Settings contain an empty admin list. Demoting all current admins.")
    } else {
      logger?.info("Admin emails from settings:", { adminEmails })
    }

    const db = getDb()

    try {
      logger?.info(`[AdminSync] Starting sync.`, { adminEmails })

      // 1. Find users to demote
      logger?.info("[AdminSync] Querying for users to demote...")
      const usersToDemote = await db
        .select({ id: userSchema.id, email: userSchema.email })
        .from(userSchema)
        .where(
          and(
            eq(userSchema.role, "admin"),
            adminEmails.length > 0 ? not(inArray(userSchema.email, adminEmails)) : undefined
          )
        )

      if (usersToDemote.length > 0) {
        const emailsToDemote = usersToDemote.map((u) => u.email)
        const idsToDemote = usersToDemote.map((u) => u.id)
        logger?.info(`[AdminSync] Found ${usersToDemote.length} users to demote`, { emailsToDemote })
        try {
          await db.update(userSchema).set({ role: null }).where(inArray(userSchema.id, idsToDemote))
          logger?.info(`[AdminSync] Successfully demoted ${usersToDemote.length} users.`)
        } catch (updateError) {
          logger?.error(`[AdminSync] Error demoting users`, { emailsToDemote, error: updateError })
        }
      } else {
        logger?.info("[AdminSync] No users found to demote.")
      }

      // 2. Find users to promote
      if (adminEmails.length > 0) {
        logger?.info("[AdminSync] Querying for users to promote...")
        const usersToPromote = await db
          .select({ id: userSchema.id, email: userSchema.email })
          .from(userSchema)
          .where(
            and(inArray(userSchema.email, adminEmails), or(not(eq(userSchema.role, "admin")), isNull(userSchema.role)))
          )

        if (usersToPromote.length > 0) {
          const emailsToPromote = usersToPromote.map((u) => u.email)
          const idsToPromote = usersToPromote.map((u) => u.id)
          logger?.info(`[AdminSync] Found ${usersToPromote.length} users to promote`, { emailsToPromote })
          try {
            await db.update(userSchema).set({ role: "admin" }).where(inArray(userSchema.id, idsToPromote))
            logger?.info(`[AdminSync] Successfully promoted ${usersToPromote.length} users.`)
          } catch (updateError) {
            logger?.error(`[AdminSync] Error promoting users`, { emailsToPromote, error: updateError })
          }
        } else {
          logger?.info("[AdminSync] No users found to promote.")
        }
      } else {
        logger?.info("[AdminSync] Skipping promotion step as admin email list in settings is empty.")
      }

      logger?.info("[AdminSync] Admin role synchronization complete.")
    } catch (dbError) {
      logger?.error("Error during admin role synchronization:", { error: dbError })
    }
  }

  // Run sync after a short delay
  setTimeout(syncAdminRoles, 1000)
} catch (error) {
  // Log critical initialization errors
  console.error("CRITICAL: Failed to initialize logging or AppSettings:", error)
  // Optionally re-throw or exit if initialization is mandatory
  // throw new Error("Server initialization failed");
}

// Import the MessageBusClient for Unix socket IPC
import messageBusClientInstance from "$lib/messaging/MessageBusClient"

// Crawler specific imports (keep as needed)
import { db } from "$lib/server/db"
import { job as jobSchema } from "$lib/server/db/schema"
import { JobStatus } from "$lib/types"
// eq is already imported above
import { boot } from "$lib/server/connector"
import { existsSync } from "node:fs"
import path from "node:path"

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

// --- Export Functions for API Routes etc. ---

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

// --- Setup Event Listeners and Heartbeat Monitor ---
// This block runs only if logger initialization was successful
if (logger) {
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
} else {
  console.error("CRITICAL: Logger initialization failed. Cannot set up event listeners.")
  throw new Error("Logger initialization failed")
}

// --- Existing Hook Logic (Keep as is) ---

const paraglideHandle: Handle = ({ event, resolve }) =>
  paraglideMiddleware(event.request, ({ locale }) => {
    event.locals.locale = locale
    return resolve(event, {
      transformPageChunk: ({ html }) => html.replace("%lang%", locale)
    })
  })

const authHandle: Handle = ({ event, resolve }) => svelteKitHandler({ event, resolve, auth })
const authHandle2: Handle = async ({ event, resolve }) => {
  const session = await auth.api.getSession({ headers: event.request.headers })
  event.locals.session = session?.session
  event.locals.user = session?.user
  const response = await resolve(event)
  return response
}

export const corsHandle: Handle = async ({ event, resolve }) => {
  if (event.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });
  }

  const response = await resolve(event);

  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  return response;
};

export const handle: Handle = sequence(corsHandle, paraglideHandle, authHandle, authHandle2)

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