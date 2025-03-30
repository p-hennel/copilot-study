// src/lib/messaging/MessageBusClient.ts - Rewritten for Supervisor Stdout/Stdin IPC
import { z } from "zod";
import { Writable } from "stream";
import { EventEmitter } from "events";

// Import ACTUAL types from crawler modules
import type {
  CrawlerCommand,
  CrawlerStatus
  // Import CrawlerState if needed for status validation
} from "../../crawler/types"; // Adjusted path
import type { JobCompletionUpdate } from "../../crawler/jobManager"; // Adjusted path
// Removed placeholder type definitions

// --- Message Schema (Mirrors supervisor/crawler) ---
const BaseMessageSchema = z.object({
  source: z.enum(["crawler", "backend", "supervisor"]),
  target: z.enum(["crawler", "backend", "supervisor", "broadcast"]),
  type: z.string(),
  payload: z.any().optional()
});

// Define the structure for messages sent *from* the backend
interface SendMessageArgs {
  target: "supervisor" | "crawler" | "broadcast";
  type: string;
  payload?: unknown;
}

// --- Helper Functions ---
function log(level: "info" | "warn" | "error", message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  // Add [BackendIPC] prefix for clarity
  const logMessage = `[${timestamp}] [BackendIPC] [${level.toUpperCase()}] ${message}`;
  if (data !== undefined) {
    console[level](logMessage, data);
  } else {
    console[level](logMessage);
  }
}

// --- Stdout Sending Function ---
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

/**
 * MessageBusClient facilitates communication with the supervisor via stdin/stdout.
 * It emits events for incoming messages.
 */
export class MessageBusClient extends EventEmitter {
  private stdinBuffer = "";

  constructor() {
    super();
    // Ensure this process is running under the supervisor
    if (process.env.SUPERVISED_PROCESS !== "backend") {
      log(
        "error",
        "CRITICAL: Backend started without supervisor environment variable. IPC will not function."
      );
      // Don't exit, but log error. Allow backend to run, but IPC features will fail.
      return;
    }

    log("info", "Setting up stdin/stdout IPC for supervisor communication...");
    this.setupStdinListener();
  }

  private setupStdinListener() {
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (data) => {
      this.stdinBuffer += data.toString();
      this.processStdinBuffer(); // Process buffer whenever new data arrives
    });

    process.stdin.on("end", () => {
      log("warn", "Stdin stream ended. Backend may lose connection with supervisor.");
      if (this.stdinBuffer.length > 0) {
        log("warn", "Processing remaining stdin buffer before exit...");
        this.processStdinBuffer();
      }
      this.emit("disconnected"); // Emit event indicating disconnection
    });

    process.stdin.on("error", (err) => {
      log("error", "Stdin stream error:", err);
      this.emit("error", err); // Emit error event
      this.emit("disconnected"); // Consider disconnected on error
    });

    log("info", "IPC setup complete. Listening on stdin.");
  }

  private processStdinBuffer() {
    let newlineIndex;
    while ((newlineIndex = this.stdinBuffer.indexOf("\n")) >= 0) {
      const line = this.stdinBuffer.slice(0, newlineIndex).trim();
      this.stdinBuffer = this.stdinBuffer.slice(newlineIndex + 1);

      if (!line) continue;

      try {
        const json: unknown = JSON.parse(line);
        const message = BaseMessageSchema.parse(json);

        // Check if the message is intended for the backend
        if (message.target === "backend" || message.target === "broadcast") {
          log("info", `Received message type '${message.type}' from ${message.source}`);

          // Emit specific events based on message type
          if (message.type === "shutdown") {
            this.emit("shutdown", message.payload?.signal);
          } else if (message.type === "statusUpdate") {
            // TODO: Validate payload structure for statusUpdate
            this.emit("statusUpdate", message.payload as CrawlerStatus);
          } else if (message.type === "jobUpdate") {
            // TODO: Validate payload structure for jobUpdate
            this.emit("jobUpdate", message.payload as JobCompletionUpdate);
          } else if (message.type === "heartbeat") {
            // TODO: Validate payload structure for heartbeat
            this.emit("heartbeat", message.payload);
          } else {
            // Emit generic message event for other types
            this.emit("message", message);
          }
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          log("error", `Invalid IPC message format received`, {
            rawLine: line,
            error: error.errors
          });
        } else if (error instanceof SyntaxError) {
          log("error", `Invalid JSON received on stdin`, { rawLine: line });
        } else {
          log("error", `Failed to handle IPC message from stdin`, { rawLine: line, error });
        }
        this.emit("error", new Error(`Failed to process IPC message: ${line}`));
      }
    }
  }

  // --- Public Methods for Sending Messages ---

  /**
   * Sends a command specifically to the crawler process via the supervisor.
   * @param command The command object for the crawler.
   */
  public sendCommandToCrawler(command: CrawlerCommand): void {
    this.sendMessage({
      target: "crawler",
      type: command.type, // Use command type directly
      payload: command // Send the whole command as payload
    });
  }

  /**
   * Sends a generic command or message to the supervisor.
   * @param type The message type identifier.
   * @param payload Optional payload data.
   */
  public sendCommandToSupervisor(type: string, payload?: unknown): void {
    this.sendMessage({
      target: "supervisor",
      type: type,
      payload: payload
    });
  }

  /**
   * Sends a message to be broadcast to all other connected processes (e.g., crawler).
   * Use with caution.
   * @param type The message type identifier.
   * @param payload Optional payload data.
   */
  public sendBroadcast(type: string, payload?: unknown): void {
    this.sendMessage({
      target: "broadcast",
      type: type,
      payload: payload
    });
  }

  // --- Internal Generic Sender ---
  private sendMessage(args: SendMessageArgs): void {
    // Ensure IPC is available (check environment variable again, though constructor does too)
    if (process.env.SUPERVISED_PROCESS !== "backend") {
      log("error", "Cannot send message: Not running under supervisor.");
      return;
    }
    try {
      const message = {
        source: "backend", // Always set source as backend
        target: args.target,
        type: args.type,
        payload: args.payload
      };
      const messageString = `IPC_MSG::${JSON.stringify(message)}\n`; // Add prefix
      safeStdoutWrite(messageString);
      // log('info', `Sent message type '${message.type}' to ${message.target}`);
    } catch (error) {
      log("error", `Failed to stringify or send message`, { args, error });
      this.emit("error", new Error(`Failed to send IPC message: ${args.type}`));
    }
  }

  // --- Type-safe Event Subscription Methods (Examples) ---

  public onStatusUpdate(listener: (status: CrawlerStatus) => void): this {
    return this.on("statusUpdate", listener);
  }

  public onJobUpdate(listener: (update: JobCompletionUpdate) => void): this {
    return this.on("jobUpdate", listener);
  }

  public onHeartbeat(listener: (payload: unknown) => void): this {
    // Changed any to unknown
    return this.on("heartbeat", listener);
  }

  public onShutdown(listener: (signal?: string) => void): this {
    return this.on("shutdown", listener);
  }

  public onDisconnected(listener: () => void): this {
    return this.on("disconnected", listener);
  }

  // Add off/removeListener methods if needed for cleanup
  public removeAllListeners(event?: string | symbol | undefined): this {
    return super.removeAllListeners(event);
  }
}

// Export a singleton instance for easy reuse across the backend.
// Ensure this runs only on the server-side.
let messageBusClientInstance: MessageBusClient | null = null;

if (typeof process !== "undefined" && process.env && process.env.SUPERVISED_PROCESS === "backend") {
  messageBusClientInstance = new MessageBusClient();
} else if (typeof process !== "undefined") {
  // Log if running in Node.js but not supervised (e.g., during build?)
  // console.debug('[MessageBusClient] Not running under supervisor, IPC client not initialized.');
}

export default messageBusClientInstance; // May be null if not supervised
