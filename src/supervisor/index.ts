// supervisor.ts
import { spawn, type Subprocess, type FileSink } from "bun"
import { z } from "zod" // For message validation
import { configureLogging } from "$lib/logging" // Import logtape helpers
import type { Logger } from "@logtape/logtape"

// --- Configuration ---
const CRAWLER_ENTRY = "src/crawler/index.ts"
// TODO: Determine the correct command for production vs development
const BACKEND_COMMAND = process.env.NODE_ENV === "production" ? ["bun", "index.js"] : ["bun", "run", "dev"] // For development
const MAX_RESTARTS = 20
const RESTART_BACKOFF_MS = 1000 // Initial backoff
const MAX_BACKOFF_MS = 30000 // Maximum backoff time (30 seconds)
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5000 // Time to wait for children before force killing

// --- State ---
let crawlerProcess: Subprocess | null = null
let backendProcess: Subprocess | null = null
let crawlerRestarts = 0
let backendRestarts = 0
let shuttingDown = false
let shutdownSignalCount = 0 // Track how many shutdown signals received (Changed to let)
let logger: Logger // Logger instance

// --- Message Schema (Example) ---
// Define a schema for basic message structure validation
const BaseMessageSchema = z.object({
  source: z.enum(["crawler", "backend", "supervisor"]),
  target: z.enum(["crawler", "backend", "supervisor", "broadcast"]),
  type: z.string(),
  payload: z.any().optional()
})
type Message = z.infer<typeof BaseMessageSchema>

// --- Helper Functions ---

async function sendMessage(targetProcess: Subprocess | null, message: Message) {
  if (shuttingDown && message.type !== "shutdown") {
    logger.info("Ignoring message send during shutdown", { message })
    return
  }
  if (!targetProcess || !targetProcess.stdin) {
    logger.warn(`Attempted to send message to non-existent or stdin-less process`, { message })
    return
  }
  try {
    // Ensure the source is always 'supervisor' when sending from here
    const validatedMessage = BaseMessageSchema.parse({ ...message, source: "supervisor" })
    const messageString = JSON.stringify(validatedMessage) + "\n"
    // Check if stdin is a FileSink (writable stream) before writing
    if (typeof targetProcess.stdin === "object" && targetProcess.stdin !== null && "write" in targetProcess.stdin) {
      await (targetProcess.stdin as FileSink).write(messageString)
      // Avoid logging potentially large payloads by default
      logger.info(`Sent message type '${validatedMessage.type}' to ${validatedMessage.target}`)
    } else {
      logger.warn(`Cannot send message to ${message.target}, stdin is not writable`, {
        stdin: targetProcess.stdin
      })
    }
  } catch (error) {
    logger.error(`Failed to send or validate message to ${message.target}`, {
      type: message.type,
      error
    })
  }
}

function handleIPCMessage(processName: "crawler" | "backend", data: Buffer | string) {
  const rawData = data.toString().trim()
  if (!rawData) return // Ignore empty lines potentially caused by buffering

  const IPC_PREFIX = "IPC_MSG::"

  // Attempt to handle multiple JSON objects per chunk if needed
  rawData.split("\n").forEach((line) => {
    if (!line) return

    // Check if the line starts with the IPC prefix
    if (line.startsWith(IPC_PREFIX)) {
      const jsonString = line.substring(IPC_PREFIX.length) // Extract the JSON part
      try {
        const json: unknown = JSON.parse(jsonString)
        // Validate the parsed JSON structure using Zod
        // Ensure json is an object before spreading, otherwise spread an empty object
        const messageData = typeof json === "object" && json !== null ? json : {}
        const message = BaseMessageSchema.parse({ ...messageData, source: processName })

        logger.info(`Received IPC message type '${message.type}' from ${processName}`)

        // Routing Logic
        if (message.target === "supervisor") {
          // Handle messages for the supervisor itself (e.g., status requests)
          logger.info(`Handling supervisor command: ${message.type}`, { payload: message.payload })
          // TODO: Implement supervisor-specific commands if needed
        } else if (message.target === "broadcast") {
          // Avoid sending back to the source
          if (processName !== "crawler") sendMessage(crawlerProcess, { ...message, target: "crawler" })
          if (processName !== "backend") sendMessage(backendProcess, { ...message, target: "backend" })
        } else if (message.target === "crawler") {
          sendMessage(crawlerProcess, message)
        } else if (message.target === "backend") {
          sendMessage(backendProcess, message)
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          logger.error(`Invalid IPC message format from ${processName}`, {
            rawLine: jsonString, // Log the JSON part on error
            error: error.errors
          })
        } else if (error instanceof SyntaxError) {
          logger.error(`Invalid JSON received from ${processName}`, { rawLine: jsonString })
        } else {
          logger.error(`Failed to handle IPC message from ${processName}`, {
            rawLine: jsonString,
            error
          })
        }
      }
    } else {
      // Line doesn't have the prefix, treat as regular log output (or ignore)
      // Since stdout/stderr are inherited, we can usually ignore these lines here.
      // logger.debug(`[${processName} log] ${line}`); // Uncomment for debugging non-IPC output
    }
  }) // End of rawData.split().forEach()
}

async function startProcess(name: "crawler" | "backend"): Promise<Subprocess | null> {
  if (shuttingDown) return null

  const command = name === "crawler" ? ["bun", CRAWLER_ENTRY] : BACKEND_COMMAND
  const restarts = name === "crawler" ? crawlerRestarts : backendRestarts

  if (restarts >= MAX_RESTARTS) {
    logger.error(`${name} has exceeded max restart attempts (${MAX_RESTARTS}). Will not restart again.`)
    return null
  }

  const backoff = restarts > 0 ? Math.min(RESTART_BACKOFF_MS * 2 ** (restarts - 1), MAX_BACKOFF_MS) : 0
  if (backoff > 0) {
    logger.warn(`${name} exited unexpectedly. Restarting in ${backoff}ms... (Attempt ${restarts + 1}/${MAX_RESTARTS})`)
    await Bun.sleep(backoff)
    // Re-check shutdown status after sleep
    if (shuttingDown) return null
  }

  logger.info(`Starting ${name} process...`, { command: command.join(" ") })

  try {
    // Corrected: command array first, then options object inline
    const proc = spawn(command, {
      // Reverting to standard pipes, will filter stdout for IPC prefix
      stdin: "pipe",
      stdout: "pipe", // Capture stdout for potential IPC messages
      stderr: "inherit", // Show errors directly
      // ipc: true, // Consider re-adding if needed, but manual prefixing might be sufficient
      env: {
        ...process.env,
        SUPERVISED_PROCESS: name, // Let the child know its role
        FORCE_COLOR: "1" // Ensure colors work in child processes if needed (Removed duplicate, added comma)
      },
      onExit: (procRef, exitCode, signalCode, error) => {
        // Pass signalCode directly, handleExit accepts number | null
        handleExit(name, exitCode, signalCode, error)
      }
    })

    // Asynchronously read messages from the child process's stdout
    // We will filter these messages based on a prefix later
    if (proc.stdout) {
      const reader = proc.stdout.getReader()
      ;(async () => {
        try {
          while (!shuttingDown) {
            // Stop reading if shutting down
            const { done, value } = await reader.read()
            if (done) {
              logger.info(`${name} stdout stream closed.`)
              break
            }
            if (value) {
              handleIPCMessage(name, Buffer.from(value))
            }
          }
        } catch (err) {
          // Log read errors only if not during shutdown
          if (!shuttingDown) {
            logger.error(`Error reading stdout stream from ${name}`, { error: err })
          }
        } finally {
          // Ensure reader is released if loop exits
          reader.releaseLock()
          logger.info(`Stopped reading stdout for ${name}.`)
        }
      })() // IIFE to handle async reading
    } else {
      logger.warn(`No stdout stream available for IPC from ${name}`)
    }

    logger.info(`${name} process started successfully (PID: ${proc.pid})`)
    // Reset restart counter on successful start
    if (name === "crawler") crawlerRestarts = 0
    else backendRestarts = 0

    return proc
  } catch (error) {
    logger.error(`Failed to spawn ${name} process`, { command: command.join(" "), error })
    // Increment restart count even on spawn failure to prevent immediate retry loops
    if (name === "crawler") crawlerRestarts++
    else backendRestarts++
    // Attempt restart after backoff
    startProcess(name).then((p) => {
      if (p) {
        // Only assign if startProcess didn't return null
        if (name === "crawler") crawlerProcess = p
        else backendProcess = p
      }
    })
    return null
  }
}

async function handleExit(
  name: "crawler" | "backend",
  exitCode: number | null,
  signalCode: number | null, // Updated type to match onExit callback
  error?: Error
) {
  // Clear the process reference regardless of why it exited
  if (name === "crawler" && crawlerProcess) {
    logger.warn(`Crawler process (PID: ${crawlerProcess.pid}) exited`, {
      exitCode,
      signalCode,
      error
    })
    crawlerProcess = null
  } else if (name === "backend" && backendProcess) {
    logger.warn(`Backend process (PID: ${backendProcess.pid}) exited`, {
      exitCode,
      signalCode,
      error
    })
    backendProcess = null
  } else {
    // This might happen if exit occurs before process is fully assigned or after shutdown cleanup
    logger.warn(`${name} process exited (PID unknown or already cleared)`, {
      exitCode,
      signalCode,
      error
    })
  }

  if (shuttingDown) {
    logger.info(`${name} exited during shutdown sequence.`)
    return // Do not restart if we are shutting down
  }

  // Decide if restart is needed
  // Restart on non-zero exit code, any signal, or specific errors during exit
  const needsRestart = exitCode !== 0 || signalCode !== null || error !== undefined

  if (needsRestart) {
    if (name === "crawler") crawlerRestarts++
    else backendRestarts++

    logger.info(`Attempting to restart ${name} due to unexpected exit.`)
    // Trigger restart, the startProcess function handles backoff and max attempts
    startProcess(name).then((p) => {
      if (p) {
        // Only assign if startProcess didn't return null
        if (name === "crawler") crawlerProcess = p
        else backendProcess = p
      }
    })
  } else {
    logger.info(`${name} exited cleanly (code 0). Not restarting automatically.`)
    // Reset restart counter as it exited cleanly
    if (name === "crawler") crawlerRestarts = 0
    else backendRestarts = 0
    // TODO: Decide if clean exits should *also* trigger a restart (e.g., for long-running services)
    // If so, uncomment the following lines:
    // logger.info(`Restarting ${name} even after clean exit.`);
    // startProcess(name).then(p => { ... });
  }
}

async function gracefulShutdown(signal: string) {
  shutdownSignalCount++ // Increment signal counter

  if (shutdownSignalCount > 1) {
    logger.warn(`Received second shutdown signal (${signal}). Force killing children immediately.`)
    // Force kill immediately without waiting
    if (crawlerProcess) {
      logger.warn(`Force killing crawler (PID: ${crawlerProcess.pid})...`)
      crawlerProcess.kill(9) // SIGKILL
      crawlerProcess = null
    }
    if (backendProcess) {
      logger.warn(`Force killing backend (PID: ${backendProcess.pid})...`)
      backendProcess.kill(9) // SIGKILL
      backendProcess = null
    }
    logger.info("Forced shutdown complete.")
    process.exit(1) // Exit with error code due to forced shutdown
  }

  // First shutdown signal
  if (shuttingDown) return // Still prevent re-entry if already in progress from first signal
  shuttingDown = true
  logger.info(`Received ${signal}. Initiating graceful shutdown (attempt 1)...`)

  const shutdownMessage: Message = {
    source: "supervisor",
    target: "broadcast", // Will be adjusted by sendMessage
    type: "shutdown",
    payload: { signal }
  }

  // Notify children concurrently
  const notifyCrawler = crawlerProcess
    ? sendMessage(crawlerProcess, { ...shutdownMessage, target: "crawler" })
    : Promise.resolve()
  const notifyBackend = backendProcess
    ? sendMessage(backendProcess, { ...shutdownMessage, target: "backend" })
    : Promise.resolve()

  logger.info("Sending shutdown signals to children...")
  await Promise.all([notifyCrawler, notifyBackend])

  // Wait for children to exit OR timeout, whichever comes first
  logger.info(`Waiting up to ${GRACEFUL_SHUTDOWN_TIMEOUT_MS}ms for children to exit gracefully...`)

  const timeoutPromise = Bun.sleep(GRACEFUL_SHUTDOWN_TIMEOUT_MS).then(() => "timeout")
  const crawlerExitPromise =
    crawlerProcess?.exited.then(() => "crawlerExited") ?? Promise.resolve("crawlerAlreadyExited")
  const backendExitPromise =
    backendProcess?.exited.then(() => "backendExited") ?? Promise.resolve("backendAlreadyExited")

  // Wait for the first process to exit or the timeout to occur
  const raceResult = await Promise.race([
    timeoutPromise,
    Promise.allSettled([crawlerExitPromise, backendExitPromise]).then(() => "allSettled") // Wait until both promises settle (exit or already exited)
  ])

  if (raceResult === "timeout") {
    logger.warn("Graceful shutdown timeout reached.")
  } else {
    logger.info("All children processes have exited or were already gone.")
  }

  // Force kill any remaining processes (check references again as they might have exited during the wait)
  let killedProcesses = false
  if (crawlerProcess) {
    logger.warn(`Crawler (PID: ${crawlerProcess.pid}) did not exit gracefully. Force killing...`)
    crawlerProcess.kill(9) // SIGKILL
    crawlerProcess = null // Clear reference
    killedProcesses = true
  }
  if (backendProcess) {
    logger.warn(`Backend (PID: ${backendProcess.pid}) did not exit gracefully. Force killing...`)
    backendProcess.kill(9) // SIGKILL
    backendProcess = null // Clear reference
    killedProcesses = true
  }

  if (!killedProcesses) {
    logger.info("All children exited gracefully.")
  }
  logger.info("Supervisor shutdown complete.")
  process.exit(0) // Exit supervisor cleanly
}

// --- Main Execution ---

async function main() {
  // Configure logging for the supervisor
  logger = await configureLogging("supervisor") // Use await as configureLogging might be async

  logger.info("Supervisor starting...")
  logger.info(`Mode: ${process.env.NODE_ENV || "development"}`)

  // Setup signal handlers
  process.on("SIGINT", () => gracefulShutdown("SIGINT"))
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
  // Handle unhandled rejections and exceptions in the supervisor itself
  process.on("unhandledRejection", (reason, promise) => {
    logger.error("Unhandled Rejection at:", { promise, reason })
    // Consider if supervisor should exit on unhandled rejection
    // gracefulShutdown('UnhandledRejection').then(() => process.exit(1));
  })
  process.on("uncaughtException", (error) => {
    logger.error("Uncaught Exception:", { error })
    // Gracefully shutdown and exit on uncaught exception to prevent undefined state
    gracefulShutdown("UncaughtException").then(() => process.exit(1))
  })

  // Start initial processes concurrently
  const startPromises = [startProcess("crawler"), startProcess("backend")]

  const results = await Promise.all(startPromises)
  // Use nullish coalescing to handle potential undefined from array access, ensuring type match
  crawlerProcess = results[0] ?? null
  backendProcess = results[1] ?? null

  if (!crawlerProcess || !backendProcess) {
    logger.error("One or both child processes failed to start initially. Check logs.")
    // Decide if supervisor should exit if initial start fails
    // await gracefulShutdown('InitialStartFailure');
    // process.exit(1);
  } else {
    logger.info("Both crawler and backend processes initiated.")
  }

  // The supervisor primarily reacts to events (process exits, signals, IPC messages)
  // No infinite loop needed here; Node.js/Bun stays alive due to active listeners/processes.
  logger.info("Supervisor is running and monitoring processes...")
}

// Run the main function
main().catch((error) => {
  // This catch is for errors during the initial setup phase in main()
  // Use console.error here as the logger might not be initialized if configureLogging fails
  console.error("Critical error during supervisor startup", error)
  process.exit(1) // Exit supervisor if main setup fails critically
})
