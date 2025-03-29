import type { JobPayload, JobState, FetcherState } from './types';

// --- Message Types ---

export enum MessageType {
  // Backend -> Crawler
  START_JOB = 'START_JOB',
  CONTROL_COMMAND = 'CONTROL_COMMAND', // Pause, Resume, Shutdown
  LOAD_STATE_RESPONSE = 'LOAD_STATE_RESPONSE',

  // Crawler -> Backend
  CRAWLER_READY = 'CRAWLER_READY',
  HEARTBEAT = 'HEARTBEAT',
  JOB_STATUS_UPDATE = 'JOB_STATUS_UPDATE',
  SAVE_STATE_REQUEST = 'SAVE_STATE_REQUEST',
  LOAD_STATE_REQUEST = 'LOAD_STATE_REQUEST',
}

// --- Backend -> Crawler Message Interfaces ---

export interface StartJobCommand {
  type: MessageType.START_JOB;
  jobId: string;
  payload: JobPayload;
  initialState?: JobState; // Optional initial state (e.g., cursors for resuming)
}

export type ControlCommandType = 'PAUSE' | 'RESUME' | 'SHUTDOWN';

export interface ControlCommand {
  type: MessageType.CONTROL_COMMAND;
  command: ControlCommandType;
  jobId?: string; // Optional: If targeting a specific job, otherwise global
}

export interface LoadStateResponse {
    type: MessageType.LOAD_STATE_RESPONSE;
    jobId: string;
    dataType: string;
    state: FetcherState | null; // The retrieved state or null if none exists
}

// --- Crawler -> Backend Message Interfaces ---

export interface CrawlerReadyMessage {
  type: MessageType.CRAWLER_READY;
  pid: number; // Process ID of the crawler
}

export interface HeartbeatMessage {
  type: MessageType.HEARTBEAT;
  timestamp: number; // Unix timestamp (ms)
}

export type JobStatus = 'started' | 'running' | 'paused' | 'completed' | 'failed';

export interface JobStatusUpdateMessage {
  type: MessageType.JOB_STATUS_UPDATE;
  jobId: string;
  status: JobStatus;
  progress?: number; // Optional progress indicator (e.g., percentage, items processed)
  error?: string; // Optional error message if status is 'failed'
  dataType?: string; // Optional: Specific data type this update refers to
  message?: string; // Optional: Human-readable status message
}

export interface SaveStateRequest {
  type: MessageType.SAVE_STATE_REQUEST;
  jobId: string;
  dataType: string;
  state: FetcherState; // The state to be saved (e.g., { cursor: '...' })
}

export interface LoadStateRequest {
    type: MessageType.LOAD_STATE_REQUEST;
    jobId: string;
    dataType: string; // The specific data type state to load
}

// --- Union Types for Type Guards ---

export type BackendToCrawlerMessage =
  | StartJobCommand
  | ControlCommand
  | LoadStateResponse;

export type CrawlerToBackendMessage =
  | CrawlerReadyMessage
  | HeartbeatMessage
  | JobStatusUpdateMessage
  | SaveStateRequest
  | LoadStateRequest;

// --- Type Guards ---

export function isBackendToCrawlerMessage(msg: any): msg is BackendToCrawlerMessage {
  return msg && typeof msg === 'object' && typeof msg.type === 'string' &&
         (msg.type === MessageType.START_JOB ||
          msg.type === MessageType.CONTROL_COMMAND ||
          msg.type === MessageType.LOAD_STATE_RESPONSE);
}

export function isCrawlerToBackendMessage(msg: any): msg is CrawlerToBackendMessage {
  return msg && typeof msg === 'object' && typeof msg.type === 'string' &&
         (msg.type === MessageType.CRAWLER_READY ||
          msg.type === MessageType.HEARTBEAT ||
          msg.type === MessageType.JOB_STATUS_UPDATE ||
          msg.type === MessageType.SAVE_STATE_REQUEST ||
          msg.type === MessageType.LOAD_STATE_REQUEST);
}

// --- IPC Helper Functions (Placeholder - Implementation in index.ts/job-manager.ts) ---

// Example: Function to send messages (implementation depends on Bun IPC setup)
export function sendToBackend(message: CrawlerToBackendMessage) {
  if (process.send) {
    process.send(message);
  } else {
    console.warn('IPC channel not available (process.send is undefined). Cannot send message:', message);
    // In a real scenario, might buffer or throw an error
  }
}

// Placeholder for receiving messages (will be handled by listener in index.ts)
export function setupIpcListener(handler: (message: BackendToCrawlerMessage) => void) {
  process.on('message', (msg: any) => {
    if (isBackendToCrawlerMessage(msg)) {
      handler(msg);
    } else {
      console.warn('Received unknown IPC message:', msg);
    }
  });

  // Handle disconnect or errors
  process.on('disconnect', () => {
    console.error('IPC channel disconnected. Exiting crawler.');
    process.exit(1); // Or attempt reconnection logic
  });
  process.on('error', (err) => {
    console.error('IPC error:', err);
    // Potentially exit or handle specific errors
  });
}
