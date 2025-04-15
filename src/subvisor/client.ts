// src/client.ts
import { getLogger } from "@logtape/logtape";
import { type Socket } from "bun";
import { EventEmitter } from "events";
import { existsSync } from "fs";
import { type IPCMessage, MessageType, ProcessState } from "./types";

// Constants for message handling
const MAX_QUEUE_LENGTH = 1000; // Maximum queued messages

export class SupervisorClient extends EventEmitter {
  private id: string;
  private socketPath: string;
  private socket: Socket | null = null;
  private connected: boolean = false;
  private reconnectTimer: Timer | null = null;
  private state: ProcessState = ProcessState.STARTING;
  private messageQueue: IPCMessage[] = [];
  private logger: any;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30000; // 30 seconds maximum

  constructor(
    options: {
      id?: string;
      socketPath?: string;
      logLevel?: "debug" | "info" | "warn" | "error";
      logFile?: string;
    } = {}
  ) {
    super();

    // Get process ID and socket path from options or environment variables
    this.id = options.id || process.env.SUPERVISOR_PROCESS_ID || "";
    this.socketPath = options.socketPath || process.env.SUPERVISOR_SOCKET_PATH || "";

    if (!this.id) {
      throw new Error("Process ID not provided and SUPERVISOR_PROCESS_ID environment variable not set");
    }

    if (!this.socketPath) {
      throw new Error("Socket path not provided and SUPERVISOR_SOCKET_PATH environment variable not set");
    }

    // Initialize logtape logger
    this.logger = getLogger([`client:${this.id}`]);
    
    // Validate socket path exists or at least its directory
    const socketDir = this.socketPath.substring(0, this.socketPath.lastIndexOf('/'));
    if (!existsSync(socketDir)) {
      throw new Error(`Socket directory does not exist: ${socketDir}`);
    }
  }

  private pruneMessageQueue(): void {
    // If queue is under limit, nothing to do
    if (this.messageQueue.length <= MAX_QUEUE_LENGTH) {
      return;
    }

    this.logger.warn(
      `Message queue exceeded limit (${this.messageQueue.length}), pruning oldest messages`,
      {
        queueLength: this.messageQueue.length,
        limit: MAX_QUEUE_LENGTH
      }
    );

    // Sort by priority (commands > state changes > heartbeats > messages)
    this.messageQueue.sort((a, b) => {
      const getPriority = (type: MessageType) => {
        switch (type) {
          case MessageType.COMMAND:
            return 0;
          case MessageType.STATE_CHANGE:
            return 1;
          case MessageType.HEARTBEAT:
            return 3;
          case MessageType.MESSAGE:
            return 2;
          default:
            return 4;
        }
      };

      return getPriority(a.type) - getPriority(b.type);
    });

    // Keep highest priority messages
    this.messageQueue = this.messageQueue.slice(0, MAX_QUEUE_LENGTH);

    this.logger.info(`Pruned message queue to ${this.messageQueue.length} messages`, {
      newQueueLength: this.messageQueue.length
    });
  }

  public async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    try {
      this.logger.info(`Attempting to connect to Unix socket: ${this.socketPath}`);
      
      // Check if socket file exists
      if (!existsSync(this.socketPath)) {
        throw new Error(`Socket file does not exist: ${this.socketPath}`);
      }
      
      this.socket = await Bun.connect({
        unix: this.socketPath,
        socket: {
          data: (_socket, data) => this.handleMessage(data),
          open: () => {
            this.connected = true;
            this.reconnectAttempts = 0; // Reset on successful connection
            this.emit("connected");
            this.logger.info(`Connected to supervisor at ${this.socketPath}`, {
              socketPath: this.socketPath
            });

            // Process any queued messages
            while (this.messageQueue.length > 0) {
              const message = this.messageQueue.shift()!;
              this.sendRawMessage(message);
            }

            // Send initial state update
            this.updateState(this.state);
            
            // Register with supervisor
            this.sendMessage("supervisor", "register", { 
              id: this.id,
              pid: process.pid,
              type: this.id.includes("web") ? "web-server" : this.id.includes("crawler") ? "crawler" : "worker"
            });
          },
          close: () => {
            this.connected = false;
            this.emit("disconnected");
            this.logger.warn("Disconnected from supervisor", {
              socketPath: this.socketPath
            });

            // Try to reconnect
            this.scheduleReconnect();
          },
          error: (_socket, error) => {
            this.logger.error(`Socket error: ${error}`, {
              error: error
            });
            this.emit("error", error);
          }
        }
      });
    } catch (err) {
      this.logger.error(`Failed to connect to supervisor: ${err}`, {
        error: err,
        socketPath: this.socketPath
      });
      this.emit("error", err);

      // Schedule reconnection
      this.scheduleReconnect();
    }
  }

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
      this.logger.info(`Attempting to reconnect (attempt ${this.reconnectAttempts + 1})...`, {
        attempt: this.reconnectAttempts + 1,
        delay: delay
      });
      this.reconnectAttempts++;
      this.connect().catch((err: unknown) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.logger.error(`Reconnection failed: ${errorMessage}`, {
          error: err
        });
      });
    }, delay);
  }

  private handleMessage(data: Buffer): void {
    try {
      const message = JSON.parse(data.toString()) as IPCMessage;

      if (message.destination !== this.id && message.destination !== "*") {
        this.logger.warn(
          `Received message intended for ${message.destination}, but our ID is ${this.id}`,
          {
            intendedDestination: message.destination,
            ourId: this.id
          }
        );
        return;
      }

      switch (message.type) {
        case MessageType.HEARTBEAT:
          // Forward heartbeat events
          this.emit("heartbeat", message.origin, message.payload);
          break;

        case MessageType.STATE_CHANGE:
          // Forward state change events
          this.emit(
            "stateChange",
            message.origin,
            message.payload.newState,
            message.payload.oldState
          );
          break;

        case MessageType.MESSAGE:
          // Forward regular messages
          this.emit("message", message.origin, message.key, message.payload);
          break;

        case MessageType.COMMAND:
          // Handle commands
          this.handleCommand(message);
          break;

        default:
          this.logger.warn(`Unknown message type: ${message.type}`, {
            messageType: message.type
          });
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(`Error processing message: ${errorMessage}`, {
        error: err
      });
    }
  }

  private handleCommand(message: IPCMessage): void {
    // Handle commands from the supervisor
    const { key, payload } = message;

    switch (key) {
      case "stop":
        this.emit("stop");
        break;

      case "restart":
        this.emit("restart");
        break;

      default:
        this.emit("command", key, payload);
        break;
    }
  }

  public sendMessage(destination: string, key: string, payload?: any): void {
    const message: IPCMessage = {
      origin: this.id,
      destination,
      type: MessageType.MESSAGE,
      key,
      payload,
      timestamp: Date.now()
    };

    this.sendMessage_(message);
  }

  public sendCommand(destination: string, key: string, payload?: any): void {
    const message: IPCMessage = {
      origin: this.id,
      destination,
      type: MessageType.COMMAND,
      key,
      payload,
      timestamp: Date.now()
    };

    this.sendMessage_(message);
  }

  public updateState(state: ProcessState): void {
    if (this.state === state) {
      return;
    }

    const oldState = this.state;
    this.state = state;

    const message: IPCMessage = {
      origin: this.id,
      destination: "supervisor",
      type: MessageType.STATE_CHANGE,
      key: "stateChange",
      payload: {
        state,
        previousState: oldState
      },
      timestamp: Date.now()
    };

    this.sendMessage_(message);
    this.emit("ownStateChange", state, oldState);
  }

  public sendHeartbeat(payload?: any): void {
    const message: IPCMessage = {
      origin: this.id,
      destination: "supervisor",
      type: MessageType.HEARTBEAT,
      key: "heartbeat",
      payload: {
        timestamp: Date.now(),
        ...payload
      },
      timestamp: Date.now()
    };
    
    this.sendMessage_(message);
  }

  public subscribeToHeartbeats(targetId: string): void {
    const message: IPCMessage = {
      origin: this.id,
      destination: "supervisor",
      type: MessageType.SUBSCRIPTION,
      key: "subscription",
      payload: {
        target: targetId,
        action: "subscribe"
      },
      timestamp: Date.now()
    };

    this.sendMessage_(message);
  }

  public unsubscribeFromHeartbeats(targetId: string): void {
    const message: IPCMessage = {
      origin: this.id,
      destination: "supervisor",
      type: MessageType.SUBSCRIPTION,
      key: "subscription",
      payload: {
        target: targetId,
        action: "unsubscribe"
      },
      timestamp: Date.now()
    };

    this.sendMessage_(message);
  }

  public broadcastMessage(key: string, payload?: any): void {
    const message: IPCMessage = {
      origin: this.id,
      destination: "*", // Broadcast to all
      type: MessageType.MESSAGE,
      key,
      payload,
      timestamp: Date.now()
    };

    this.sendMessage_(message);
  }

  public async getProcessState(processId: string): Promise<ProcessState | null> {
    return new Promise((resolve) => {
      const messageHandler = (origin: string, key: string, payload: any) => {
        if (origin === "supervisor" && key === "processState" && payload.processId === processId) {
          this.off("message", messageHandler);
          resolve(payload.state);
        }
      };

      // Set up a listener for the response
      this.on("message", messageHandler);

      // Set a timeout

      // Send the command
      this.sendCommand("supervisor", "getState", { processId });
    });
  }

  public async getProcessList(): Promise<any[]> {
    return new Promise((resolve) => {
      const messageHandler = (origin: string, key: string, payload: any) => {
        if (origin === "supervisor" && key === "processList") {
          this.off("message", messageHandler);
          resolve(payload);
        }
      };

      // Set up a listener for the response
      this.on("message", messageHandler);

      // Set a timeout

      // Send the command
      this.sendCommand("supervisor", "getProcessList", {});
    });
  }

  public startProcess(processId: string): void {
    this.sendCommand("supervisor", "start", { processId });
  }

  public stopProcess(processId: string): void {
    this.sendCommand("supervisor", "stop", { processId });
  }

  public restartProcess(processId: string): void {
    this.sendCommand("supervisor", "restart", { processId });
  }

  private sendMessage_(message: IPCMessage): void {
    if (!this.connected || !this.socket) {
      // Queue message if not connected
      this.messageQueue.push(message);
      // Check if we need to prune the queue
      this.pruneMessageQueue();
      return;
    }

    this.sendRawMessage(message);
  }

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
      this.logger.debug(`Sent message: ${message.type}:${message.key} to ${message.destination}`, {
        messageType: message.type,
        messageKey: message.key,
        destination: message.destination
      });
    } catch (err) {
      this.logger.error(`Failed to send message: ${err}`, {
        error: err,
        message: {
          type: message.type,
          key: message.key,
          destination: message.destination
        }
      });
      // Queue message for retry
      this.messageQueue.push(message);
      // Check if we need to prune the queue
      this.pruneMessageQueue();
    }
  }

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
}
