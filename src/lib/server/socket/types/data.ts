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
  stackTrace?: string;
  isRecoverable: boolean;
  resumeState?: JobProgress['resumeState'];
  partialCounts?: Record<string, number>;
  // Additional context fields from error context
  requestDetails?: {
    method?: string;
    url?: string;
    status_code?: number;
    response_headers?: Record<string, string>;
  };
  retryCount?: number;
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