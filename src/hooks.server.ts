//import { spawn, type Subprocess, type SpawnOptions } from "bun";
import { sequence } from "@sveltejs/kit/hooks";
import type { Handle } from "@sveltejs/kit";
import { auth } from "$lib/auth";
import { svelteKitHandler } from "better-auth/svelte-kit";
import { paraglideMiddleware } from "$lib/paraglide/server";
import { configureLogging } from "$lib/logging";
import "$lib/messaging/MessageBusServer"; // Assuming this is needed

// Crawler specific imports
import { db } from "$lib/server/db";
import { job as jobSchema } from "$lib/server/db/schema";
import { JobStatus } from "$lib/utils";
import { eq } from "drizzle-orm";
import type { CrawlerCommand, CrawlerStatus, StartJobCommand } from "./crawler/types"; // Adjust path if necessary
import type { JobCompletionUpdate } from "./crawler/jobManager"; // Adjust path if necessary

let crawlerProcess: unknown = null; //: Subprocess | null = null;
let lastHeartbeat: number = 0;
let currentCrawlerStatus: CrawlerStatus | null = null; // Store latest status

const CRAWLER_SCRIPT_PATH = "src/crawler/index.ts";
const HEARTBEAT_TIMEOUT = 60000; // 60 seconds
const RESTART_DELAY = 5000; // 5 seconds delay before restarting

// --- Crawler Management ---

function startCrawlerProcess() {
  /*
  if (crawlerProcess?.pid) {
    console.log("Crawler process already running.");
    return;
  }

  console.log(`Spawning crawler process: ${CRAWLER_SCRIPT_PATH}...`);
  try {
    const options: SpawnOptions.OptionsObject = {
      ipc: handleIPCMessage, // Pass the handler directly
      stdout: "pipe", // Pipe logs
      stderr: "pipe",
      env: { ...process.env },
      onExit: (subprocess, exitCode, signalCode, error) => {
        handleCrawlerExit(exitCode, signalCode, error);
      }
    };

    crawlerProcess = spawn(['bun', 'run', CRAWLER_SCRIPT_PATH], options);

    if (crawlerProcess.pid) {
         streamOutput(crawlerProcess); // Log output
         console.log(`Crawler process spawned with PID: ${crawlerProcess.pid}`);
         lastHeartbeat = Date.now();
    } else {
         console.error('Crawler process failed to spawn (no PID).');
         crawlerProcess = null;
         // Schedule restart attempt even if initial spawn failed?
         setTimeout(startCrawlerProcess, RESTART_DELAY);
    }
  } catch (error) {
    console.error("Failed to spawn crawler process:", error);
    crawlerProcess = null;
    // Schedule restart attempt on error
    setTimeout(startCrawlerProcess, RESTART_DELAY);
  }
  */
}

async function streamOutput(subprocess: any) {
  const stdout = subprocess.stdout as ReadableStream<Uint8Array> | null;
  const stderr = subprocess.stderr as ReadableStream<Uint8Array> | null;
  if (!stdout || !stderr) return;

  try {
    const readerStdout = stdout.getReader();
    const readerStderr = stderr.getReader();
    const decoder = new TextDecoder();
    const read = async (reader: ReadableStreamDefaultReader<Uint8Array>, prefix: string) => {
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          if (line) console.log(`${prefix}: ${line}`);
          buffer = buffer.slice(newlineIndex + 1);
        }
      }
      if (buffer.trim()) console.log(`${prefix}: ${buffer.trim()}`);
    };
    await Promise.all([
      read(readerStdout, "[Crawler STDOUT]"),
      read(readerStderr, "[Crawler STDERR]")
    ]);
  } catch (error) {
    console.error("Error reading crawler output stream:", error);
  }
}

function handleCrawlerExit(exitCode: number | null, signalCode: number | null, error?: Error) {
  const pid = crawlerProcess?.pid; // Capture pid before clearing
  console.error(
    `Crawler process (PID: ${pid ?? "unknown"}) exited. Code: ${exitCode}, Signal: ${signalCode}`,
    error ?? ""
  );
  crawlerProcess = null;
  currentCrawlerStatus = null;
  // Schedule restart after a delay
  console.log(`Scheduling crawler restart in ${RESTART_DELAY / 1000} seconds...`);
  setTimeout(startCrawlerProcess, RESTART_DELAY);
}

function checkHeartbeat() {
  if (!crawlerProcess?.pid) return; // No process running

  const timeSinceHeartbeat = Date.now() - lastHeartbeat;
  if (timeSinceHeartbeat > HEARTBEAT_TIMEOUT) {
    console.error(
      `Crawler heartbeat timeout (${timeSinceHeartbeat}ms). Terminating process (PID: ${crawlerProcess.pid}).`
    );
    crawlerProcess.kill(); // Terminate the unresponsive process
    // handleCrawlerExit will be called by the onExit handler, triggering restart logic
  }
}

/**
 * Handles messages received from the crawler process via IPC.
 */
function handleIPCMessage(message: any, subprocess: any) {
  // console.log('Received IPC message from crawler:', message);

  if (typeof message !== "object" || message === null || !message.type) {
    console.warn("Received invalid IPC message format from crawler:", message);
    return;
  }

  switch (message.type) {
    case "heartbeat":
      lastHeartbeat = message.timestamp || Date.now();
      // console.log('Received heartbeat from crawler.');
      break;
    case "statusUpdate":
      currentCrawlerStatus = message.payload as CrawlerStatus;
      // console.log('Received status update from crawler:', currentCrawlerStatus);
      break;
    case "jobUpdate": // Handle the detailed job update message
      handleJobUpdate(message as JobCompletionUpdate);
      break;
    default:
      console.warn(`Received unknown IPC message type from crawler: ${message.type}`);
  }
}

/**
 * Handles detailed job updates (completed, failed, paused) from crawler. Updates the database.
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
    default:
      // Add exhaustive check for type safety
      const exhaustiveCheck: never = update.status;
      console.error(`Invalid status received in jobUpdate: ${exhaustiveCheck}`);
      return;
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
 * Sends a command to the crawler process via IPC's send method.
 */
export function sendCommandToCrawler(command: CrawlerCommand): boolean {
  // Export for use elsewhere
  if (!crawlerProcess?.pid) {
    console.error("Cannot send command: Crawler process not running.");
    // Optionally try starting it if it's not running
    // startCrawlerProcess();
    return false;
  }

  try {
    console.log(`Sending command to crawler via IPC send: ${command.type}`);
    const sent = (crawlerProcess as any).send(command);
    if (sent === false) {
      console.error(
        "Failed to send command to crawler (send returned false). Channel might be closed."
      );
      // Process might have exited, handleCrawlerExit should trigger restart
      return false;
    }
    return true;
  } catch (error) {
    console.error("Failed to send command to crawler via IPC send:", error);
    // Process might have exited, handleCrawlerExit should trigger restart
    return false;
  }
}

// --- Initialize Crawler and Heartbeat Monitor ---
startCrawlerProcess(); // Start crawler on server init
setInterval(checkHeartbeat, HEARTBEAT_TIMEOUT / 2); // Start heartbeat monitor

// --- Export Functions for API Routes etc. ---
// (Keep existing exports or add new ones as needed)
export function startJob(params: Omit<StartJobCommand, "type">) {
  // TODO: Fetch existing progress from DB here if needed for resume
  // const existingProgress = await db.query...
  const command: StartJobCommand = {
    type: "START_JOB",
    ...params
    // progress: existingProgress ?? {} // Pass progress if resuming
  };
  sendCommandToCrawler(command);
}

export function pauseCrawler() {
  sendCommandToCrawler({ type: "PAUSE_CRAWLER" });
}

export function resumeCrawler() {
  sendCommandToCrawler({ type: "RESUME_CRAWLER" });
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
