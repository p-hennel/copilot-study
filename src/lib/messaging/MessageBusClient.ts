// src/lib/messaging/MessageBusClient.ts - Unix Socket IPC implementation
import { Socket } from "bun";
import { EventEmitter } from "events";
import { existsSync } from "fs";
import { z } from "zod";

// Import types for crawler communication
import { getLogger, type Logger } from "@logtape/logtape";
import type { JobCompletionUpdate } from "../../crawler/jobManager";
import type {
  CrawlerCommand,
  CrawlerStatus
} from "../../crawler/types";

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

  constructor() {
    super();
    
    // Configure process ID and socket path
    this.id = process.env.SUPERVISOR_PROCESS_ID || "web-server";
    this.socketPath = process.env.SUPERVISOR_SOCKET_PATH || "";
    
    if (!this.socketPath) {
      throw new Error("SUPERVISOR_SOCKET_PATH environment variable not set");
    }
    
    this.logger = getLogger(["messageBus", this.id]);
    this.logger.info("MessageBusClient initializing with Unix socket IPC...");
    
    // Check if socket path exists
    const socketDir = this.socketPath.substring(0, this.socketPath.lastIndexOf('/'));
    if (!existsSync(socketDir)) {
      this.logger.error(`Socket directory does not exist: ${socketDir}`);
      throw new Error(`Socket directory does not exist: ${socketDir}`);
    }
    
    // Connect to the socket
    this.connect();
  }
  
  /**
   * Connect to the supervisor socket
   */
  private async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    try {
      this.logger.info(`Connecting to supervisor via Unix socket: ${this.socketPath}`);
      
      // Check if socket exists
      if (!existsSync(this.socketPath)) {
        throw new Error(`Socket file does not exist: ${this.socketPath}`);
      }
      
      this.socket = await Bun.connect({
        unix: this.socketPath,
        socket: {
          data: (_socket, data) => this.handleSocketData(data),
          open: () => {
            this.connected = true;
            this.reconnectAttempts = 0;
            this.logger.info(`Connected to supervisor at ${this.socketPath}`);
            this.emit("connected");
            
            // Process queued messages
            this.processQueue();
            
            // Register with the supervisor
            this.sendCommandToSupervisor("register", { 
              id: this.id,
              pid: process.pid,
              type: "web-server"
            });
          },
          close: () => {
            this.connected = false;
            this.logger.warn("Disconnected from supervisor");
            this.emit("disconnected");
            this.scheduleReconnect();
          },
          error: (_socket, error) => {
            this.logger.error(`Socket error: ${error}`);
            this.emit("error", error);
          }
        }
      });
    } catch (err) {
      this.logger.error(`Failed to connect to supervisor: ${err}`);
      this.emit("error", err);
      this.scheduleReconnect();
    }
  }
  
  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    // Calculate backoff with jitter
    const baseDelay = 1000; // Start with 1 second
    const exponentialDelay = Math.min(
      baseDelay * Math.pow(1.5, this.reconnectAttempts),
      this.maxReconnectDelay
    );

    // Add jitter (±20%)
    const jitter = exponentialDelay * 0.2 * (Math.random() * 2 - 1);
    const delay = Math.floor(exponentialDelay + jitter);

    this.reconnectTimer = setTimeout(() => {
      this.logger.info(`Attempting to reconnect (attempt ${this.reconnectAttempts + 1})...`);
      this.reconnectAttempts++;
      this.connect().catch((err) => {
        this.logger.error(`Reconnection failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, delay);
  }
  
  /**
   * Handle incoming data from the socket
   */
  private handleSocketData(data: Buffer): void {
    try {
      const message = JSON.parse(data.toString()) as IPCMessage;
      
      // Validate the message format
      IPCMessageSchema.parse(message);
      
      // Check if message is intended for us
      if (message.destination !== this.id && message.destination !== "*") {
        this.logger.warn(`Received message for ${message.destination}, but our ID is ${this.id}`);
        return;
      }
      
      this.logger.debug(`Received ${message.type}:${message.key} from ${message.origin}`);
      
      // Handle different message types
      switch (message.type) {
        case MessageType.HEARTBEAT:
          this.emit("heartbeat", message.payload);
          break;
          
        case MessageType.MESSAGE:
          // Handle specific message types 
          if (message.key === "statusUpdate") {
            this.emit("statusUpdate", message.payload);
          } else if (message.key === "jobUpdate") {
            this.emit("jobUpdate", message.payload);
          } else if (message.key === "shutdown") {
            this.emit("shutdown", message.payload?.signal);
          } else {
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
    } catch (err) {
      if (err instanceof z.ZodError) {
        this.logger.error("Invalid message format received", { errors: err.errors });
      } else if (err instanceof SyntaxError) {
        this.logger.error("Invalid JSON received from socket");
      } else {
        this.logger.error(`Error processing message: ${err instanceof Error ? err.message : String(err)}`);
      }
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
      
      this.socket.write(JSON.stringify(message));
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
   * Clean up resources and disconnect
   */
  public disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
    
    this.connected = false;
  }
  
  // --- Typed event listeners ---
  
  public onStatusUpdate(listener: (status: CrawlerStatus) => void): this {
    return this.on("statusUpdate", listener);
  }

  public onJobUpdate(listener: (update: JobCompletionUpdate) => void): this {
    return this.on("jobUpdate", listener);
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
}

// Create a singleton instance for use throughout the application
let messageBusClientInstance: MessageBusClient | null = null;

// Only create the instance if we're in a Node.js environment and the socket path is set
if (
  typeof process !== "undefined" && 
  process.env && 
  process.env.SUPERVISOR_SOCKET_PATH
) {
  try {
    messageBusClientInstance = new MessageBusClient();
  } catch (err) {
    console.error("Failed to initialize MessageBusClient:", err);
  }
}

export default messageBusClientInstance; // May be null if initialization failed
