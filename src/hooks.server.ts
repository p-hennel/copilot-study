// import { spawn, type Subprocess, type SpawnOptions } from "bun"; // Removed: No longer spawning directly
import { sequence } from "@sveltejs/kit/hooks";
import type { Handle } from "@sveltejs/kit";
import { io, type Socket } from "socket.io-client"; // Added: Socket.IO client
// import { init } from "@socket.io/pm2"; // Removed: Not needed on client-side
import { auth } from "$lib/auth";
import { svelteKitHandler } from "better-auth/svelte-kit";
import { paraglideMiddleware } from "$lib/paraglide/server";
// import { configureLogging } from "$lib/logging"; // Removed: Unused import
// import "$lib/messaging/MessageBusServer"; // Removed or adjust if this was related to old IPC

// Crawler specific imports
import { db } from "$lib/server/db";
import { job as jobSchema } from "$lib/server/db/schema";
import { JobStatus } from "$lib/utils";
import { eq } from "drizzle-orm";
import type {
  CrawlerCommand,
  CrawlerStatus,
  StartJobCommand, // Keep if used elsewhere, like in startJob
  JobDataTypeProgress // Added import for progress type
} from "./crawler/types"; // Consolidated imports
import type { JobCompletionUpdate } from "./crawler/jobManager"; // Adjust path if necessary

// --- Socket.IO Client Setup ---
// Connect to the Socket.IO server (crawler) via PM2 bus
// The actual connection details might depend on how the crawler-side server is set up.
// Connect to the origin server, assuming PM2/sticky-session handles routing.
const socket: Socket = io({
  transports: ["websocket"], // Prefer WebSocket for server-to-server
  reconnection: true // Ensure reconnection is enabled (usually default)
});

let lastHeartbeat: number = Date.now(); // Keep track of last known heartbeat
let currentCrawlerStatus: CrawlerStatus | null = null; // Store latest status from crawler
const HEARTBEAT_TIMEOUT = 60000; // 60 seconds - Keep for monitoring connection

console.log("Initializing Socket.IO client for crawler communication...");

socket.on("connect", () => {
  console.log("Socket.IO connected to crawler process.");
  lastHeartbeat = Date.now(); // Reset heartbeat on connect/reconnect
});

socket.on("disconnect", (reason) => {
  console.warn(`Socket.IO disconnected from crawler: ${reason}`);
  currentCrawlerStatus = null; // Clear status on disconnect
  // PM2 should handle restarting the crawler process.
  // We might want additional logic here if needed (e.g., UI indicators).
});

socket.on("connect_error", (err) => {
  console.error("Socket.IO connection error:", err.message);
  // Maybe add a small delay before logging subsequent errors to avoid spam
});

// Listen for messages from the crawler
socket.on("heartbeat", (data: { timestamp: number }) => {
  // console.log('Received heartbeat from crawler.');
  lastHeartbeat = data?.timestamp || Date.now();
});

socket.on("statusUpdate", (payload: CrawlerStatus) => {
  // console.log('Received status update from crawler:', payload);
  currentCrawlerStatus = payload;
});

socket.on("jobUpdate", (update: JobCompletionUpdate) => {
  // console.log('Received job update from crawler:', update);
  handleJobUpdate(update); // Reuse existing DB update logic
});

// Optional: Monitor heartbeat from our side
// If we don't receive a heartbeat for a while, log a warning.
// PM2 is responsible for the crawler process lifecycle, but this helps diagnose communication issues.
setInterval(() => {
  if (socket.connected && Date.now() - lastHeartbeat > HEARTBEAT_TIMEOUT) {
    console.warn(
      `No heartbeat received from crawler in over ${HEARTBEAT_TIMEOUT / 1000} seconds. Connection might be stale.`
    );
    // Consider attempting a disconnect/reconnect or just logging
  }
}, HEARTBEAT_TIMEOUT / 2);

/**
 * Handles detailed job updates (completed, failed, paused) received via Socket.IO. Updates the database.
 */
async function handleJobUpdate(update: JobCompletionUpdate) {
  console.log(`Handling job update for ${update.jobId}, status: ${update.status}`);

  // Map crawler status to DB status (JobStatus enum now includes 'paused')
  let dbStatus: JobStatus;
  switch (update.status) {
    case "completed":
      dbStatus = JobStatus.finished;
      break;
    case "failed":
      dbStatus = JobStatus.failed;
      break;
    case "paused":
      dbStatus = JobStatus.paused;
      break; // Use 'paused' directly
    default: {
      // Add exhaustive check for type safety
      const exhaustiveCheck: never = update.status;
      console.error(`Invalid status received in jobUpdate: ${exhaustiveCheck}`);
      return;
    }
  }

  try {
    const updateData: Partial<typeof jobSchema.$inferInsert> = {
      status: dbStatus,
      resumeState: update.progress ?? null
      // No updated_at field in schema
    };

    if (update.status === "completed" || update.status === "failed") {
      updateData.finished_at = new Date(update.timestamp);
      if (update.status === "completed") {
        updateData.resumeState = null; // Clear progress on success
      }
    }
    if (update.status === "failed" && update.error) {
      // updateData.error = update.error; // Uncomment if schema has 'error' field
      console.error(`Job ${update.jobId} failed: ${update.error}`);
    }

    const result = await db.update(jobSchema).set(updateData).where(eq(jobSchema.id, update.jobId));

    if (result.rowsAffected === 0) {
      console.warn(`DB update for job ${update.jobId} (status: ${dbStatus}) affected 0 rows.`);
    } else {
      console.log(`Successfully updated job ${update.jobId} status to ${dbStatus} in DB.`);
    }
  } catch (error) {
    console.error(`Failed to update DB for job ${update.jobId} (status: ${dbStatus}):`, error);
  }
}
/**
 * Sends a command to the crawler process via Socket.IO.
 */
export function sendCommandToCrawler(command: CrawlerCommand): boolean {
  if (!socket.connected) {
    console.error("Cannot send command: Socket.IO not connected to crawler.");
    return false;
  }

  try {
    console.log(`Sending command to crawler via Socket.IO emit: ${command.type}`);
    // Emit a generic 'command' event, or specific events per command type
    // Using a generic 'command' event here for simplicity
    socket.emit("command", command);
    return true; // Assume emit is successful if no immediate error
  } catch (error) {
    console.error("Failed to send command to crawler via Socket.IO emit:", error);
    return false;
  }
}

// --- Old Initialization Removed ---
// startCrawlerProcess(); // Removed: PM2 manages the crawler process
// setInterval(checkHeartbeat, HEARTBEAT_TIMEOUT / 2); // Removed: Using socket connection status and heartbeat events

// --- Export Functions for API Routes etc. ---
// (These should now use the updated sendCommandToCrawler)
// (Keep existing exports or add new ones as needed)
export async function startJob(params: Omit<StartJobCommand, "type" | "progress">) {
  // Make async, adjust params type
  let existingProgress: Record<string, JobDataTypeProgress> | undefined = undefined;
  try {
    // Fetch the job from the DB using the jobId from params
    const jobRecord = await db.query.job.findFirst({
      where: eq(jobSchema.id, params.jobId),
      columns: { resumeState: true } // Only fetch the resumeState column
    });

    // Check if resumeState exists and is a valid object
    if (jobRecord?.resumeState && typeof jobRecord.resumeState === "object") {
      // Drizzle's mode: "json" should handle parsing, but add validation if needed
      existingProgress = jobRecord.resumeState as Record<string, JobDataTypeProgress>;
      console.log(`Found existing progress for job ${params.jobId}. Resuming.`);
    } else {
      console.log(`No existing progress found for job ${params.jobId}. Starting fresh.`);
    }
  } catch (dbError) {
    console.error(`Error fetching progress for job ${params.jobId} from DB:`, dbError);
    // Decide how to handle DB errors - proceed without progress?
  }

  const command: StartJobCommand = {
    type: "START_JOB",
    ...params,
    progress: existingProgress // Pass progress if found, otherwise undefined
  };
  sendCommandToCrawler(command);
}

export function pauseCrawler() {
  sendCommandToCrawler({ type: "PAUSE_CRAWLER" });
}

export function resumeCrawler() {
  sendCommandToCrawler({ type: "RESUME_CRAWLER" });
}

/**
 * Returns the last known status received from the crawler.
 * @returns {CrawlerStatus | null} The crawler status object or null if no status received or disconnected.
 */
export function getCrawlerStatus(): CrawlerStatus | null {
  return currentCrawlerStatus;
}

// --- Existing Hook Logic ---

const paraglideHandle: Handle = ({ event, resolve }) =>
  paraglideMiddleware(event.request, ({ locale }) => {
    event.locals.locale = locale;
    return resolve(event, {
      transformPageChunk: ({ html }) => html.replace("%lang%", locale)
    });
  });

const authHandle: Handle = ({ event, resolve }) => svelteKitHandler({ event, resolve, auth });
const authHandle2: Handle = async ({ event, resolve }) => {
  const session = await auth.api.getSession({ headers: event.request.headers });
  event.locals.session = session?.session;
  event.locals.user = session?.user;
  const response = await resolve(event);
  return response;
};

export const handle: Handle = sequence(paraglideHandle, authHandle, authHandle2);
