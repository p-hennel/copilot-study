import { spawn, type Subprocess } from "bun";
import { EventEmitter } from "events";
import supervisorSettings from "./settings";
import { Supervisor } from "./supervisor";
import { type ProcessConfig, ProcessState } from "./types";

// Managed process class
export class ManagedProcess extends EventEmitter {
  public id: string;
  public config: ProcessConfig;
  private process: Subprocess | null = null;
  private restartCount: number = 0;
  private restartTimer: Timer | null = null;
  private state: ProcessState = ProcessState.STOPPED;
  private lastHeartbeat: number = 0;
  private heartbeatInterval: Timer | null = null;
  private supervisor: Supervisor;
  private startTime: number = 0;
  private nextHeartbeatStats: {
    cpu?: number;
    memory?: number;
    uptime?: number;
    restartCount?: number;
  } = {};
  private healthCheckInterval: Timer | null = null;
  private lastCpuUsage: number = 0;
  private lastCpuTime: number = Date.now();
  private logger: any;
  private circuitOpen = false;
  private circuitResetTimer: Timer | null = null;
  private failureThreshold = 5;
  private failureWindow = 60000; // 1 minute
  private failureTimes: number[] = [];

  constructor(config: ProcessConfig, supervisor: Supervisor) {
    super();
    this.id = config.id;
    this.config = config;
    this.supervisor = supervisor;

    // Use child logger for process-specific logs
    this.logger = supervisor.logger.child([`process:${config.id}`]);

    // Initialize circuit breaker settings from supervisor config
    const cbSettings = supervisorSettings.get("circuitBreaker", {});
    this.failureThreshold = cbSettings.failureThreshold || 5;
    this.failureWindow = cbSettings.failureWindow || 60000;
  }

  // New method to update the process configuration
  public updateConfig(newConfig: ProcessConfig): void {
    this.config = newConfig;
    this.logger.info(`Configuration updated for process ${this.id}`);
  }

  // New method to update the heartbeat interval
  public updateHeartbeatInterval(interval: number): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.setupHeartbeat(interval);
    }
  }

  public getRestartCount(): number {
    return this.restartCount;
  }

  public getState(): ProcessState {
    return this.state;
  }

  public getLastHeartbeat(): number {
    return this.lastHeartbeat;
  }

  public getStartTime(): number {
    return this.startTime;
  }

  public getHealth(): {
    cpu: number;
    memory: number;
    uptime: number;
    restartCount: number;
    state: ProcessState;
    lastHeartbeat: number;
    pid?: number;
    isRunning: boolean;
  } {
    // Calculate uptime
    const uptime = this.startTime > 0 ? (Date.now() - this.startTime) / 1000 : 0;

    // Get PID if process is running
    const pid = this.process?.pid;

    // Check if process is running
    const isRunning =
      this.process !== null &&
      this.state !== ProcessState.STOPPED &&
      this.state !== ProcessState.FAILED;

    // Return the health information object
    return {
      // CPU usage percentage (0-100)
      cpu: this.nextHeartbeatStats.cpu ?? 0,

      // Memory usage percentage (0-100)
      memory: this.nextHeartbeatStats.memory ?? 0,

      // Uptime in seconds
      uptime,

      // Number of times the process has been restarted
      restartCount: this.restartCount,

      // Current process state
      state: this.state,

      // Timestamp of the last heartbeat
      lastHeartbeat: this.lastHeartbeat,

      // Process ID (if available)
      pid,

      // Whether the process is currently running
      isRunning
    };
  }

  public restart(): Promise<void> {
    return this.stop().then(() => {
      this.start();
    });
  }

  public start(): void {
    if (this.process || this.state === ProcessState.STARTING) {
      return;
    }

    this.setState(ProcessState.STARTING);

    try {
      // Ensure dependencies are running first
      if (this.config.dependencies?.length) {
        this.supervisor.ensureDependenciesRunning(this.config.dependencies, this.id);
      }

      // Spawn the process with Bun
      this.process = spawn({
        cmd: ["bun", "run", this.config.script, ...(this.config.args || [])],
        env: {
          ...process.env,
          ...this.config.env,
          SUPERVISOR_PROCESS_ID: this.id,
          SUPERVISOR_SOCKET_PATH: this.supervisor.config.socketPath
        },
        stdio: ["inherit", "inherit", "inherit"]
      });

      this.startTime = Date.now(); // Set start time when process starts

      this.process.exited
        .then((code: any) => {
          this.handleExit(code || 0);
        })
        .catch((err: any) => {
          this.logger.error(`Failed to start: ${err.message}`, { error: err });
          this.setState(ProcessState.FAILED);
          this.handleExit(1);
        });

      // Start sending heartbeats
      this.setupHeartbeat(this.supervisor.config.heartbeatInterval);

      this.logger.info(`Started process ${this.id}`);
    } catch (err: any) {
      this.logger.error(`Failed to start process`, { error: err });
      this.setState(ProcessState.FAILED);
      this.handleExit(1);
    }
  }

  private setupHeartbeat(interval: number = 5000): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.lastHeartbeat = Date.now();

    this.heartbeatInterval = setInterval(() => {
      // Send heartbeat to subscribers
      this.supervisor.broadcastHeartbeat(this.id);
      this.lastHeartbeat = Date.now();
    }, interval);
  }

  private recordFailure(): void {
    const now = Date.now();

    // Add current failure time
    this.failureTimes.push(now);

    // Remove failures outside the window
    this.failureTimes = this.failureTimes.filter((time) => now - time < this.failureWindow);

    // Check if we need to open the circuit
    if (this.failureTimes.length >= this.failureThreshold) {
      this.openCircuit();
    }
  }

  private openCircuit(): void {
    if (this.circuitOpen) return;

    this.circuitOpen = true;
    this.logger.warn(`Circuit breaker opened for ${this.id} due to repeated failures`);

    // Get reset timeout from settings
    const resetTimeout = supervisorSettings.get("circuitBreaker.resetTimeout", 300000); // 5 minutes default

    // Schedule circuit reset
    this.circuitResetTimer = setTimeout(() => {
      this.closeCircuit();
    }, resetTimeout);
  }

  private closeCircuit(): void {
    if (!this.circuitOpen) return;

    this.circuitOpen = false;
    this.failureTimes = [];
    this.logger.info(`Circuit breaker closed for ${this.id}, allowing restarts again`);

    // Try to restart if in a failed state
    if (this.state === ProcessState.FAILED) {
      this.restart();
    }
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (
        !this.process ||
        this.state === ProcessState.STOPPED ||
        this.state === ProcessState.STOPPING
      ) {
        resolve();
        return;
      }

      this.setState(ProcessState.STOPPING);

      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }

      if (this.restartTimer) {
        clearTimeout(this.restartTimer);
        this.restartTimer = null;
      }

      // First try to gracefully terminate
      if (this.process) {
        this.process.kill(2); // SIGINT

        // Set a timeout to force kill if needed
        setTimeout(() => {
          if (this.process) {
            this.process.kill(9); // SIGKILL
            this.process = null;
            this.setState(ProcessState.STOPPED);
            resolve();
          }
        }, 5000);
      } else {
        this.setState(ProcessState.STOPPED);
        resolve();
      }
    });
  }

  private handleExit(code: number): void {
    this.logger.info(`Process ${this.id} exited with code ${code}`);

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    this.process = null;

    if (code !== 0) {
      this.setState(ProcessState.FAILED);
    } else if (this.state !== ProcessState.STOPPING) {
      this.setState(ProcessState.STOPPED);
    }

    // Handle automatic restart
    if (code !== 0) {
      this.setState(ProcessState.FAILED);
      this.recordFailure();
    } else {
      // Reset failure count on clean exit
      this.failureTimes = [];
    }

    // Check circuit breaker before restarting
    if (
      this.config.autoRestart &&
      this.state !== ProcessState.STOPPING &&
      (!this.config.maxRestarts || this.restartCount < this.config.maxRestarts) &&
      !this.circuitOpen
    ) {
      const delay = this.calculateBackoff();
      this.logger.info(`Restarting process ${this.id} in ${delay}ms`);

      this.restartTimer = setTimeout(() => {
        this.restartCount++;
        this.start();
      }, delay);
    } else if (this.circuitOpen) {
      this.logger.info(`Not restarting ${this.id}: circuit breaker is open`);
    }
  }

  private calculateBackoff(): number {
    const baseDelay = this.config.restartDelay || 1000;
    const maxDelay = 60000; // 1 minute max

    // Use exponential backoff with a bit of random jitter
    const exponentialDelay = Math.min(baseDelay * Math.pow(2, this.restartCount), maxDelay);

    // Add jitter (±10%)
    const jitter = exponentialDelay * 0.1 * (Math.random() * 2 - 1);

    return Math.floor(exponentialDelay + jitter);
  }

  public isCircuitOpen(): boolean {
    return this.circuitOpen;
  }

  private checkProcessHealth(): void {
    if (!this.process || !this.process.pid) return;

    // This is a placeholder - in a real implementation, you would use
    // OS-specific tools or the Bun process API to get actual CPU and memory usage
    const cpuUsage = Math.random() * 100; // Simulate CPU usage
    const memoryUsage = Math.random() * 100; // Simulate memory usage

    // Check if process might be deadlocked (high CPU for extended period)
    if (cpuUsage > 95 && this.lastCpuUsage > 95) {
      const duration = (Date.now() - this.lastCpuTime) / 1000;
      if (duration > 30) {
        // 30 seconds of high CPU
        this.logger.warn(
          `Process ${this.id} might be deadlocked (CPU usage > 95% for ${duration}s)`,
          {
            cpu: cpuUsage,
            duration,
            pid: this.process.pid
          }
        );
      }
    } else {
      this.lastCpuTime = Date.now();
    }

    this.lastCpuUsage = cpuUsage;

    // Check for memory leaks
    if (memoryUsage > 90) {
      this.logger.warn(`Process ${this.id} high memory usage: ${memoryUsage.toFixed(1)}%`, {
        memory: memoryUsage,
        pid: this.process.pid
      });
    }

    // Include in next heartbeat
    this.nextHeartbeatStats = {
      cpu: cpuUsage,
      memory: memoryUsage,
      uptime: (Date.now() - this.startTime) / 1000,
      restartCount: this.restartCount
    };
  }

  public setState(state: ProcessState): void {
    const previousState = this.state;
    this.state = state;

    if (previousState !== state) {
      this.supervisor.broadcastStateChange(this.id, state, previousState);
      this.emit("stateChange", state, previousState);
    }
  }
}
