// src/supervisor.ts
import { getLogger } from "@logtape/logtape";
import { type Socket } from "bun";
import { EventEmitter } from "events";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname } from "path";
import { type SettingsChangeEvent } from "../settings";
import { ManagedProcess } from "./managed-process";
import { type SupervisorConfig, supervisorSettings } from "./settings";
import { type IPCMessage, MessageType, type ProcessConfig, ProcessState } from "./types";

// Main Supervisor class
export class Supervisor extends EventEmitter {
  public config: SupervisorConfig;
  private processes: Map<string, ManagedProcess> = new Map();
  private server: Bun.UnixSocketListener<any> | null = null;
  private clients: Map<string, Socket> = new Map();
  private subscriptions: Map<string, Set<string>> = new Map(); // processId -> Set of subscriberIds
  public logger: any; // logtape logger
  private stateFile: string;
  private stateSaveInterval: Timer | null = null;
  private settingsUnsubscribe: (() => void) | null = null;

  constructor(configPath?: string) {
    super();

    // Initialize with the settings manager
    if (configPath) {
      // If a specific config path is provided, update the settings manager
      supervisorSettings.updateSettings({
        // This would ideally load the file and parse it, but for simplicity:
        // We'll just set the socketPath from the configPath filename
        socketPath: `/tmp/${configPath.split("/").pop()?.replace(".yaml", "") || "supervisor"}.sock`
      });
    }

    // Get the configuration from the settings manager
    this.config = supervisorSettings.getSettings();

    // Initialize the logger
    this.initLogger();

    // Set up the state file path
    this.stateFile =
      this.config.stateFile || `${dirname(this.config.socketPath)}/supervisor-state.json`;

    // Subscribe to settings changes
    this.settingsUnsubscribe = supervisorSettings.onChange(this.handleSettingsChange.bind(this));

    // Try to load existing state
    this.loadState();

    // Set up periodic state saving
    this.stateSaveInterval = setInterval(() => {
      this.saveState();
    }, this.config.stateSaveInterval); // Save state interval from settings

    // Ensure the socket is cleaned up on exit
    this.ensureSocketCleanup();
  }

  /**
   * Handle settings changes from the settings manager
   */
  private handleSettingsChange(event: SettingsChangeEvent): void {
    const oldConfig = event.previousSettings as SupervisorConfig;
    const newConfig = event.currentSettings as SupervisorConfig;

    this.logger.info("Settings changed, applying updates");

    // Update the config reference
    this.config = newConfig;

    // Check if heartbeat interval changed
    if (oldConfig.heartbeatInterval !== newConfig.heartbeatInterval) {
      this.logger.info(
        `Heartbeat interval changed from ${oldConfig.heartbeatInterval}ms to ${newConfig.heartbeatInterval}ms`
      );

      // Update heartbeat intervals for all processes
      for (const process of this.processes.values()) {
        process.updateHeartbeatInterval(newConfig.heartbeatInterval);
      }
    }

    // Check if log level changed
    if (oldConfig.logLevel !== newConfig.logLevel) {
      this.logger.info(`Log level changed from ${oldConfig.logLevel} to ${newConfig.logLevel}`);
      // Re-initialize logger
      this.initLogger();
    }

    // Handle process changes (added, removed, or modified)
    this.handleProcessConfigChanges(oldConfig.processes, newConfig.processes);
  }

  /**
   * Handle changes to process configurations
   */
  private handleProcessConfigChanges(
    oldProcessConfigs: ProcessConfig[],
    newProcessConfigs: ProcessConfig[]
  ): void {
    const oldProcessMap = new Map(oldProcessConfigs.map((p) => [p.id, p]));
    const newProcessMap = new Map(newProcessConfigs.map((p) => [p.id, p]));

    // Find removed processes
    for (const [id] of oldProcessMap.entries()) {
      if (!newProcessMap.has(id)) {
        this.logger.info(`Process ${id} removed from configuration`);
        const process = this.processes.get(id);
        if (process) {
          process.stop().then(() => {
            this.processes.delete(id);
          });
        }
      }
    }

    // Find added processes
    for (const [id, newConfig] of newProcessMap.entries()) {
      if (!oldProcessMap.has(id)) {
        this.logger.info(`New process ${id} added to configuration`);
        const managedProcess = new ManagedProcess(newConfig, this);
        this.processes.set(id, managedProcess);

        // Create empty subscription set for this process
        this.subscriptions.set(id, new Set());

        // Auto-subscribe to heartbeats if configured
        if (newConfig.subscribeToHeartbeats) {
          for (const targetId of newConfig.subscribeToHeartbeats) {
            // Make sure the subscription target exists
            if (!newProcessMap.has(targetId)) {
              this.logger.warn(
                `Process ${newConfig.id} tried to subscribe to non-existent process ${targetId}`
              );
              continue;
            }

            // Add to subscriptions
            const subs = this.subscriptions.get(targetId) || new Set();
            subs.add(newConfig.id);
            this.subscriptions.set(targetId, subs);
          }
        }

        // Start the process if the supervisor is running
        if (this.server) {
          managedProcess.start();
        }
      }
    }

    // Check for modified processes
    for (const [id, newConfig] of newProcessMap.entries()) {
      if (oldProcessMap.has(id)) {
        const oldConfig = oldProcessMap.get(id)!;

        // Check if any important configuration changed
        if (JSON.stringify(oldConfig) !== JSON.stringify(newConfig)) {
          this.logger.info(`Configuration changed for process ${id}`);

          const process = this.processes.get(id);
          if (process) {
            // Update the configuration
            process.updateConfig(newConfig);

            // If script changed, restart the process
            if (
              oldConfig.script !== newConfig.script ||
              JSON.stringify(oldConfig.args) !== JSON.stringify(newConfig.args) ||
              JSON.stringify(oldConfig.env) !== JSON.stringify(newConfig.env)
            ) {
              this.logger.info(`Restarting process ${id} due to script or args change`);
              process.restart();
            }
          }
        }
      }
    }
  }

  private initLogger(): void {
    // Initialize logtape logger with settings from config
    this.logger = getLogger(["supervisor"]);

    // Add prefix if specified
    if (this.config.logPrefix) {
      this.logger = this.logger.child([this.config.logPrefix]);
    }
  }

  private saveState(): void {
    try {
      const state = {
        processes: Array.from(this.processes.entries()).map(([id, process]) => ({
          id,
          state: process.getState(),
          lastHeartbeat: process.getLastHeartbeat(),
          restartCount: process.getRestartCount()
        })),
        timestamp: Date.now()
      };

      writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
      this.logger.debug(`Saved supervisor state to ${this.stateFile}`);
    } catch (err: any) {
      this.logger.error(`Failed to save state: ${err.message}`, { error: err });
    }
  }

  private loadState(): void {
    if (!existsSync(this.stateFile)) {
      this.logger.info(`No state file found at ${this.stateFile}`);
      return;
    }

    try {
      const data = readFileSync(this.stateFile, "utf-8");
      const state = JSON.parse(data);

      // Check if state is too old (e.g., more than 1 hour)
      const maxAge = 3600000; // 1 hour
      if (Date.now() - state.timestamp > maxAge) {
        this.logger.warn(
          `State file is too old (${new Date(state.timestamp).toISOString()}), ignoring`
        );
        return;
      }

      this.logger.info(`Loaded previous state from ${this.stateFile}`);
    } catch (err: any) {
      this.logger.error(`Failed to load state: ${err.message}`, { error: err });
    }
  }

  private ensureSocketCleanup(): void {
    // Clean up on normal process exit
    process.on("exit", () => {
      this.cleanup();
    });

    // Clean up on uncaught exceptions
    process.on("uncaughtException", (err) => {
      this.logger.error(`Uncaught exception: ${err.message}`, { error: err });
      this.cleanup();
      process.exit(1);
    });
  }

  private cleanup(): void {
    if (this.settingsUnsubscribe) {
      this.settingsUnsubscribe();
      this.settingsUnsubscribe = null;
    }

    if (this.stateSaveInterval) {
      clearInterval(this.stateSaveInterval);
      this.stateSaveInterval = null;
    }

    if (existsSync(this.config.socketPath)) {
      try {
        unlinkSync(this.config.socketPath);
      } catch (socketErr: any) {
        // Can't log here as process is exiting
      }
    }
  }

  /**
   * Initiates a controlled shutdown of the supervisor and all its managed processes.
   * This method provides more control over the shutdown process than the internal
   * shutdown method used by signal handlers.
   *
   * @param options Configuration options for the shutdown process
   * @returns A promise that resolves when shutdown is complete
   */
  public async initiateShutdown(
    options: {
      timeout?: number; // Maximum time to wait for graceful shutdown (ms)
      force?: boolean; // Whether to force kill processes that don't exit gracefully
      reason?: string; // Reason for shutdown (for logging)
      exitProcess?: boolean; // Whether to exit the Node process after shutdown
    } = {}
  ): Promise<void> {
    const {
      timeout = 30000, // Default 30 seconds timeout
      force = true, // Default to force kill if needed
      reason = "User initiated shutdown",
      exitProcess = false // Default to not exit the process
    } = options;

    this.logger.info(`Initiating supervisor shutdown: ${reason}`, {
      timeout,
      force,
      reason
    });

    // Emit shutdown event so consumers can react
    this.emit("shuttingDown", { reason, timeout });

    // Stop accepting new connections
    if (this.server) {
      this.logger.debug("Stopping server from accepting new connections");
      this.server.stop();
    }

    // Save state before shutdown
    this.logger.debug("Saving supervisor state before shutdown");
    this.saveState();

    // Stop all processes with configured timeout
    this.logger.info(`Stopping all processes with ${timeout}ms timeout`);
    const processes = Array.from(this.processes.values());
    const processCount = processes.length;

    // Start a timeout to force shutdown if necessary
    let forceShutdownTimer: Timer | null = null;
    let shutdownComplete = false;

    if (force) {
      forceShutdownTimer = setTimeout(() => {
        if (shutdownComplete) return;

        this.logger.warn(
          `Shutdown timeout reached (${timeout}ms), force killing remaining processes`
        );

        // Force kill any remaining processes
        for (const process of processes) {
          if (
            process.getState() !== ProcessState.STOPPED &&
            process.getState() !== ProcessState.FAILED
          ) {
            this.logger.warn(`Force killing process: ${process.id}`);
            // Access the internal process object and kill it
            const childProcess = (process as any).process;
            if (childProcess) {
              childProcess.kill(9); // SIGKILL
            }
          }
        }

        // Clean up resources and complete shutdown
        this.completeShutdown(reason, exitProcess);
      }, timeout);
    }

    try {
      // Track successfully stopped processes
      let stoppedCount = 0;

      // Stop all processes concurrently with individual timeouts
      const stopPromises = processes.map(async (process) => {
        try {
          await process.stop();
          stoppedCount++;
          this.logger.debug(
            `Process ${process.id} stopped successfully (${stoppedCount}/${processCount})`
          );
        } catch (err: any) {
          this.logger.error(`Failed to stop process ${process.id}: ${err.message}`, { error: err });
        }
      });

      // Wait for all processes to stop
      await Promise.all(stopPromises);

      // Cancel force shutdown timer if all processes stopped gracefully
      if (forceShutdownTimer) {
        clearTimeout(forceShutdownTimer);
        forceShutdownTimer = null;
      }

      this.logger.info(`All processes stopped successfully (${stoppedCount}/${processCount})`);

      // Complete the shutdown process
      shutdownComplete = true;
      await this.completeShutdown(reason, exitProcess);
    } catch (err: any) {
      this.logger.error(`Error during shutdown: ${err.message}`, { error: err });

      // Ensure shutdown completes even if there's an error
      shutdownComplete = true;
      await this.completeShutdown(reason, exitProcess);
    }
  }

  /**
   * Completes the shutdown process by cleaning up resources.
   *
   * @param reason The reason for shutdown
   * @param exitProcess Whether to exit the Node process
   */
  private async completeShutdown(reason: string, exitProcess: boolean): Promise<void> {
    // Clean up the socket
    if (existsSync(this.config.socketPath)) {
      try {
        unlinkSync(this.config.socketPath);
        this.logger.debug(`Removed socket file: ${this.config.socketPath}`);
      } catch (err: any) {
        this.logger.error(`Failed to remove socket file: ${err.message}`, { error: err });
      }
    }

    // Clear any timers
    if (this.stateSaveInterval) {
      clearInterval(this.stateSaveInterval);
      this.stateSaveInterval = null;
    }

    // Release any other resources held by the supervisor
    this.server = null;
    this.clients.clear();
    this.subscriptions.clear();

    // Emit shutdown completed event
    this.emit("shutdownComplete", { reason });

    this.logger.info(`Supervisor shutdown complete: ${reason}`);

    // Exit the process if requested
    if (exitProcess) {
      this.logger.info("Exiting process as requested");
      process.exit(0);
    }
  }

  /**
   * Sets up signal handlers for graceful shutdown.
   */
  private setupSignalHandlers(): void {
    // Handle SIGINT (Ctrl+C)
    process.on("SIGINT", () => {
      this.logger.info("Received SIGINT signal");
      this.initiateShutdown({
        reason: "SIGINT signal received",
        exitProcess: true,
        timeout: 10000 // Give processes 10 seconds to exit gracefully
      }).catch((err) => {
        this.logger.error(`Error during SIGINT shutdown: ${err.message}`, { error: err });
        process.exit(1);
      });
    });

    // Handle SIGTERM
    process.on("SIGTERM", () => {
      this.logger.info("Received SIGTERM signal");
      this.initiateShutdown({
        reason: "SIGTERM signal received",
        exitProcess: true,
        timeout: 10000 // Give processes 10 seconds to exit gracefully
      }).catch((err) => {
        this.logger.error(`Error during SIGTERM shutdown: ${err.message}`, { error: err });
        process.exit(1);
      });
    });

    // Handle uncaught exceptions
    process.on("uncaughtException", (err) => {
      this.logger.error(`Uncaught exception: ${err.message}`, { error: err });

      this.initiateShutdown({
        reason: "Uncaught exception",
        exitProcess: true,
        force: true,
        timeout: 5000 // Less time for uncaught exceptions
      }).catch(() => {
        // Force exit if shutdown itself fails
        process.exit(1);
      });
    });

    // Handle unhandled promise rejections
    process.on("unhandledRejection", (reason, promise) => {
      this.logger.error(`Unhandled promise rejection at: ${promise}, reason: ${reason}`);

      // We'll log but not exit for unhandled rejections, just a warning
      // Applications should handle their own promise rejections
    });
  }

  /**
   * Starts the supervisor and all configured processes.
   * @returns A promise that resolves when the supervisor has started.
   */
  public async start(): Promise<void> {
    try {
      // Prevent starting multiple times
      if (this.server) {
        this.logger.warn("Supervisor is already running");
        return;
      }

      this.logger.info("Starting supervisor");

      // Ensure the socket directory exists
      const socketDir = dirname(this.config.socketPath);
      if (!existsSync(socketDir)) {
        mkdirSync(socketDir, { recursive: true });
      }

      // Remove existing socket if it exists
      if (existsSync(this.config.socketPath)) {
        unlinkSync(this.config.socketPath);
      }

      // Start the IPC server using Unix socket
      this.logger.info(`Starting Unix socket server at ${this.config.socketPath}`);
      this.server = Bun.listen({
        unix: this.config.socketPath,
        socket: {
          data: (socket, data) => this.handleMessage(socket, data),
          open: () => {
            this.logger.debug(`Client connected to supervisor socket`);
          },
          close: (socket) => {
            // Find and remove the disconnected client
            for (const [id, client] of this.clients.entries()) {
              if (client === socket) {
                this.logger.info(`Client ${id} disconnected`);
                this.clients.delete(id);
                break;
              }
            }
          },
          error: (_socket, error) => {
            this.logger.error(`Socket error: ${error}`);
          }
        }
      });
      
      // Log the IPC configuration
      this.logger.info(`IPC using Unix socket: ${this.config.socketPath}`);
      this.logger.info(`Unix socket only mode: ${this.config.useUnixSocketsOnly ? 'enabled' : 'disabled'}`);
      
      // Ensure environment variables for child processes will use Unix sockets
      if (this.config.useUnixSocketsOnly) {
        for (const processConfig of this.config.processes) {
          if (processConfig.env) {
            // Remove any PORT environment variables
            if ('PORT' in processConfig.env) {
              this.logger.warn(`Removing PORT env var from ${processConfig.id} as useUnixSocketsOnly is enabled`);
              delete processConfig.env['PORT'];
            }
            
            // Set Unix socket environment flag
            processConfig.env.SUPERVISOR_USE_UNIX_SOCKET = 'true';
          }
        }
      }

      this.logger.info(`Supervisor started, listening on ${this.config.socketPath}`);

      // Create process objects
      for (const processConfig of this.config.processes) {
        const managedProcess = new ManagedProcess(processConfig, this);
        this.processes.set(processConfig.id, managedProcess);

        // Create empty subscription set for this process
        this.subscriptions.set(processConfig.id, new Set());

        // Auto-subscribe to heartbeats if configured
        if (processConfig.subscribeToHeartbeats) {
          for (const targetId of processConfig.subscribeToHeartbeats) {
            // Make sure the subscription target exists
            if (!this.config.processes.some((p) => p.id === targetId)) {
              this.logger.warn(
                `Process ${processConfig.id} tried to subscribe to non-existent process ${targetId}`
              );
              continue;
            }

            // Add to subscriptions
            const subs = this.subscriptions.get(targetId) || new Set();
            subs.add(processConfig.id);
            this.subscriptions.set(targetId, subs);
          }
        }
      }

      // Setup signal handlers for graceful shutdown
      this.setupSignalHandlers();

      // Setup socket cleanup to prevent socket file leaks
      this.ensureSocketCleanup();

      // Emit a started event
      this.emit("started", { processCount: this.processes.size });

      // Start processes
      const processStartPromises = [];
      for (const [id, managedProcess] of this.processes.entries()) {
        // Wrap each process start in a promise that resolves regardless of success/failure
        const startPromise = new Promise<void>((resolve) => {
          try {
            managedProcess.start();
            this.logger.debug(`Process ${id} start initiated`);
          } catch (err: any) {
            this.logger.error(`Failed to start process ${id}: ${err.message}`, { error: err });
          }
          // Always resolve so we don't block other processes
          resolve();
        });

        processStartPromises.push(startPromise);
      }

      // Wait for all process starts to be initiated
      await Promise.all(processStartPromises);

      this.logger.info("Supervisor initialization completed");

      // Emit a ready event
      this.emit("ready", { processCount: this.processes.size });
    } catch (err: any) {
      this.logger.error(`Failed to start supervisor: ${err.message}`, { error: err });
      throw err;
    }
  }

  // Methods for handling IPC messages and communication
  private handleMessage(socket: Socket, data: Buffer): void {
    // Validate message size
    const maxSize = supervisorSettings.get("maxMessageSize", 1024 * 1024);
    if (data.length > maxSize) {
      this.logger.warn(`Received message exceeds max size (${data.length} > ${maxSize} bytes)`);
      return;
    }

    try {
      const message = JSON.parse(data.toString()) as IPCMessage;

      // Validate message
      if (!message.origin || !message.type || !message.key) {
        this.logger.warn("Received invalid message format");
        return;
      }

      this.logger.debug(
        `Received ${message.type} message from ${message.origin} to ${message.destination || "supervisor"}`
      );

      // Register client if not already registered
      if (!this.clients.has(message.origin)) {
        this.clients.set(message.origin, socket);
        this.logger.info(`Registered client ${message.origin}`);
      }

      // Process message based on type
      switch (message.type) {
        case MessageType.COMMAND:
          this.handleCommand(message);
          break;

        case MessageType.MESSAGE:
          this.routeMessage(message);
          break;

        case MessageType.SUBSCRIPTION:
          this.handleSubscription(message);
          break;

        case MessageType.STATE_CHANGE:
          this.handleStateChange(message);
          break;

        case MessageType.HEARTBEAT:
          // Just log heartbeats at debug level
          this.logger.debug(`Heartbeat from ${message.origin}`);
          break;

        default:
          this.logger.warn(`Unknown message type: ${message.type}`);
      }
    } catch (err: any) {
      this.logger.error(`Error processing message: ${err.message}`, { error: err });
    }
  }

  private handleCommand(message: IPCMessage): void {
    const { origin, key, payload } = message;

    switch (key) {
      case "start":
        if (payload?.processId && this.processes.has(payload.processId)) {
          this.logger.info(`Command from ${origin}: Starting process ${payload.processId}`);
          this.processes.get(payload.processId)?.start();
        }
        break;

      case "stop":
        if (payload?.processId && this.processes.has(payload.processId)) {
          this.logger.info(`Command from ${origin}: Stopping process ${payload.processId}`);
          this.processes.get(payload.processId)?.stop();
        }
        break;

      case "restart":
        if (payload?.processId && this.processes.has(payload.processId)) {
          this.logger.info(`Command from ${origin}: Restarting process ${payload.processId}`);
          this.processes
            .get(payload.processId)
            ?.stop()
            .then(() => {
              this.processes.get(payload.processId)?.start();
            });
        }
        break;

      case "getState":
        if (payload?.processId && this.processes.has(payload.processId)) {
          const state = this.processes.get(payload.processId)?.getState();
          this.sendMessage({
            origin: "supervisor",
            destination: origin,
            type: MessageType.MESSAGE,
            key: "processState",
            payload: {
              processId: payload.processId,
              state
            },
            timestamp: Date.now()
          });
        }
        break;

      case "getProcessList":
        const processList = Array.from(this.processes.entries()).map(([id, proc]) => ({
          id,
          state: proc.getState(),
          config: proc.config
        }));

        this.sendMessage({
          origin: "supervisor",
          destination: origin,
          type: MessageType.MESSAGE,
          key: "processList",
          payload: processList,
          timestamp: Date.now()
        });
        break;

      case "reloadSettings":
        this.logger.info(`Command from ${origin}: Reloading settings`);
        // Force reload settings
        supervisorSettings.reload();

        this.sendMessage({
          origin: "supervisor",
          destination: origin,
          type: MessageType.MESSAGE,
          key: "settingsReloaded",
          payload: {
            success: true,
            timestamp: Date.now()
          },
          timestamp: Date.now()
        });
        break;

      default:
        this.logger.warn(`Unknown command: ${key}`);
    }
  }

  private routeMessage(message: IPCMessage): void {
    if (!message.destination) {
      this.logger.warn(`Message from ${message.origin} has no destination`);
      return;
    }

    if (message.destination === "supervisor") {
      // Message is for the supervisor itself
      this.logger.debug(`Received message for supervisor: ${message.key}`);
      return;
    }

    // Forward to the destination
    if (this.clients.has(message.destination)) {
      const targetSocket = this.clients.get(message.destination)!;
      this.sendRawMessage(targetSocket, message);
    } else {
      this.logger.warn(`Cannot route message to ${message.destination}: client not connected`);
    }
  }

  private handleSubscription(message: IPCMessage): void {
    const { origin, payload } = message;

    if (!payload?.target) {
      this.logger.warn(`Invalid subscription request from ${origin}: missing target`);
      return;
    }

    const { target, action } = payload;

    if (!this.processes.has(target)) {
      this.logger.warn(`Subscription to non-existent process ${target} from ${origin}`);
      return;
    }

    const subscribers = this.subscriptions.get(target) || new Set();

    if (action === "subscribe") {
      subscribers.add(origin);
      this.logger.info(`${origin} subscribed to ${target}`);
    } else if (action === "unsubscribe") {
      subscribers.delete(origin);
      this.logger.info(`${origin} unsubscribed from ${target}`);
    }

    this.subscriptions.set(target, subscribers);
  }

  private handleStateChange(message: IPCMessage): void {
    const { origin, payload } = message;

    if (!payload?.state) {
      return;
    }

    const process = this.processes.get(origin);
    if (process) {
      process.setState(payload.state as ProcessState);
    }
  }

  public broadcastHeartbeat(processId: string): void {
    const subscribers = this.subscriptions.get(processId);
    if (!subscribers || subscribers.size === 0) {
      return;
    }

    const process = this.processes.get(processId);
    if (!process) {
      return;
    }

    // Get process stats for the heartbeat
    const stats = process.getHealth();

    const heartbeatMessage: IPCMessage = {
      origin: processId,
      destination: "",
      type: MessageType.HEARTBEAT,
      key: "heartbeat",
      payload: {
        timestamp: Date.now(),
        ...stats
      },
      timestamp: Date.now()
    };

    for (const subscriberId of subscribers) {
      if (this.clients.has(subscriberId)) {
        heartbeatMessage.destination = subscriberId;
        this.sendRawMessage(this.clients.get(subscriberId)!, heartbeatMessage);
      }
    }
  }

  public broadcastStateChange(
    processId: string,
    newState: ProcessState,
    oldState: ProcessState
  ): void {
    const subscribers = this.subscriptions.get(processId);
    if (!subscribers || subscribers.size === 0) {
      return;
    }

    const stateChangeMessage: IPCMessage = {
      origin: processId,
      destination: "",
      type: MessageType.STATE_CHANGE,
      key: "stateChange",
      payload: {
        processId,
        newState,
        oldState,
        timestamp: Date.now()
      },
      timestamp: Date.now()
    };

    for (const subscriberId of subscribers) {
      if (this.clients.has(subscriberId)) {
        stateChangeMessage.destination = subscriberId;
        this.sendRawMessage(this.clients.get(subscriberId)!, stateChangeMessage);
      }
    }
  }

  public sendMessage(message: IPCMessage): void {
    if (!message.destination) {
      this.logger.warn("Cannot send message without destination");
      return;
    }

    if (!this.clients.has(message.destination)) {
      this.logger.warn(`Cannot send message to ${message.destination}: client not connected`);
      return;
    }

    this.sendRawMessage(this.clients.get(message.destination)!, message);
  }

  private sendRawMessage(socket: Socket, message: IPCMessage): void {
    try {
      // Ensure the timestamp is set
      if (!message.timestamp) {
        message.timestamp = Date.now();
      }

      socket.write(JSON.stringify(message));
    } catch (err: any) {
      this.logger.error(`Failed to send message: ${err}`);
    }
  }
}
