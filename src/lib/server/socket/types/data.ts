import type { EntityType, JobProgress } from ".";

export interface CompletionData {
  success: boolean;
  finalCounts: Record<string, number>;
  message?: string;
  outputFiles?: string[];
}

export interface FailureData {
  error: string;
  errorType?: string;
  isRecoverable: boolean;
  resumeState?: JobProgress['resumeState'];
  partialCounts?: Record<string, number>;
}

export interface DiscoveryData {
  entityType: EntityType;
  entities: Array<{
    id: string;
    name: string;
    path: string;
    parentId?: string;
  }>;
}

export interface SimpleJob {
  id: string;
  entityType: EntityType;
  entityId: string;
  gitlabUrl: string;
  accessToken: string;
  resumeState?: JobProgress['resumeState'];
}

export interface HeartbeatData {
  activeJobs: number;
  totalProcessed: number;
  systemStatus: 'idle' | 'discovering' | 'processing' | 'error';
  memoryUsage?: any;
  uptime?: number;
}