// src/lib/messaging/DirectCommunicationClient.ts - Direct Unix Socket Communication Client
import type { Socket } from "bun";
import { EventEmitter } from "events";
import { existsSync } from "fs";
import { z } from "zod";
import { getLogger, type Logger } from "@logtape/logtape";

// Message Schema Validation - Compatible with crawlz MessageBusSocket
const IPCMessageSchema = z.object({
  origin: z.string(),
  destination: z.string(),
  type: z.string(),
  key: z.string(),
  payload: z.any().optional(),
  timestamp: z.number().optional()
});

type IPCMessage = z.infer<typeof IPCMessageSchema>;

// Message types enum - matches crawlz protocol
export enum MessageType {
  MESSAGE = "message",
  COMMAND = "command", 
  HEARTBEAT = "heartbeat",
  JOB_REQUEST = "jobRequest",
  JOB_RESPONSE = "jobResponse",
  PROGRESS_UPDATE = "progressUpdate"
}

// Response types for structured communication
export interface JobRequestResponse {
  success: boolean;
  jobs?: any[];
  error?: string;
  requestId?: string;
}

export interface TokenRefreshResponse {
  success: boolean;
  accessToken?: string;
  expiresAt?: string;
  refreshToken?: string;
  providerId?: string;
  error?: string;
}

export interface ProgressUpdatePayload {
  taskId: string;
  status: string;
  timestamp?: string;
  processedItems?: number;
  totalItems?: number;
  currentDataType?: string;
  message?: string;
  error?: string | Record<string, any>;
  progress?: any;
  areas?: any[];
  credentialStatus?: any;
  [key: string]: any;
}

/**
 * DirectCommunicationClient provides direct Unix socket communication with crawlz
 * Replaces the supervisor-based MessageBusClient architecture
 */
export class DirectCommunicationClient extends EventEmitter {
  private id: string = "copilot-study";
  private socketPath: string;
  private socket: Socket | null = null;
  private connected: boolean = false;
  private reconnectTimer: Timer | null = null;
  private messageQueue: IPCMessage[] = [];
  private logger: Logger;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30000; // 30 seconds
  private maxQueueLength = 1000;
  
  // Connection health monitoring
  private lastHeartbeatTime: number = 0;
  private heartbeatTimeoutTimer: Timer | null = null;
  private readonly HEARTBEAT_TIMEOUT = 30000; // 30 seconds
  
  // Message deduplication
  private processedMessages = new Set<string>();
  private readonly maxProcessedMessages = 1000;
  private messageCooldown = new Map<string, number>();
  private readonly cooldownPeriod = 5000; // 5 seconds
  
  // Circuit breaker for connection stability
  private connectionFailures = 0;
  private readonly maxConnectionFailures = 5;
  private circuitBreakerOpen = false;
  private circuitBreakerResetTime = 0;
  private readonly circuitBreakerTimeout = 30000; // 30 seconds

  constructor(socketPath?: string) {
    super();
    
    this.id = process.env.COPILOT_PROCESS_ID || "web-server";
    this.socketPath = socketPath || process.env.SOCKET_PATH || "/home/bun/data/config/api.sock";
    this.logger = getLogger(["messaging", "direct-client", this.id]);
    
    this.logger.debug("DirectCommunicationClient constructor:", {
      id: this.id,
      socketPath: this.socketPath
    });
    
    if (!this.socketPath) {
      throw new Error("SOCKET_PATH environment variable not set");
    }
    
    this.logger.info("DirectCommunicationClient initializing with Unix socket...");
    
    // Check socket directory
    const socketDir = this.socketPath.substring(0, this.socketPath.lastIndexOf('/'));
    if (!existsSync(socketDir)) {
      this.logger.warn(`Socket directory does not exist: ${socketDir}`);
      this.logger.debug("Will start without crawler connection. Connection will be attempted periodically.");
    }
    
    // Attempt initial connection
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
      this.emit("heartbeatTimeout");
      
      if (this.connected) {
        this.logger.warn("Heartbeat timeout detected while socket appears connected - forcing disconnect");
        this.socket?.end();
      }
    }, this.HEARTBEAT_TIMEOUT);
  }
  
  /**
   * Reset heartbeat timeout when heartbeat is received
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
   * Connect to the crawlz socket
   */
  private async connect(): Promise<boolean> {
    try {
      this.logger.debug("DirectCommunicationClient.connect() called", {
        connected: this.connected,
        circuitBreakerOpen: this.circuitBreakerOpen,
        connectionFailures: this.connectionFailures
      });
      
      if (this.connected) {
        return true;
      }

      // Check circuit breaker
      if (this.circuitBreakerOpen) {
        if (Date.now() < this.circuitBreakerResetTime) {
          this.logger.debug("Circuit breaker is open, skipping connection attempt");
          return false;
        } else {
          this.logger.info("Circuit breaker timeout expired, attempting to reset");
          this.circuitBreakerOpen = false;
          this.connectionFailures = 0;
        }
      }

      this.logger.debug(`Connecting to crawlz via Unix socket: ${this.socketPath}`);
      
      // Check if socket exists
      if (!existsSync(this.socketPath)) {
        this.logger.warn(`Socket file does not exist: ${this.socketPath}`);
        this.logger.debug("Crawler not available. Connection will be retried later.");
        this.scheduleReconnect();
        return false;
      }
      
      this.logger.debug("Socket file exists, creating Bun.connect...");
      
      this.socket = await Bun.connect({
        unix: this.socketPath,
        socket: {
          data: (_socket, data) => {
            try {
              this.logger.debug("DirectCommunicationClient received data:", { data: data.toString() });
              this.handleSocketData(data);
            } catch (error: any) { 
              this.logger.error("Error handling socket data:", { error }); 
            }
          },
          open: () => {
            try {
              this.connected = true;
              this.reconnectAttempts = 0;
              
              // Reset circuit breaker on successful connection
              this.connectionFailures = 0;
              this.circuitBreakerOpen = false;
              
              this.logger.info(`✅ DIRECT: Connected to crawlz at ${this.socketPath}`);
              
              // Start monitoring heartbeats
              this.resetHeartbeatTimeout();
              
              this.emit("connected");
                
              // Process queued messages
              this.processQueue();
              
              // Register with crawlz
              this.sendMessage({
                origin: this.id,
                destination: "external-crawler",
                type: MessageType.COMMAND,
                key: "register",
                payload: {
                  id: this.id,
                  pid: process.pid,
                  type: "copilot-study"
                },
                timestamp: Date.now()
              });
            } catch (error: any) { 
              this.logger.error("Error in socket open handler:", { error }); 
            }
          },
          close: () => {
            try {
              this.connected = false;
              this.logger.warn("Disconnected from crawlz");
              
              // Stop heartbeat monitoring
              this.stopHeartbeatMonitoring();
              
              this.emit("disconnected");
              
              this.scheduleReconnect();
            } catch (error: any) { 
              this.logger.error("Error in socket close handler:", { error }); 
            }
          },
          error: (_socket, error) => {
            try {
              this.logger.error(`Socket error: ${error}`);
              
              // Stop heartbeat monitoring
              this.stopHeartbeatMonitoring();
              
              this.emit("error", error);
            } catch (error: any) { 
              this.logger.error("Error in socket error handler:", { error }); 
            }
          }
        }
      });
      
      this.logger.debug("Bun.connect created", { hasSocket: !!this.socket });
      return true;
    } catch (err) {
      this.connectionFailures++;
      this.logger.warn(`❌ DIRECT: Failed to connect to crawlz (attempt ${this.connectionFailures}): ${err}`);
      
      // Check if we should open the circuit breaker
      if (this.connectionFailures >= this.maxConnectionFailures) {
        this.circuitBreakerOpen = true;
        this.circuitBreakerResetTime = Date.now() + this.circuitBreakerTimeout;
        this.logger.error(`🚨 DIRECT: Circuit breaker opened after ${this.connectionFailures} failures. Will retry after ${this.circuitBreakerTimeout / 1000}s`);
      }
      
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

    // Calculate backoff with jitter
    const baseDelay = 5000; // Start with 5 seconds
    const exponentialDelay = Math.min(
      baseDelay * Math.pow(1.5, this.reconnectAttempts),
      this.maxReconnectDelay
    );

    // Add jitter (±20%)
    const jitter = exponentialDelay * 0.2 * (Math.random() * 2 - 1);
    const delay = Math.floor(exponentialDelay + jitter);

    this.reconnectTimer = setTimeout(async () => {
      this.logger.debug(`Attempting to reconnect to crawlz (attempt ${this.reconnectAttempts + 1})...`);
      this.reconnectAttempts++;
      
      const connected = await this.connect();
      if (!connected) {
        // Only log every 5th attempt to reduce noise
        if (this.reconnectAttempts % 5 === 0) {
          this.logger.debug(`Still waiting for crawlz connection (${this.reconnectAttempts} attempts). Next retry in ${Math.floor(delay/1000)}s`);
        }
      }
    }, delay);
  }
  
  /**
   * Handle incoming data from the socket
   */
  private handleSocketData(data: Buffer): void {
    const dataStr = data.toString();
    this.logger.debug("DirectCommunicationClient: Raw data received:", { dataStr });
    
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
        this.logger.error("DirectCommunicationClient: Failed to parse JSON", { position: currentPos, error: parseErr });
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
    this.logger.debug("DirectCommunicationClient: Processing message:", { type: message.type, key: message.key });
      
    // Handle different message types
    switch (message.type) {
      case MessageType.HEARTBEAT: {
        this.logger.debug("DirectCommunicationClient: Processing HEARTBEAT");
        
        // Reset heartbeat timeout on received heartbeat
        this.resetHeartbeatTimeout();
        
        this.emit("heartbeat", message.payload);
        break;
      }
        
      case MessageType.MESSAGE:
        this.logger.debug("DirectCommunicationClient: Processing MESSAGE", { key: message.key });
        
        if (message.key === "statusUpdate") {
          this.emit("statusUpdate", message.payload);
        } else if (message.key === "jobUpdate") {
          this.emit("jobUpdate", message.payload);
        } else if (message.key === "PROGRESS_UPDATE") {
          this.logger.debug("DirectCommunicationClient: Received PROGRESS_UPDATE", { payload: message.payload });
          
          // Message deduplication
          const taskId = message.payload?.taskId;
          const timestamp = message.payload?.timestamp;
          if (taskId && timestamp) {
            const progressKey = `PROGRESS_${taskId}_${timestamp}`;
            const now = Date.now();
            
            // Check if already processed
            if (this.processedMessages.has(progressKey)) {
              this.logger.warn("Duplicate PROGRESS_UPDATE blocked", { taskId, timestamp });
              return;
            }
            
            // Check cooldown period
            const lastProcessed = this.messageCooldown.get(progressKey);
            if (lastProcessed && (now - lastProcessed) < 1000) { // 1 second cooldown
              this.logger.warn("PROGRESS_UPDATE in cooldown period", {
                taskId,
                timestamp,
                timeSinceLastProcessed: now - lastProcessed
              });
              return;
            }
            
            // Mark as processed
            this.processedMessages.add(progressKey);
            this.messageCooldown.set(progressKey, now);
          }
          
          this.emit("progressUpdate", message.payload);
        } else if (message.key === "TOKEN_REFRESH_REQUEST") {
          this.logger.debug("DirectCommunicationClient: TOKEN_REFRESH_REQUEST RECEIVED");
          
          // Message deduplication
          const requestId = message.payload?.requestId;
          if (requestId) {
            const messageKey = `TOKEN_REFRESH_${requestId}`;
            const now = Date.now();
            
            // Check if already processed
            if (this.processedMessages.has(messageKey)) {
              this.logger.warn("Duplicate TOKEN_REFRESH_REQUEST blocked", { requestId });
              return;
            }
            
            // Check cooldown period
            const lastProcessed = this.messageCooldown.get(messageKey);
            if (lastProcessed && (now - lastProcessed) < this.cooldownPeriod) {
              this.logger.warn("TOKEN_REFRESH_REQUEST in cooldown period", {
                requestId,
                timeSinceLastProcessed: now - lastProcessed
              });
              return;
            }
            
            // Mark as processed
            this.processedMessages.add(messageKey);
            this.messageCooldown.set(messageKey, now);
            
            // Cleanup old entries to prevent memory leak
            if (this.processedMessages.size > this.maxProcessedMessages) {
              const oldestEntries = Array.from(this.processedMessages).slice(0, 100);
              oldestEntries.forEach(entry => {
                this.processedMessages.delete(entry);
                this.messageCooldown.delete(entry);
              });
              this.logger.debug("Cleaned up old processed messages");
            }
          }
          
          this.emit("tokenRefreshRequest", message.payload);
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

      case MessageType.JOB_REQUEST:
        this.logger.debug("DirectCommunicationClient: Processing JOB_REQUEST", { key: message.key });
        // Handle job requests from crawler
        if (message.key === "request_jobs") {
          this.emit("jobRequest", message.payload);
        }
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
    try {
      this.messageQueue.push(message);
      
      // Prune if too many messages
      if (this.messageQueue.length > this.maxQueueLength) {
        this.logger.warn(`Message queue exceeded limit (${this.maxQueueLength}), pruning oldest messages`);
        this.messageQueue = this.messageQueue.slice(-Math.floor(this.maxQueueLength * 0.8)); // Keep 80% newest
      }
    } catch (error: any) {
      this.logger.error("Error queueing message:", { error });
    }
  }
  
  /**
   * Send a raw message to the socket
   */
  private sendRawMessage(message: IPCMessage): void {
    try {
      if (!this.socket) {
        throw new Error("Not connected to crawlz");
      }
      
      // Ensure timestamp is set
      if (!message.timestamp) {
        message.timestamp = Date.now();
      }
      
      const messageStr = JSON.stringify(message);
      this.logger.debug("DirectCommunicationClient sending message:", { messageStr });
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
   * Sends a job response to the external crawler
   * @param jobs Array of jobs available for processing
   */
  public sendJobResponseToCrawler(jobs: any[]): void {
    this.sendMessage({
      origin: this.id,
      destination: "external-crawler",
      type: MessageType.JOB_RESPONSE,
      key: "jobs_available",
      payload: jobs,
      timestamp: Date.now()
    });
  }

  /**
   * Sends a job error response to the external crawler
   * @param error The error message
   * @param requestId Optional request ID for tracking
   */
  public sendJobErrorToCrawler(error: string, requestId?: string): void {
    this.sendMessage({
      origin: this.id,
      destination: "external-crawler",
      type: MessageType.JOB_RESPONSE,
      key: "jobs_error",
      payload: { error, requestId },
      timestamp: Date.now()
    });
  }

  /**
   * Sends a token refresh response to the crawler
   * @param requestId The request ID from the original request
   * @param response The token refresh response data
   */
  public sendTokenRefreshResponse(requestId: string, response: TokenRefreshResponse): void {
    this.sendMessage({
      origin: this.id,
      destination: "external-crawler",
      type: MessageType.MESSAGE,
      key: "TOKEN_REFRESH_RESPONSE",
      payload: {
        requestId,
        ...response
      },
      timestamp: Date.now()
    });
  }

  /**
   * Sends a heartbeat to crawlz
   * @param payload Optional payload with status information
   */
  public sendHeartbeat(payload?: any): void {
    this.sendMessage({
      origin: this.id,
      destination: "external-crawler",
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
   * Disconnect from the socket
   */
  public disconnect(): void {
    try {
      this.logger.info("DirectCommunicationClient: Disconnecting...");
      
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      
      this.stopHeartbeatMonitoring();
      
      if (this.socket) {
        this.socket.end();
        this.socket = null;
      }
      
      this.connected = false;
      this.emit("disconnected");
      
      this.logger.info("DirectCommunicationClient: Disconnected");
    } catch (error) {
      this.logger.error("Error during disconnect:", { error });
    }
  }

  /**
   * Register event handlers for communication with crawlz
   */
  public onJobRequest(handler: (requestData: any) => void): void {
    this.on("jobRequest", handler);
  }

  public onProgressUpdate(handler: (progressData: ProgressUpdatePayload) => void): void {
    this.on("progressUpdate", handler);
  }

  public onTokenRefreshRequest(handler: (requestData: any) => void): void {
    this.on("tokenRefreshRequest", handler);
  }

  public onHeartbeat(handler: (payload: any) => void): void {
    this.on("heartbeat", handler);
  }

  public onStatusUpdate(handler: (status: any) => void): void {
    this.on("statusUpdate", handler);
  }

  public onJobUpdate(handler: (update: any) => void): void {
    this.on("jobUpdate", handler);
  }

  public onShutdown(handler: (signal?: string) => void): void {
    this.on("shutdown", handler);
  }

  public onDisconnected(handler: () => void): void {
    this.on("disconnected", handler);
  }

  public onConnected(handler: () => void): void {
    this.on("connected", handler);
  }

  /**
   * Remove all listeners (for cleanup)
   */
  public removeAllListeners(event?: string): this {
    this.logger.debug(`Removing all listeners${event ? ` for event: ${event}` : ''}`);
    return super.removeAllListeners(event);
  }
}

// Create and export singleton instance
const directCommunicationClient = new DirectCommunicationClient();
export default directCommunicationClient;