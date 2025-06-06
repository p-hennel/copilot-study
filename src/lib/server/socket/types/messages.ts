import { z } from 'zod';

// Mirror the crawler's base message schema
export const BaseMessageSchema = z.object({
  type: z.string(),
  timestamp: z.string(),
  job_id: z.string().optional(),
});

// Progress data with entity counts (mirrored from crawler)
export const ProgressDataSchema = z.object({
  entity_type: z.string(),
  total_discovered: z.number(),
  total_processed: z.number(),
  current_page: z.number().optional(),
  items_per_page: z.number().optional(),
  sub_collection: z.string().optional(),
  estimated_remaining: z.number().optional(),
});

// Job assignment data (mirrored from crawler)
export const JobAssignmentSchema = z.object({
  job_id: z.string(),
  job_type: z.enum(['discover_namespaces', 'crawl_user', 'crawl_group', 'crawl_project']),
  entity_id: z.string().optional(),
  namespace_path: z.string().optional(),
  gitlab_host: z.string(),
  access_token: z.string(),
  priority: z.number().default(1),
  resume: z.boolean().default(false),
});

// Error context data (mirrored from crawler)
export const ErrorContextSchema = z.object({
  error_type: z.string(),
  error_message: z.string(),
  stack_trace: z.string().optional(),
  request_details: z.object({
    method: z.string().optional(),
    url: z.string().optional(),
    status_code: z.number().optional(),
    response_headers: z.record(z.string()).optional(),
  }).optional(),
  retry_count: z.number().default(0),
  is_recoverable: z.boolean().default(true),
});

// Discovered job schema (from jobs_discovered message)
export const DiscoveredJobSchema = z.object({
  job_type: z.enum(['discover_namespaces', 'crawl_user', 'crawl_group', 'crawl_project']),
  entity_id: z.string(),
  namespace_path: z.string(),
  entity_name: z.string(),
  priority: z.number().default(1),
  estimated_size: z.record(z.number()).optional(),
});

// Discovery summary schema
export const DiscoverySummarySchema = z.object({
  total_users: z.number(),
  total_groups: z.number(),
  total_projects: z.number(),
  hierarchy_depth: z.number(),
});

// Simple job schema (mirrored from crawler unified-types.ts)
export const SimpleJobSchema = z.object({
  id: z.string(),
  entityType: z.enum(['project', 'group', 'user', 'issue', 'merge_request', 'commit', 'branch', 'pipeline', 'release']),
  entityId: z.string(),
  gitlabUrl: z.string(),
  accessToken: z.string(),
  resumeState: z.object({
    lastEntityId: z.string().optional(),
    currentPage: z.number().optional(),
    entityType: z.string().optional(),
  }).optional(),
});

// Discovery data schema (mirrored from crawler unified-types.ts)
export const DiscoveryDataSchema = z.object({
  entityType: z.enum(['project', 'group', 'user', 'issue', 'merge_request', 'commit', 'branch', 'pipeline', 'release']),
  entities: z.array(z.object({
    id: z.string(),
    name: z.string(),
    path: z.string(),
    parentId: z.string().optional(),
  })),
});

// Crawler → Web App Messages (mirrored from crawler)
export const HeartbeatMessageSchema = BaseMessageSchema.extend({
  type: z.literal('heartbeat'),
  data: z.object({
    active_jobs: z.number(),
    last_activity: z.string(),
    system_status: z.enum(['idle', 'discovering', 'crawling', 'error']),
  }),
});

export const JobStartedMessageSchema = BaseMessageSchema.extend({
  type: z.literal('job_started'),
  data: z.object({
    job_type: z.string(),
    entity_type: z.string().optional(),
    namespace_path: z.string().optional(),
    estimated_duration: z.number().optional(),
  }),
});

export const JobProgressMessageSchema = BaseMessageSchema.extend({
  type: z.literal('job_progress'),
  data: z.object({
    job_type: z.string().optional(),
    progress: z.array(ProgressDataSchema),
    overall_completion: z.number().min(0).max(1),
    time_elapsed: z.number(),
    estimated_time_remaining: z.number().optional(),
  }),
});

export type ProgressDataType = z.infer<typeof ProgressDataSchema>;

export const JobCompletedMessageSchema = BaseMessageSchema.extend({
  type: z.literal('job_completed'),
  data: z.object({
    job_type: z.string(),
    final_counts: z.array(ProgressDataSchema),
    total_duration: z.number(),
    output_files: z.array(z.string()),
    summary: z.string(),
  }),
});

export type ErrorContextType = z.infer<typeof ErrorContextSchema>

export const JobFailedMessageSchema = BaseMessageSchema.extend({
  type: z.literal('job_failed'),
  data: z.object({
    job_type: z.string(),
    error_context: ErrorContextSchema,
    partial_results: z.array(ProgressDataSchema).optional(),
    recovery_suggestion: z.string().optional(),
  }),
});

export const JobsDiscoveredMessageSchema = BaseMessageSchema.extend({
  type: z.literal('jobs_discovered'),
  job_id: z.string(), // Required for discovery messages
  data: z.object({
    discovered_jobs: z.array(DiscoveredJobSchema),
    discovery_summary: DiscoverySummarySchema,
  }),
});

export const TokenRefreshRequestMessageSchema = BaseMessageSchema.extend({
  type: z.literal('token_refresh_request'),
  data: z.object({
    current_token_expired: z.boolean(),
    last_successful_request: z.string().optional(),
    error_details: z.string().optional(),
  }),
});

// Job request message schema (crawler sends this to request jobs)
export const JobRequestMessageSchema = BaseMessageSchema.extend({
  type: z.literal('job_request'),
  data: z.object({}), // Empty data as per crawler implementation
});

// Discovery message schema (crawler sends during entity discovery)
export const DiscoveryMessageSchema = BaseMessageSchema.extend({
  type: z.literal('discovery'),
  data: DiscoveryDataSchema,
});

// Web App → Crawler Messages (mirrored from crawler)
export const JobAssignmentMessageSchema = BaseMessageSchema.extend({
  type: z.literal('job_assignment'),
  data: JobAssignmentSchema,
});

// Job response message schema (backend sends jobs to crawler)
export const JobResponseMessageSchema = BaseMessageSchema.extend({
  type: z.literal('job_response'),
  data: z.object({
    jobs: z.array(SimpleJobSchema),
  }),
});

export const TokenRefreshResponseMessageSchema = BaseMessageSchema.extend({
  type: z.literal('token_refresh_response'),
  data: z.object({
    access_token: z.string(),
    expires_at: z.string().optional(),
    refresh_successful: z.boolean(),
  }),
});

export const ShutdownMessageSchema = BaseMessageSchema.extend({
  type: z.literal('shutdown'),
  data: z.object({
    graceful: z.boolean().default(true),
    timeout_seconds: z.number().default(30),
    reason: z.string().optional(),
  }),
});

// Union types for message validation
export const CrawlerMessageSchema = z.discriminatedUnion('type', [
  HeartbeatMessageSchema,
  JobStartedMessageSchema,
  JobProgressMessageSchema,
  JobCompletedMessageSchema,
  JobFailedMessageSchema,
  JobsDiscoveredMessageSchema,
  TokenRefreshRequestMessageSchema,
  JobRequestMessageSchema,
  DiscoveryMessageSchema,
]);

export const WebAppMessageSchema = z.discriminatedUnion('type', [
  JobAssignmentMessageSchema,
  TokenRefreshResponseMessageSchema,
  ShutdownMessageSchema,
  JobResponseMessageSchema,
]);

// Web application specific extensions
export const WebAppJobAssignmentDataSchema = JobAssignmentSchema.extend({
  // Additional web app specific fields
  account_id: z.string(),
  user_id: z.string().optional(),
  provider: z.enum(['gitlab-onprem', 'gitlab-cloud']),
  web_app_job_id: z.string(), // Maps to database job.id
  created_by_user_id: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.any()).optional(),
});

export const WebAppProgressUpdateSchema = z.object({
  web_app_job_id: z.string(),
  crawler_job_id: z.string(),
  progress_data: z.array(ProgressDataSchema),
  overall_completion: z.number().min(0).max(1),
  time_elapsed: z.number(),
  estimated_time_remaining: z.number().optional(),
  status: z.enum(['running', 'paused', 'completed', 'failed']),
  last_update: z.string(),
});

export const WebAppJobStatusSchema = z.object({
  web_app_job_id: z.string(),
  crawler_job_id: z.string().optional(),
  status: z.enum(['queued', 'assigned', 'running', 'paused', 'completed', 'failed', 'cancelled']),
  started_at: z.string().optional(),
  finished_at: z.string().optional(),
  error_message: z.string().optional(),
  output_files: z.array(z.string()).optional(),
  summary: z.string().optional(),
});

// Enhanced error handling for web application context
export const WebAppErrorContextSchema = ErrorContextSchema.extend({
  web_app_job_id: z.string(),
  crawler_job_id: z.string().optional(),
  account_id: z.string(),
  user_id: z.string().optional(),
  provider: z.enum(['gitlab-onprem', 'gitlab-cloud']),
  requires_user_action: z.boolean().default(false),
  admin_notification_sent: z.boolean().default(false),
});

// Socket connection management
export const SocketConnectionEventSchema = z.object({
  event_type: z.enum(['connected', 'disconnected', 'error', 'heartbeat_timeout']),
  crawler_id: z.string().optional(),
  timestamp: z.string(),
  details: z.record(z.any()).optional(),
});

// Type exports
export type BaseMessage = z.infer<typeof BaseMessageSchema>;
export type ProgressData = z.infer<typeof ProgressDataSchema>;
export type JobAssignment = z.infer<typeof JobAssignmentSchema>;
export type ErrorContext = z.infer<typeof ErrorContextSchema>;
export type DiscoveredJob = z.infer<typeof DiscoveredJobSchema>;
export type DiscoverySummary = z.infer<typeof DiscoverySummarySchema>;

export type SimpleJob = z.infer<typeof SimpleJobSchema>;
export type DiscoveryData = z.infer<typeof DiscoveryDataSchema>;

export type HeartbeatMessage = z.infer<typeof HeartbeatMessageSchema>;
export type JobStartedMessage = z.infer<typeof JobStartedMessageSchema>;
export type JobProgressMessage = z.infer<typeof JobProgressMessageSchema>;
export type JobCompletedMessage = z.infer<typeof JobCompletedMessageSchema>;
export type JobFailedMessage = z.infer<typeof JobFailedMessageSchema>;
export type JobsDiscoveredMessage = z.infer<typeof JobsDiscoveredMessageSchema>;
export type TokenRefreshRequestMessage = z.infer<typeof TokenRefreshRequestMessageSchema>;
export type JobRequestMessage = z.infer<typeof JobRequestMessageSchema>;
export type DiscoveryMessage = z.infer<typeof DiscoveryMessageSchema>;

export type JobAssignmentMessage = z.infer<typeof JobAssignmentMessageSchema>;
export type TokenRefreshResponseMessage = z.infer<typeof TokenRefreshResponseMessageSchema>;
export type ShutdownMessage = z.infer<typeof ShutdownMessageSchema>;
export type JobResponseMessage = z.infer<typeof JobResponseMessageSchema>;

export type CrawlerMessage = z.infer<typeof CrawlerMessageSchema>;
export type WebAppMessage = z.infer<typeof WebAppMessageSchema>;

export type WebAppJobAssignmentData = z.infer<typeof WebAppJobAssignmentDataSchema>;
export type WebAppProgressUpdate = z.infer<typeof WebAppProgressUpdateSchema>;
export type WebAppJobStatus = z.infer<typeof WebAppJobStatusSchema>;
export type WebAppErrorContext = z.infer<typeof WebAppErrorContextSchema>;
export type SocketConnectionEvent = z.infer<typeof SocketConnectionEventSchema>;

// Message processing result types
export interface MessageProcessingResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  shouldRetry?: boolean;
  retryAfter?: number;
}

// Real-time subscription types for web clients
export interface WebSocketSubscription {
  id: string;
  user_id: string;
  account_id: string;
  job_ids: string[];
  event_types: string[];
  created_at: Date;
  last_activity: Date;
}

export interface WebSocketMessage {
  subscription_id: string;
  event_type: string;
  payload: any;
  timestamp: string;
}

// Crawler command types for web application
export interface CrawlerCommand {
  id: string;
  type: 'start_job' | 'pause_job' | 'resume_job' | 'cancel_job' | 'shutdown';
  payload: any;
  created_at: string;
  expires_at?: string;
}

// Message validation utilities
export const validateCrawlerMessage = (message: unknown): MessageProcessingResult<CrawlerMessage> => {
  try {
    const parsed = CrawlerMessageSchema.parse(message);
    return { success: true, data: parsed };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown validation error' 
    };
  }
};

export const validateWebAppMessage = (message: unknown): MessageProcessingResult<WebAppMessage> => {
  try {
    const parsed = WebAppMessageSchema.parse(message);
    return { success: true, data: parsed };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown validation error' 
    };
  }
};