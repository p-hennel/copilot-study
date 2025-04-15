/**
 * SimplifiedSupervisor - A wrapper around the Supervisor class
 * that provides a simpler interface for common operations.
 */

import { getLogger } from "@logtape/logtape";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { Supervisor } from "./supervisor";
import { ProcessState, type ProcessConfig } from "./types";

// Initialize logger
const logger = getLogger(["simplified-supervisor"]);

export class SimplifiedSupervisor {
  private supervisor: Supervisor;
  private processes: Map<string, ProcessConfig> = new Map();
  
  constructor(socketPath: string) {
    
    // Ensure socket directory exists
    const socketDir = dirname(socketPath);
    if (!existsSync(socketDir)) {
      mkdirSync(socketDir, { recursive: true });
    }
    
    // Create the underlying supervisor
    this.supervisor = new Supervisor(socketPath);
  }
  
  /**
   * Define a process to be managed by the supervisor
   */
  defineProcess(id: string, config: {
    script: string;
    args?: string[];
    autoRestart?: boolean;
    restartDelay?: number;
    maxRestarts?: number;
    dependencies?: string[];
    env?: Record<string, string>;
    cwd?: string;
  }): void {
    const processConfig: ProcessConfig = {
      id,
      script: config.script,
      autoRestart: config.autoRestart ?? true,
      args: config.args || [],
      restartDelay: config.restartDelay ?? 3000,
      maxRestarts: config.maxRestarts ?? 5,
      dependencies: config.dependencies ?? [],
      env: config.env ?? {},
      // Handle other properties as needed
    };
    
    this.processes.set(id, processConfig);
  }
  
  /**
   * Start the supervisor and all defined processes
   */
  async start(): Promise<void> {
    try {
      // Register all processes with the supervisor
      for (const [id, config] of this.processes.entries()) {
        logger.info(`Registering process: ${id}`);
        this.supervisor["addProcess"](id, config);
      }
      
      // Start the supervisor
      await this.supervisor["start"]();
      logger.info("Supervisor started successfully");
    } catch (error) {
      logger.error(`Failed to start supervisor: ${error}`);
      throw error;
    }
  }
  
  /**
   * Stop the supervisor and all processes
   */
  async stop(): Promise<void> {
    try {
      // Stop the supervisor
      await this.supervisor["initiateShutdown"]({
        reason: "User requested stop",
        exitProcess: false
      });
      logger.info("Supervisor stopped successfully");
    } catch (error) {
      logger.error(`Failed to stop supervisor: ${error}`);
      throw error;
    }
  }
  
  /**
   * Stop a specific process
   */
  async stopProcess(processId: string): Promise<void> {
    try {
      const process = this.supervisor["processes"].get(processId);
      if (!process) {
        throw new Error(`Process not found: ${processId}`);
      }
      
      await process.stop();
      logger.info(`Process ${processId} stopped successfully`);
    } catch (error) {
      logger.error(`Failed to stop process ${processId}: ${error}`);
      throw error;
    }
  }
  
  /**
   * Restart a specific process
   */
  async restartProcess(processId: string): Promise<void> {
    try {
      const process = this.supervisor["processes"].get(processId);
      if (!process) {
        throw new Error(`Process not found: ${processId}`);
      }
      
      await process.restart();
      logger.info(`Process ${processId} restarted successfully`);
    } catch (error) {
      logger.error(`Failed to restart process ${processId}: ${error}`);
      throw error;
    }
  }
  
  /**
   * Get the state of a specific process
   */
  async getProcessState(processId: string): Promise<ProcessState | null> {
    try {
      const process = this.supervisor["processes"].get(processId);
      if (!process) {
        return null;
      }
      
      return process.getState();
    } catch (error) {
      logger.error(`Failed to get state for process ${processId}: ${error}`);
      throw error;
    }
  }
  
  /**
   * Get the configuration of a specific process
   */
  getProcessConfig(processId: string): ProcessConfig | null {
    try {
      const process = this.supervisor["processes"].get(processId);
      if (!process) {
        return null;
      }
      
      return process.config;
    } catch (error) {
      logger.error(`Failed to get config for process ${processId}: ${error}`);
      return null;
    }
  }
  
  /**
   * List all managed processes
   */
  listProcesses(): string[] {
    return Array.from(this.processes.keys());
  }
}
