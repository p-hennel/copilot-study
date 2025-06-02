// src/lib/messaging/MessageBusClient.ts - Unix Socket IPC implementation
import type { Socket } from "bun";
import { EventEmitter } from "events";
import { existsSync } from "fs";
import { z } from "zod";

// Import types for crawler communication
import { getLogger, type Logger } from "@logtape/logtape";

// Module-level logger for singleton creation
const moduleLogger = getLogger(["messaging", "client", "module"]);

// Import database functionality for job management
import { db } from "$lib/server/db";
import { job } from "$lib/server/db/base-schema";
import { JobStatus } from "$lib/types";
import { eq } from "drizzle-orm";

// Import cache functions for persistent status storage
import {
  updateCrawlerStatus,
  updateMessageBusConnection,
  updateHeartbeat,
  addJobFailureLog
} from "$lib/stores/crawler-cache";
// TODO: Create these types if they don't exist
// For now using placeholder types to fix compilation errors
type JobCompletionUpdate = {
  jobId: string;
  success: boolean;
  result?: any;
  error?: string;
  status: "completed" | "failed" | "paused";
  timestamp: number;
};

type CrawlerCommand = {
  type: string;
  [key: string]: any;
};

type CrawlerStatus = {
  state: string;
  queuedJobs: number;
  runningJobs: number;
  running: boolean;
  paused: boolean;
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  [key: string]: any;
};

// --- Message Schema Validation ---
const IPCMessageSchema = z.object({
  origin: z.string(),
  destination: z.string(),
  type: z.string(),
  key: z.string(),
  payload: z.any().optional(),
  timestamp: z.number().optional()
});

type IPCMessage = z.infer<typeof IPCMessageSchema>;

// Message types enum (should match the supervisor's definitions)
enum MessageType {
  MESSAGE = "message",
  COMMAND = "command",
  STATE_CHANGE = "stateChange",
  HEARTBEAT = "heartbeat",
  SUBSCRIPTION = "subscription"
}

/**
 * MessageBusClient provides communication with the supervisor and other processes via Unix sockets.
 * It replaces the previous stdin/stdout implementation.
 */
export class MessageBusClient extends EventEmitter {
  private id: string = "web-server";  // Default ID for the web server process
  private socketPath: string;
  private socket: Socket | null = null;
  private connected: boolean = false;
  private reconnectTimer: Timer | null = null;
  private messageQueue: IPCMessage[] = [];
  private logger: Logger;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30000; // 30 seconds maximum
  private maxQueueLength = 1000;
  
  // Heartbeat timeout management
  private lastHeartbeatTime: number = 0;
  private heartbeatTimeoutTimer: Timer | null = null;
  private readonly HEARTBEAT_TIMEOUT = 30000; // 30 seconds - matches cache timeout

  constructor() {
    super();
    
    // Configure process ID and socket path
    this.id = process.env.SUPERVISOR_PROCESS_ID || "web-server";
    this.socketPath = process.env.SOCKET_PATH ||
                      process.env.SUPERVISOR_SOCKET_PATH ||
                      "/home/bun/data/config/api.sock";
    this.logger = getLogger(["messageBus", this.id]);
    
    this.logger.debug("MessageBusClient constructor:", {
      id: this.id,
      socketPath: this.socketPath,
      supervisorSocketPath: process.env.SUPERVISOR_SOCKET_PATH,
      socketPathEnv: process.env.SOCKET_PATH
    });
    
    if (!this.socketPath) {
      throw new Error("SUPERVISOR_SOCKET_PATH or SOCKET_PATH environment variable not set");
    }
  
    this.logger.debug("MessageBusClient initializing with Unix socket IPC...");
    this.logger.debug("MessageBusClient initializing with path:", { socketPath: this.socketPath });
    
    // Check if socket path exists - don't throw errors, just log warnings
    const socketDir = this.socketPath.substring(0, this.socketPath.lastIndexOf('/'));
    if (!existsSync(socketDir)) {
      this.logger.warn(`Socket directory does not exist: ${socketDir}`);
      this.logger.debug("Web server will start without external crawler connection. Connection will be attempted periodically.");
    } else {
      this.logger.debug("Socket directory exists:", { socketDir });
    }
    
    // Attempt initial connection but don't block startup
    this.connect();
  }
  
  /**
   * Start monitoring for heartbeat timeouts
   */
  private startHeartbeatMonitoring(): void {
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
    }
    
    this.heartbeatTimeoutTimer = setTimeout(() => {
      this.logger.warn("Heartbeat timeout - marking connection as lost");
      updateMessageBusConnection(false);
      this.emit("heartbeatTimeout");
      
      // Don't immediately reconnect on heartbeat timeout - let the existing reconnect logic handle it
      if (this.connected) {
        this.logger.warn("Heartbeat timeout detected while socket appears connected - forcing disconnect");
        this.socket?.end();
      }
    }, this.HEARTBEAT_TIMEOUT);
  }
  
  /**
   * Reset heartbeat timeout timer when heartbeat is received
   */
  private resetHeartbeatTimeout(): void {
    this.lastHeartbeatTime = Date.now();
    this.startHeartbeatMonitoring();
  }
  
  /**
   * Stop heartbeat monitoring
   */
  private stopHeartbeatMonitoring(): void {
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }
  
  /**
   * Connect to the supervisor socket
   */
  private async connect(): Promise<boolean> {
    this.logger.debug("MessageBusClient.connect() called", { connected: this.connected });
    if (this.connected) {
      return true;
    }

    try {
      this.logger.debug(`Connecting to supervisor via Unix socket: ${this.socketPath}`);
      this.logger.debug(`Attempting to connect to Unix socket: ${this.socketPath}`);
      
      // Check if socket exists - don't throw error, just warn and return false
      if (!existsSync(this.socketPath)) {
        this.logger.warn(`Socket file does not exist: ${this.socketPath}`);
        this.logger.debug("External crawler not available. Connection will be retried later.");
        this.scheduleReconnect();
        return false;
      }
      
      this.logger.debug("Socket file exists, creating Bun.connect...");
      
      this.socket = await Bun.connect({
        unix: this.socketPath,
        socket: {
          data: (_socket, data) => {
            this.logger.debug("MessageBusClient received data:", { data: data.toString() });
            this.handleSocketData(data);
          },
          open: () => {
            this.connected = true;
            this.reconnectAttempts = 0;
            this.logger.debug(`Connected to supervisor at ${this.socketPath}`);
            
            // Update cache with connection status
            updateMessageBusConnection(true);
            
            // Start monitoring heartbeats
            this.resetHeartbeatTimeout();
            
            this.emit("connected");
              
            // Process queued messages
            this.processQueue();
            
            // Register with the external crawler
            this.sendMessage({
              origin: this.id,
              destination: "external-crawler",
              type: MessageType.COMMAND,
              key: "register",
              payload: {
                id: this.id,
                pid: process.pid,
                type: "web-server"
              },
              timestamp: Date.now()
            });
          },
          close: () => {
            this.connected = false;
            this.logger.warn("Disconnected from supervisor");
            
            // Stop heartbeat monitoring
            this.stopHeartbeatMonitoring();
            
            // Update cache with connection status
            updateMessageBusConnection(false);
            
            this.emit("disconnected");
            
            // Reset running jobs to queued when connection is lost
            this.resetRunningJobsToQueued();
            
            this.scheduleReconnect();
          },
          error: (_socket, error) => {
            this.logger.error(`Socket error: ${error}`);
            
            // Stop heartbeat monitoring
            this.stopHeartbeatMonitoring();
            
            // Update cache with connection status
            updateMessageBusConnection(false);
            
            this.emit("error", error);
            
            // Reset running jobs on socket error as this indicates connection loss
            this.resetRunningJobsToQueued();
          }
        }
      });
      
      this.logger.debug("Bun.connect created", { hasSocket: !!this.socket });
      return true;
    } catch (err) {
      this.logger.warn(`Failed to connect to supervisor: ${err}`);
      this.emit("error", err);
      this.scheduleReconnect();
      return false;
    }
  }
  
  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    // Calculate backoff with jitter - start with longer delays
    const baseDelay = 5000; // Start with 5 seconds
    const exponentialDelay = Math.min(
      baseDelay * Math.pow(1.5, this.reconnectAttempts),
      this.maxReconnectDelay
    );

    // Add jitter (±20%)
    const jitter = exponentialDelay * 0.2 * (Math.random() * 2 - 1);
    const delay = Math.floor(exponentialDelay + jitter);

    this.reconnectTimer = setTimeout(async () => {
      this.logger.debug(`Attempting to reconnect to external crawler (attempt ${this.reconnectAttempts + 1})...`);
      this.reconnectAttempts++;
      
      const connected = await this.connect();
      if (!connected) {
        // Only log every 5th attempt to reduce noise
        if (this.reconnectAttempts % 5 === 0) {
          this.logger.debug(`Still waiting for external crawler connection (${this.reconnectAttempts} attempts). Next retry in ${Math.floor(delay/1000)}s`);
        }
      }
    }, delay);
  }
  
  /**
   * Handle incoming data from the socket
   */
  private handleSocketData(data: Buffer): void {
    const dataStr = data.toString();
    this.logger.debug("MessageBusClient: Raw data received:", { dataStr });
    
    // Handle multiple concatenated JSON messages
    const messages = this.parseMultipleJsonMessages(dataStr);
    
    for (const message of messages) {
      try {
        // Validate the message format
        IPCMessageSchema.parse(message);
        
        // Check if message is intended for us
        if (message.destination !== this.id && message.destination !== "*") {
          this.logger.warn(`Received message for ${message.destination}, but our ID is ${this.id}`);
          continue;
        }
        
        this.logger.debug(`Received ${message.type}:${message.key} from ${message.origin}`);
        this.processMessage(message);
      } catch (err) {
        if (err instanceof z.ZodError) {
          this.logger.error("Invalid message format received", { errors: err.errors });
        } else {
          this.logger.error(`Error processing individual message: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }
  
  /**
   * Parse multiple concatenated JSON messages from a string
   */
  private parseMultipleJsonMessages(dataStr: string): IPCMessage[] {
    const messages: IPCMessage[] = [];
    let currentPos = 0;
    
    while (currentPos < dataStr.length) {
      try {
        // Find the end of the current JSON object
        let braceCount = 0;
        let inString = false;
        let escaped = false;
        let jsonStart = currentPos;
        let jsonEnd = currentPos;
        
        // Skip any whitespace at the beginning
        while (jsonStart < dataStr.length && /\s/.test(dataStr.charAt(jsonStart))) {
          jsonStart++;
        }
        
        if (jsonStart >= dataStr.length) break;
        
        // Parse JSON object by counting braces
        for (let i = jsonStart; i < dataStr.length; i++) {
          const char = dataStr[i];
          
          if (escaped) {
            escaped = false;
            continue;
          }
          
          if (char === '\\' && inString) {
            escaped = true;
            continue;
          }
          
          if (char === '"') {
            inString = !inString;
            continue;
          }
          
          if (!inString) {
            if (char === '{') {
              braceCount++;
            } else if (char === '}') {
              braceCount--;
              if (braceCount === 0) {
                jsonEnd = i + 1;
                break;
              }
            }
          }
        }
        
        if (braceCount === 0 && jsonEnd > jsonStart) {
          const jsonStr = dataStr.substring(jsonStart, jsonEnd);
          const message = JSON.parse(jsonStr) as IPCMessage;
          messages.push(message);
          currentPos = jsonEnd;
        } else {
          // Invalid JSON or incomplete, skip
          break;
        }
      } catch (parseErr) {
        this.logger.error("MessageBusClient: Failed to parse JSON", { position: currentPos, error: parseErr });
        // Try to find the next '{' to continue parsing
        currentPos = dataStr.indexOf('{', currentPos + 1);
        if (currentPos === -1) break;
      }
    }
    
    return messages;
  }
  
  /**
   * Process a validated message
   */
  private processMessage(message: IPCMessage): void {
    this.logger.debug("MessageBusClient: Processing message:", { type: message.type, key: message.key });
    this.logger.debug("MessageBusClient: Full message:", { message });
      
    // Handle different message types
    switch (message.type) {
      case MessageType.HEARTBEAT: {
        this.logger.debug("MessageBusClient: Processing HEARTBEAT");
        
        // Reset heartbeat timeout on received heartbeat
        this.resetHeartbeatTimeout();
        
        // Update cache with heartbeat
        const heartbeatTimestamp = message.payload?.timestamp || message.timestamp || new Date().toISOString();
        updateHeartbeat(heartbeatTimestamp);
        this.emit("heartbeat", message.payload);
        break;
      }
        
      case MessageType.MESSAGE:
        this.logger.debug("MessageBusClient: Processing MESSAGE", { key: message.key });
        // Handle specific message types
        if (message.key === "statusUpdate") {
          this.logger.debug("MessageBusClient: Emitting statusUpdate");
          // Update cache with status
          if (message.payload) {
            updateCrawlerStatus(message.payload);
          }
          this.emit("statusUpdate", message.payload);
        } else if (message.key === "jobUpdate") {
          this.logger.debug("MessageBusClient: Emitting jobUpdate");
          this.emit("jobUpdate", message.payload);
        } else if (message.key === "JOB_FAILURE_LOGS") {
          this.logger.debug("MessageBusClient: Received JOB_FAILURE_LOGS, emitting jobFailure event", { payload: message.payload });
          // Update cache with job failure log
          if (message.payload) {
            addJobFailureLog(message.payload);
          }
          this.emit("jobFailure", message.payload);
          this.logger.debug("MessageBusClient: jobFailure event emitted");
        } else if (message.key === "TOKEN_REFRESH_REQUEST") {
          this.logger.debug("MessageBusClient: TOKEN_REFRESH_REQUEST RECEIVED");
          this.logger.debug("MessageBusClient: Payload:", { payload: message.payload });
          this.logger.debug("MessageBusClient: Emitting tokenRefreshRequest event...");
          this.emit("tokenRefreshRequest", message.payload);
          this.logger.debug("MessageBusClient: tokenRefreshRequest event emitted successfully");
        } else if (message.key === "shutdown") {
          this.logger.debug("MessageBusClient: Processing shutdown");
          this.emit("shutdown", message.payload?.signal);
        } else {
          this.logger.debug("MessageBusClient: Generic message, emitting 'message' event");
          // Generic message
          this.emit("message", message);
        }
        break;
        
      case MessageType.COMMAND:
        // Handle commands
        this.emit("command", message.key, message.payload);
        break;
        
      default:
        this.logger.warn(`Unknown message type: ${message.type}`);
    }
  }
  
  /**
   * Process any queued messages
   */
  private processQueue(): void {
    if (!this.connected || !this.socket) {
      return;
    }
    
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift()!;
      this.sendRawMessage(message);
    }
  }
  
  /**
   * Queue a message for sending, pruning if necessary
   */
  private queueMessage(message: IPCMessage): void {
    this.messageQueue.push(message);
    
    // Prune if too many messages
    if (this.messageQueue.length > this.maxQueueLength) {
      this.logger.warn(`Message queue exceeded limit (${this.maxQueueLength}), pruning oldest messages`);
      this.messageQueue = this.messageQueue.slice(-Math.floor(this.maxQueueLength * 0.8)); // Keep 80% newest
    }
  }
  
  /**
   * Send a raw message to the socket
   */
  private sendRawMessage(message: IPCMessage): void {
    try {
      if (!this.socket) {
        throw new Error("Not connected to supervisor");
      }
      
      // Ensure timestamp is set
      if (!message.timestamp) {
        message.timestamp = Date.now();
      }
      
      const messageStr = JSON.stringify(message);
      this.logger.debug("MessageBusClient sending message:", { messageStr });
      this.socket.write(messageStr);
      this.logger.debug(`Sent ${message.type}:${message.key} to ${message.destination}`);
    } catch (err) {
      this.logger.error(`Failed to send message: ${err instanceof Error ? err.message : String(err)}`);
      this.queueMessage(message);
    }
  }
  
  /**
   * Send a message via the socket
   */
  private sendMessage(message: IPCMessage): void {
    if (!this.connected || !this.socket) {
      this.queueMessage(message);
      return;
    }
    
    this.sendRawMessage(message);
  }
  
  // --- Public API methods ---

  /**
   * Get the current connection status
   */
  public isConnected(): boolean {
    return this.connected;
  }

  /**
   * Sends a command specifically to the crawler process.
   * @param command The command object for the crawler.
   */
  public sendCommandToCrawler(command: CrawlerCommand): void {
    this.sendMessage({
      origin: this.id,
      destination: "crawler",
      type: MessageType.COMMAND,
      key: command.type,
      payload: command,
      timestamp: Date.now()
    });
  }

  /**
   * Sends a START_JOB command to the external crawler
   * @param jobData The job data to send to the crawler
   */
  public sendStartJobToCrawler(jobData: any): void {
    this.sendMessage({
      origin: this.id,
      destination: "external-crawler",
      type: MessageType.COMMAND,
      key: "START_JOB",
      payload: jobData,
      timestamp: Date.now()
    });
  }

  /**
   * Sends a command to the supervisor.
   * @param key The command key
   * @param payload Optional payload data
   */
  public sendCommandToSupervisor(key: string, payload?: unknown): void {
    this.sendMessage({
      origin: this.id,
      destination: "supervisor",
      type: MessageType.COMMAND,
      key,
      payload,
      timestamp: Date.now()
    });
  }

  /**
   * Sends a message to a specific destination.
   * @param destination The target process ID
   * @param key The message key
   * @param payload Optional payload data
   */
  public sendMessageTo(destination: string, key: string, payload?: unknown): void {
    this.sendMessage({
      origin: this.id,
      destination,
      type: MessageType.MESSAGE,
      key,
      payload,
      timestamp: Date.now()
    });
  }

  /**
   * Broadcasts a message to all processes by using the "*" destination.
   * @param key The message key
   * @param payload Optional payload data
   */
  public broadcastMessage(key: string, payload?: unknown): void {
    this.sendMessage({
      origin: this.id,
      destination: "*", // Broadcast
      type: MessageType.MESSAGE,
      key,
      payload,
      timestamp: Date.now()
    });
  }

  /**
   * Sends a heartbeat to the supervisor.
   * @param payload Optional payload with status information
   */
  public sendHeartbeat(payload?: any): void {
    this.sendMessage({
      origin: this.id,
      destination: "supervisor",
      type: MessageType.HEARTBEAT,
      key: "heartbeat",
      payload: {
        timestamp: Date.now(),
        ...payload
      },
      timestamp: Date.now()
    });
  }
  
  /**
   * Reset all running jobs to queued status when crawler connection is lost
   */
  private async resetRunningJobsToQueued(): Promise<void> {
    try {
      this.logger.info("Connection to crawler lost - resetting running jobs to queued status");
      
      const result = await db
        .update(job)
        .set({
          status: JobStatus.queued,
          started_at: null // Reset start time since job will need to restart
        })
        .where(eq(job.status, JobStatus.running));
      
      if (result.rowsAffected > 0) {
        this.logger.debug(`Successfully reset ${result.rowsAffected} running jobs to queued status`);
      } else {
        this.logger.debug("No running jobs found to reset");
      }
    } catch (error) {
      this.logger.error("Failed to reset running jobs to queued status:", { error });
    }
  }

  /**
   * Clean up resources and disconnect
   */
  public disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    // Stop heartbeat monitoring
    this.stopHeartbeatMonitoring();
    
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
    
    this.connected = false;
    
    // Update cache with disconnection
    updateMessageBusConnection(false);
  }
  
  // --- Typed event listeners ---
  
  public onStatusUpdate(listener: (status: CrawlerStatus) => void): this {
    return this.on("statusUpdate", listener);
  }

  public onJobUpdate(listener: (update: JobCompletionUpdate) => void): this {
    return this.on("jobUpdate", listener);
  }

  public onJobFailure(listener: (failureData: any) => void): this {
    return this.on("jobFailure", listener);
  }

  public onHeartbeat(listener: (payload: unknown) => void): this {
    return this.on("heartbeat", listener);
  }

  public onShutdown(listener: (signal?: string) => void): this {
    return this.on("shutdown", listener);
  }

  public onDisconnected(listener: () => void): this {
    return this.on("disconnected", listener);
  }

  public onTokenRefreshRequest(listener: (requestData: any) => void): this {
    return this.on("tokenRefreshRequest", listener);
  }

  /**
   * Send a token refresh response back to the crawler
   */
  public sendTokenRefreshResponse(requestId: string, response: {
    success: boolean;
    accessToken?: string;
    expiresAt?: string;
    refreshToken?: string;
    providerId?: string;
    error?: string;
  }): void {
    this.logger.debug("sendTokenRefreshResponse called", {
      requestId,
      response,
      connected: this.connected,
      hasSocket: !!this.socket
    });
    
    const message = {
      origin: this.id,
      destination: "external-crawler",
      type: MessageType.MESSAGE,
      key: "TOKEN_REFRESH_RESPONSE",
      payload: {
        requestId,
        ...response
      },
      timestamp: Date.now()
    };
    
    this.logger.debug("Sending TOKEN_REFRESH_RESPONSE message:", { message });
    this.sendMessage(message);
    this.logger.debug("TOKEN_REFRESH_RESPONSE message sent successfully");
  }
}

// Create a singleton instance for use throughout the application
let messageBusClientInstance: MessageBusClient | null = null;

const logger = getLogger(["messaging", "client", "singleton"]);

// Debug logging for singleton creation
logger.debug("MessageBusClient module loading...");
logger.info("Environment check:", {
  hasProcess: typeof process !== "undefined",
  hasEnv: typeof process !== "undefined" && !!process.env,
  supervisorSocketPath: process?.env?.SUPERVISOR_SOCKET_PATH,
  socketPath: process?.env?.SOCKET_PATH
});

// Only create the instance if we're in a Node.js environment
if (typeof process !== "undefined" && process.env) {
  try {
    if (process.env.SOCKET_PATH) {
      moduleLogger.debug("Creating MessageBusClient instance with SOCKET_PATH");
    } else if (process.env.SUPERVISOR_SOCKET_PATH) {
      moduleLogger.debug("Creating MessageBusClient instance with SUPERVISOR_SOCKET_PATH");
    } else {
      moduleLogger.debug("Creating MessageBusClient instance with fallback path");
    }
    messageBusClientInstance = new MessageBusClient();
    moduleLogger.debug("MessageBusClient instance created successfully");
  } catch (err) {
    moduleLogger.warn("MessageBusClient initialization had issues, but server can continue:", { error: err });
    // Still create the instance to provide graceful degradation
    try {
      messageBusClientInstance = new MessageBusClient();
    } catch (finalErr) {
      moduleLogger.error("Failed to create MessageBusClient instance entirely:", { error: finalErr });
      messageBusClientInstance = null;
    }
  }
}

moduleLogger.debug("MessageBusClient singleton created:", { created: !!messageBusClientInstance });

export default messageBusClientInstance; // May be null if initialization failed
