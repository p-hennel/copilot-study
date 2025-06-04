import type { AreaType, CrawlCommand, JobStatus, TokenProvider } from '$lib/types';
import type { 
  WebAppJobAssignmentData, 
  WebAppProgressUpdate, 
  WebAppJobStatus, 
  ProgressData, 
  ProgressDataType,
  ErrorContextType
} from './messages';

// Database entity interfaces
export interface Job {
  id: string;
  created_at: Date;
  started_at?: Date | null;
  finished_at?: Date | null;
  status: JobStatus;
  command: CrawlCommand;
  full_path?: string | null;
  branch?: string | null;
  from?: Date | null;
  to?: Date | null;
  accountId: string;
  spawned_from?: string | null;
  resumeState?: Record<string, any> | null;
  progress?: Record<string, any> | null;
  userId?: string | null;
  provider?: TokenProvider | null;
  gitlabGraphQLUrl?: string | null;
  updated_at?: Date | null;
}

export interface JobInsert {
  id?: string;
  created_at?: Date;
  started_at?: Date | null;
  finished_at?: Date | null;
  status?: JobStatus;
  command: CrawlCommand;
  full_path?: string | null;
  branch?: string | null;
  from?: Date | null;
  to?: Date | null;
  accountId: string;
  spawned_from?: string | null;
  resumeState?: Record<string, any> | null;
  progress?: Record<string, any> | null;
  userId?: string | null;
  provider?: TokenProvider | null;
  gitlabGraphQLUrl?: string | null;
  updated_at?: Date | null;
}

export interface Area {
  full_path: string;
  gitlab_id: string;
  name?: string | null;
  type: AreaType;
  created_at: Date;
}

export interface NewJobType {
  accountId: string;
  full_path?: string;
  command: CrawlCommand;
  from?: Date;
  spawned_from?: string;
}

export interface UpdateJobType {
  id?: string;
  status: JobStatus;
  startedAt?: Date | null;
  finishedAt?: Date | null;
}

// Database integration interfaces
export interface JobDatabaseAdapter {
  createJob(data: CreateSocketJobData): Promise<Job>;
  updateJob(id: string, data: UpdateSocketJobData): Promise<Job>;
  getJob(id: string): Promise<Job | null>;
  getActiveJobs(accountId?: string): Promise<Job[]>;
  getJobsByStatus(status: JobStatus, accountId?: string): Promise<Job[]>;
  deleteJob(id: string): Promise<void>;
}

export interface AreaDatabaseAdapter {
  getOrCreateArea(fullPath: string, gitlabId: string, name: string, type: AreaType): Promise<Area>;
  getArea(fullPath: string): Promise<Area | null>;
  getAreasByAccount(accountId: string): Promise<Area[]>;
}

// Socket-specific job creation data
export interface CreateSocketJobData {
  accountId: string;
  userId?: string;
  command: CrawlCommand;
  fullPath?: string;
  branch?: string;
  provider: TokenProvider;
  gitlabGraphQLUrl?: string;
  spawnedFrom?: string;
  resumeState?: Record<string, any>;
  metadata?: SocketJobMetadata;
}

// Socket-specific job update data
export interface UpdateSocketJobData {
  status?: JobStatus;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  progress?: SocketJobProgress;
  resumeState?: Record<string, any>;
  metadata?: SocketJobMetadata;
}

// Enhanced job metadata for socket operations
export interface SocketJobMetadata {
  crawlerJobId?: string;
  socketConnectionId?: string;
  priority?: number;
  tags?: string[];
  estimatedDuration?: number;
  retryCount?: number;
  maxRetries?: number;
  lastHeartbeat?: string;
  errorHistory?: SocketJobError[];
  outputFiles?: string[];
  summary?: string;
  webAppJobId?: string; // For tracking in web interface
}

// Enhanced progress tracking
export interface SocketJobProgress {
  overall_completion: number;
  time_elapsed: number;
  estimated_time_remaining?: number;
  entities: ProgressData[];
  last_update: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
  milestones?: ProgressMilestone[];
}

export interface ProgressMilestone {
  name: string;
  timestamp: Date;
  metadata: {
    description?: string,
    job_type?: string,
  } & ({
    total_duration?: number,
    output_files?: string[],
    final_counts?: ProgressDataType[],
  } | {
    entity_type?: string,
    namespace_path?: string
  } | {
    error_context?: ErrorContextType,
    recovery_suggestion?: string,
    is_recoverable?: boolean,
  } | {
    completion_percentage?: number,
    threshold?: number
  })
}

// Error tracking for jobs
export interface SocketJobError {
  timestamp: string;
  error_type: string;
  error_message: string;
  stack_trace?: string;
  context?: Record<string, any>;
  retry_count: number;
  is_recoverable: boolean;
  resolution?: string;
}

// Job assignment mapping between web app and crawler
export interface JobAssignmentMapping {
  webAppJobId: string;
  crawlerJobId: string;
  accountId: string;
  userId?: string;
  createdAt: Date;
  assignedAt?: Date;
  completedAt?: Date;
  status: 'pending' | 'assigned' | 'running' | 'completed' | 'failed' | 'cancelled';
  metadata?: Record<string, any>;
}

// Database queries and operations
export interface SocketDatabaseOperations {
  // Job operations
  createJobFromAssignment(assignment: WebAppJobAssignmentData): Promise<Job>;
  updateJobFromProgress(jobId: string, progress: WebAppProgressUpdate): Promise<Job>;
  updateJobStatus(jobId: string, status: WebAppJobStatus): Promise<Job>;
  
  // Progress tracking
  saveProgressUpdate(jobId: string, progress: SocketJobProgress): Promise<void>;
  getJobProgress(jobId: string): Promise<SocketJobProgress | null>;
  
  // Error tracking
  logJobError(jobId: string, error: SocketJobError): Promise<void>;
  getJobErrors(jobId: string): Promise<SocketJobError[]>;
  
  // Assignment mapping
  createAssignmentMapping(mapping: Omit<JobAssignmentMapping, 'createdAt'>): Promise<JobAssignmentMapping>;
  getAssignmentMapping(webAppJobId: string): Promise<JobAssignmentMapping | null>;
  updateAssignmentStatus(webAppJobId: string, status: JobAssignmentMapping['status']): Promise<void>;
  
  // Cleanup operations
  cleanupCompletedJobs(olderThan: Date): Promise<number>;
  cleanupFailedJobs(olderThan: Date, maxRetries: number): Promise<number>;
}

// Database transaction wrapper
export interface DatabaseTransaction {
  execute<T>(operation: (adapter: SocketDatabaseOperations) => Promise<T>): Promise<T>;
  rollback(): Promise<void>;
  commit(): Promise<void>;
}

// Job queue management
export interface JobQueueEntry {
  id: string;
  webAppJobId: string;
  priority: number;
  scheduledAt: Date;
  attempts: number;
  maxAttempts: number;
  data: WebAppJobAssignmentData;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  lastAttemptAt?: Date;
}

export interface JobQueueOperations {
  enqueue(job: Omit<JobQueueEntry, 'id' | 'attempts' | 'status' | 'scheduledAt'>): Promise<JobQueueEntry>;
  dequeue(limit?: number): Promise<JobQueueEntry[]>;
  markProcessing(id: string): Promise<void>;
  markCompleted(id: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  getQueueStatus(): Promise<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  }>;
  retryFailed(maxAge: Date): Promise<number>;
  cleanup(olderThan: Date): Promise<number>;
}

// Connection state tracking
export interface SocketConnectionState {
  id: string;
  crawlerId?: string;
  connectedAt: Date;
  lastHeartbeat: Date;
  isActive: boolean;
  activeJobs: string[];
  systemStatus: 'idle' | 'discovering' | 'crawling' | 'error';
  metadata?: Record<string, any>;
}

export interface ConnectionStateOperations {
  registerConnection(connection: Omit<SocketConnectionState, 'id' | 'connectedAt' | 'lastHeartbeat' | 'isActive'>): Promise<SocketConnectionState>;
  updateHeartbeat(connectionId: string, status?: SocketConnectionState['systemStatus']): Promise<void>;
  updateActiveJobs(connectionId: string, jobIds: string[]): Promise<void>;
  markDisconnected(connectionId: string): Promise<void>;
  getActiveConnections(): Promise<SocketConnectionState[]>;
  getConnection(id: string): Promise<SocketConnectionState | null>;
  cleanupStaleConnections(timeout: number): Promise<number>;
}

// Database schema validation
export const validateJobForSocket = (job: Job): boolean => {
  return !!(
    job.id &&
    job.accountId &&
    job.command &&
    job.status
  );
};

export const validateAreaForSocket = (area: Area): boolean => {
  return !!(
    area.full_path &&
    area.gitlab_id &&
    area.type
  );
};

// Database event types for real-time updates
export type DatabaseEvent = 
  | { type: 'job_created'; data: Job }
  | { type: 'job_updated'; data: Job }
  | { type: 'job_deleted'; data: { id: string } }
  | { type: 'progress_updated'; data: { jobId: string; progress: SocketJobProgress } }
  | { type: 'error_logged'; data: { jobId: string; error: SocketJobError } };

export interface DatabaseEventSubscription {
  id: string;
  accountId?: string;
  jobIds?: string[];
  eventTypes: DatabaseEvent['type'][];
  callback: (event: DatabaseEvent) => void;
  createdAt: Date;
}