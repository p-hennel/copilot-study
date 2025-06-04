import type { ProgressData } from './messages.js';
import type { Job } from './database.js';

// Progress tracking state
export enum ProgressState {
  INITIALIZING = 'initializing',
  DISCOVERING = 'discovering',
  PROCESSING = 'processing',
  PAUSED = 'paused',
  COMPLETING = 'completing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

// Progress tracking interface
export interface ProgressTracker {
  readonly jobId: string;
  readonly state: ProgressState;
  readonly startTime: Date;
  readonly lastUpdate: Date;
  readonly progress: JobProgress;
  
  // State management
  updateState(state: ProgressState): void;
  updateProgress(update: ProgressUpdate): void;
  addEntity(entityType: string, totalCount?: number): void;
  updateEntity(entityType: string, update: EntityProgressUpdate): void;
  
  // Progress calculation
  getOverallCompletion(): number;
  getEstimatedTimeRemaining(): number | null;
  getProcessingRate(): number;
  
  // Milestones
  addMilestone(milestone: ProgressMilestone): void;
  getMilestones(): ProgressMilestone[];
  
  // Reporting
  getSnapshot(): ProgressSnapshot;
  getDetailedReport(): DetailedProgressReport;
  
  // Event handling
  on(event: ProgressEvent['type'], handler: ProgressEventHandler): void;
  off(event: ProgressEvent['type'], handler: ProgressEventHandler): void;
}

// Overall job progress
export interface JobProgress {
  overall_completion: number; // 0-1
  time_elapsed: number; // milliseconds
  estimated_time_remaining?: number; // milliseconds
  entities: EntityProgress[];
  state: ProgressState;
  last_update: Date;
  processing_rate?: number; // items per second
  throughput_metrics?: ThroughputMetrics;
}

// Entity-specific progress
export interface EntityProgress extends ProgressData {
  id: string;
  entity_type: string;
  total_discovered: number;
  total_processed: number;
  current_page?: number;
  items_per_page?: number;
  sub_collection?: string;
  estimated_remaining?: number;
  
  // Additional tracking fields
  started_at?: Date;
  last_processed_at?: Date;
  processing_rate?: number; // items per second
  error_count?: number;
  retry_count?: number;
  completion_percentage: number; // 0-100
  status: 'pending' | 'active' | 'paused' | 'completed' | 'failed';
}

// Progress update data
export interface ProgressUpdate {
  entities?: EntityProgressUpdate[];
  overall_completion?: number;
  state?: ProgressState;
  estimated_time_remaining?: number;
  metadata?: Record<string, any>;
}

export interface EntityProgressUpdate {
  entity_type: string;
  total_discovered?: number;
  total_processed?: number;
  current_page?: number;
  items_per_page?: number;
  error_count?: number;
  status?: EntityProgress['status'];
  metadata?: Record<string, any>;
}

// Progress milestones
export interface ProgressMilestone {
  id: string;
  name: string;
  description?: string;
  timestamp: Date;
  progress_at_milestone: number; // 0-1
  metadata?: Record<string, any>;
}

// Progress snapshot for reporting
export interface ProgressSnapshot {
  jobId: string;
  timestamp: Date;
  state: ProgressState;
  overall_completion: number;
  time_elapsed: number;
  estimated_time_remaining?: number;
  entity_summary: {
    total_entities: number;
    completed_entities: number;
    failed_entities: number;
    active_entities: number;
  };
  performance_metrics: {
    processing_rate: number;
    throughput: number;
    error_rate: number;
  };
}

// Detailed progress report
export interface DetailedProgressReport {
  job: Job;
  progress: JobProgress;
  entities: EntityProgress[];
  milestones: ProgressMilestone[];
  timeline: ProgressTimelineEntry[];
  performance: PerformanceMetrics;
  issues: ProgressIssue[];
}

// Progress timeline
export interface ProgressTimelineEntry {
  timestamp: Date;
  event_type: 'started' | 'entity_discovered' | 'entity_completed' | 'milestone' | 'error' | 'paused' | 'resumed' | 'completed';
  entity_type?: string;
  description: string;
  metadata?: Record<string, any>;
}

// Performance metrics
export interface PerformanceMetrics {
  overall_rate: number; // items per second
  peak_rate: number;
  average_rate: number;
  current_rate: number;
  efficiency: number; // 0-1 (actual vs estimated)
  consistency: number; // 0-1 (rate variance)
  error_rate: number; // errors per item
  retry_rate: number; // retries per item
}

// Throughput metrics
export interface ThroughputMetrics {
  requests_per_second: number;
  items_per_minute: number;
  bytes_per_second: number;
  peak_throughput: number;
  average_throughput: number;
  current_throughput: number;
}

// Progress issues and warnings
export interface ProgressIssue {
  id: string;
  type: 'warning' | 'error' | 'performance';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  entity_type?: string;
  timestamp: Date;
  suggested_action?: string;
  auto_resolved?: boolean;
  resolution_timestamp?: Date;
  metadata?: Record<string, any>;
}

// Progress events
export type ProgressEvent = 
  | { type: 'state_changed'; previousState: ProgressState; newState: ProgressState; tracker: ProgressTracker }
  | { type: 'progress_updated'; update: ProgressUpdate; tracker: ProgressTracker }
  | { type: 'entity_discovered'; entityType: string; totalCount: number; tracker: ProgressTracker }
  | { type: 'entity_completed'; entityType: string; finalCount: number; tracker: ProgressTracker }
  | { type: 'milestone_reached'; milestone: ProgressMilestone; tracker: ProgressTracker }
  | { type: 'performance_alert'; issue: ProgressIssue; tracker: ProgressTracker }
  | { type: 'completion_estimate_updated'; estimate: number; tracker: ProgressTracker };

export type ProgressEventHandler = (event: ProgressEvent) => void;

// Progress aggregation for multiple jobs
export interface ProgressAggregator {
  addTracker(tracker: ProgressTracker): void;
  removeTracker(jobId: string): void;
  getAggregateProgress(): AggregateProgress;
  getJobProgress(jobId: string): JobProgress | null;
  getAllJobProgress(): Map<string, JobProgress>;
}

export interface AggregateProgress {
  total_jobs: number;
  active_jobs: number;
  completed_jobs: number;
  failed_jobs: number;
  overall_completion: number; // 0-1
  estimated_time_remaining?: number;
  combined_throughput: number;
  resource_utilization: {
    cpu_usage: number;
    memory_usage: number;
    network_usage: number;
  };
}

// Progress persistence
export interface ProgressPersistence {
  saveProgress(jobId: string, progress: JobProgress): Promise<void>;
  loadProgress(jobId: string): Promise<JobProgress | null>;
  saveSnapshot(snapshot: ProgressSnapshot): Promise<void>;
  getSnapshots(jobId: string, limit?: number): Promise<ProgressSnapshot[]>;
  cleanup(olderThan: Date): Promise<number>;
}

// Progress configuration
export interface ProgressConfig {
  updateInterval: number; // milliseconds
  snapshotInterval: number; // milliseconds
  estimationWindow: number; // number of samples for rate calculation
  performanceThresholds: {
    slowRate: number; // items per second
    highErrorRate: number; // percentage
    memoryWarning: number; // bytes
  };
  autoMilestones: {
    enabled: boolean;
    percentageThresholds: number[]; // e.g., [25, 50, 75, 90]
  };
}

// Progress utilities
export const calculateCompletion = (entities: EntityProgress[]): number => {
  if (entities.length === 0) return 0;
  
  const totalItems = entities.reduce((sum, e) => sum + e.total_discovered, 0);
  const processedItems = entities.reduce((sum, e) => sum + e.total_processed, 0);
  
  return totalItems > 0 ? processedItems / totalItems : 0;
};

export const estimateTimeRemaining = (
  progress: number,
  timeElapsed: number,
  processingRate: number
): number | null => {
  if (progress >= 1 || processingRate <= 0) return null;
  
  const remainingWork = 1 - progress;
  const estimatedSeconds = remainingWork / processingRate;
  
  return estimatedSeconds * 1000; // Convert to milliseconds
};

export const calculateProcessingRate = (
  totalProcessed: number,
  timeElapsed: number
): number => {
  if (timeElapsed <= 0) return 0;
  return totalProcessed / (timeElapsed / 1000); // items per second
};

// Progress factory
export interface ProgressFactory {
  createTracker(jobId: string, config?: ProgressConfig): ProgressTracker;
  createAggregator(): ProgressAggregator;
  createPersistence(): ProgressPersistence;
}