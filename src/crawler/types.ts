// src/crawler/types.ts

// --- IPC Command Types ---

export type CommandType =
  | "START_JOB"
  | "PAUSE_CRAWLER"
  | "RESUME_CRAWLER"
  | "GET_STATUS"
  | "SHUTDOWN";

export interface BaseCommand {
  type: CommandType;
}

export interface StartJobCommand extends BaseCommand {
  type: "START_JOB";
  jobId: string;
  targetPath: string; // e.g., 'groups/my-group' or 'projects/my-project'
  gitlabApiUrl: string;
  gitlabToken: string;
  dataTypes: string[]; // e.g., ['issues', 'mergeRequests']
  progress?: Record<string, JobDataTypeProgress>; // Added: Optional progress for resuming
}

export interface PauseCrawlerCommand extends BaseCommand {
  type: "PAUSE_CRAWLER";
}

export interface ResumeCrawlerCommand extends BaseCommand {
  type: "RESUME_CRAWLER";
}

export interface GetStatusCommand extends BaseCommand {
  type: "GET_STATUS";
}

export interface ShutdownCommand extends BaseCommand {
  type: "SHUTDOWN";
}

// Add other specific command interfaces if needed

export type CrawlerCommand =
  | StartJobCommand
  | PauseCrawlerCommand
  | ResumeCrawlerCommand
  | GetStatusCommand
  | ShutdownCommand;

// --- IPC Status Types ---

export type CrawlerState = "idle" | "running" | "paused" | "error";

export interface CrawlerStatus {
  state: CrawlerState;
  currentJobId: string | null;
  queueSize: number;
  error?: string; // Optional error message
  lastHeartbeat?: number; // Timestamp of the last heartbeat
}

// --- Job Related Types ---

// Structure to hold progress for a specific data type within a job
export interface JobDataTypeProgress {
  afterCursor?: string; // Stores the endCursor from the last successful page fetch
  // Add other progress indicators if needed, e.g., pages fetched, errors encountered
  lastAttempt?: number; // Timestamp of the last attempt for this type
  errorCount?: number; // Count of errors for this type
}

export interface Job {
  id: string;
  targetPath: string;
  gitlabApiUrl: string;
  gitlabToken: string;
  dataTypes: string[];
  status: "pending" | "running" | "paused" | "completed" | "failed";
  progress: Record<string, JobDataTypeProgress>; // Store progress per data type
  createdAt: Date;
  updatedAt: Date;
  error?: string;
}

// --- GitLab API Related Types ---
// Define types for GitLab API responses as needed, e.g.:
export interface GitlabUser {
  id: string;
  username: string;
  name: string;
  // ... other fields
}

export interface GitlabIssue {
  id: string;
  iid: string;
  title: string;
  // ... other fields
}

// Add more types for Merge Requests, Milestones, etc.

// --- Storage Related Types ---

export interface StorageMetadata {
  dataType: string;
  targetPath: string;
  timestamp: number;
  // Add other relevant metadata
}
