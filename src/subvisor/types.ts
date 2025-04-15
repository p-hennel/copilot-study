// Process states
export enum ProcessState {
  IDLE = "idle",
  BUSY = "busy",
  STARTING = "starting",
  STOPPING = "stopping",
  STOPPED = "stopped",
  FAILED = "failed"
}

// Message types
export enum MessageType {
  MESSAGE = "message",
  COMMAND = "command",
  HEARTBEAT = "heartbeat",
  STATE_CHANGE = "state_change",
  SUBSCRIPTION = "subscription"
}

// Process stats interface for tracking process state
export interface ProcessStats {
  id: string;
  state: ProcessState;
  lastHeartbeat: number;
  restartCount: number;
  uptime: number;
  cpu?: number;
  memory?: number;
}

// Define log level type for TypeScript
export type LogLevel = "debug" | "info" | "warn" | "error";

// Process configuration from settings schema
export interface ProcessConfig {
  id: string;
  script: string;
  args?: string[];
  autoRestart: boolean;
  restartDelay?: number;
  maxRestarts?: number;
  dependencies?: string[];
  subscribeToHeartbeats?: string[];
  env?: Record<string, string>;
}

// Message interface
export interface IPCMessage {
  origin: string;
  destination: string;
  type: MessageType;
  key: string;
  payload?: any;
  timestamp: number;
}

// Helper interface for the saved state
interface SavedState {
  processes: {
    id: string;
    state: ProcessState;
    lastHeartbeat: number;
    restartCount: number;
  }[];
  timestamp: number;
}
