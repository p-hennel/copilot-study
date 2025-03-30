// src/crawler/ipc.ts - Rewritten for Supervisor Stdout/Stdin IPC
import type { CrawlerCommand, CrawlerStatus } from "./types";
import { z } from "zod"; // For message validation
import { Writable } from "stream";

// --- Message Schema (Mirrors supervisor's schema for consistency) ---
const BaseMessageSchema = z.object({
  source: z.enum(["crawler", "backend", "supervisor"]),
  target: z.enum(["crawler", "backend", "supervisor", "broadcast"]),
  type: z.string(),
  payload: z.any().optional()
});
// Removed unused ReceivedMessage type

// Define the structure for messages sent *from* the crawler
export interface SendMessageArgs {
  // Added export
  target: "supervisor" | "backend" | "broadcast";
  type: string;
  payload?: unknown; // Use unknown instead of any
}

// --- Interfaces (Keep the contract with crawler.ts) ---
interface IPCHandlers {
  onCommand: (command: CrawlerCommand) => void;
  // Add a specific handler for shutdown signals from the supervisor
  onShutdown: (signal?: string) => Promise<void> | void;
  // sendStatus and sendHeartbeat are now implemented internally
}

interface IPCInstance {
  // Functions the crawler logic can call to send messages
  sendStatus: (status: CrawlerStatus) => void;
  sendHeartbeat: () => void;
  // Optional: A generic send function if needed
  sendMessage: (args: SendMessageArgs) => void;
}

// --- Helper Functions ---
function log(level: "info" | "warn" | "error", message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  // Add [CrawlerIPC] prefix for clarity
  const logMessage = `[${timestamp}] [CrawlerIPC] [${level.toUpperCase()}] ${message}`;
  if (data !== undefined) {
    console[level](logMessage, data);
  } else {
    console[level](logMessage);
  }
}

// --- Stdout Sending Function ---
// Ensure stdout is writable before attempting to write
const safeStdoutWrite = (data: string) => {
  if (process.stdout instanceof Writable && !process.stdout.destroyed) {
    process.stdout.write(data, (err) => {
      if (err) {
        log("error", "Failed to write to stdout", err);
      }
    });
  } else {
    log("error", "Cannot write to stdout, stream is not writable or destroyed.");
  }
};

const sendMessageToSupervisor = (args: SendMessageArgs) => {
  try {
    const message = {
      source: "crawler", // Always set source as crawler
      target: args.target,
      type: args.type,
      payload: args.payload
    };
    // Validate structure before sending (optional but good practice)
    // BaseMessageSchema.parse(message); // Could use this, but assumes received structure matches sent
    const messageString = `IPC_MSG::${JSON.stringify(message)}\n`; // Add prefix
    safeStdoutWrite(messageString);
    // log('info', `Sent message type '${message.type}' to ${message.target}`);
  } catch (error) {
    log("error", `Failed to stringify or send message`, { args, error });
  }
};

// --- Stdin Listening and Processing ---
let stdinBuffer = "";

function processStdinBuffer(handlers: IPCHandlers) {
  let newlineIndex;
  // Process buffer line by line
  while ((newlineIndex = stdinBuffer.indexOf("\n")) >= 0) {
    const line = stdinBuffer.slice(0, newlineIndex).trim();
    stdinBuffer = stdinBuffer.slice(newlineIndex + 1); // Remove processed line + newline

    if (!line) continue; // Ignore empty lines

    try {
      const json: unknown = JSON.parse(line);
      const message = BaseMessageSchema.parse(json); // Validate the incoming message

      // Check if the message is intended for the crawler
      if (message.target === "crawler" || message.target === "broadcast") {
        log("info", `Received message type '${message.type}' from ${message.source}`);

        // Handle specific message types
        if (message.type === "shutdown") {
          log("warn", "Received shutdown command from supervisor.");
          // Trigger graceful shutdown in the crawler logic
          handlers.onShutdown(message.payload?.signal);
        } else {
          // Assume other types are commands for the crawler
          // TODO: Add more robust command type validation if needed
          if (typeof message.payload === "object" && message.payload !== null) {
            handlers.onCommand(message as unknown as CrawlerCommand); // Needs careful type assertion or better validation
          } else {
            // Handle commands without payload if necessary, or treat as invalid
            handlers.onCommand({ type: message.type } as CrawlerCommand);
          }
        }
      } else {
        // Message not for us, ignore (or log if needed)
        // log('info', `Ignoring message targeted at ${message.target}`);
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        log("error", `Invalid IPC message format received`, { rawLine: line, error: error.errors });
      } else if (error instanceof SyntaxError) {
        log("error", `Invalid JSON received on stdin`, { rawLine: line });
      } else {
        log("error", `Failed to handle IPC message from stdin`, { rawLine: line, error });
      }
    }
  }
}

/**
 * Sets up the IPC communication channel using stdin/stdout.
 * Listens for commands from the supervisor via stdin and provides functions
 * to send status and heartbeats back via stdout.
 * @param handlers Object containing callback functions for handling commands and shutdown.
 * @returns An object with functions to send messages to the supervisor/backend.
 */
export function setupIPC(handlers: IPCHandlers): IPCInstance {
  // Ensure this process is running under the supervisor
  if (process.env.SUPERVISED_PROCESS !== "crawler") {
    log("error", "CRITICAL: Crawler started without supervisor environment variable. Exiting.");
    process.exit(1); // Exit if not supervised
  }

  log("info", "Setting up stdin/stdout IPC for supervisor communication...");

  // Setup stdin listener
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (data) => {
    stdinBuffer += data.toString();
    processStdinBuffer(handlers); // Process buffer whenever new data arrives
  });

  process.stdin.on("end", () => {
    log("warn", "Stdin stream ended. Crawler may lose connection with supervisor.");
    // Process any remaining buffer content
    if (stdinBuffer.length > 0) {
      log("warn", "Processing remaining stdin buffer before exit...");
      processStdinBuffer(handlers);
    }
    // Optionally trigger shutdown if stdin closes unexpectedly
    // handlers.onShutdown('stdin_closed');
  });

  process.stdin.on("error", (err) => {
    log("error", "Stdin stream error:", err);
    // Potentially trigger shutdown on stdin error
    handlers.onShutdown("stdin_error");
  });

  log("info", "IPC setup complete. Listening on stdin and ready to send on stdout.");

  // Return the instance with methods to send messages via stdout
  return {
    sendStatus: (status: CrawlerStatus) => {
      sendMessageToSupervisor({
        target: "supervisor", // Status usually goes only to supervisor
        type: "statusUpdate",
        payload: status
      });
    },
    sendHeartbeat: () => {
      sendMessageToSupervisor({
        target: "supervisor", // Heartbeat usually goes only to supervisor
        type: "heartbeat",
        payload: { timestamp: Date.now() }
      });
    },
    sendMessage: sendMessageToSupervisor // Expose generic sender
  };
}
