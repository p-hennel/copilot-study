/**
 * Socket Message Types - Web App Socket Communication
 * 
 * This file re-exports all socket message schemas and types from lib-common
 * to ensure perfect alignment between web app and crawler.
 * 
 * ALL SOCKET MESSAGE SCHEMAS ARE NOW SHARED FROM LIB-COMMON
 */

import { z } from 'zod';

// Import ALL shared schemas and utilities from lib-common
import {
  // Core schemas
  EntityTypeSchema,
  JobStatusSchema,
  TokenProviderSchema,
  
  // Message data schemas
  SocketMessageSchema,
  HeartbeatDataSchema,
  ProgressDataSchema,
  CompletionDataSchema,
  FailureDataSchema,
  DiscoveryDataSchema,
  SimpleJobSchema,
  JobAssignmentDataSchema,
  DiscoveredJobSchema,
  DiscoverySummarySchema,
  ErrorContextSchema,
  
  // Complete message schemas
  HeartbeatMessageSchema,
  JobStartedMessageSchema,
  JobProgressMessageSchema,
  JobCompletedMessageSchema,
  JobFailedMessageSchema,
  DiscoveryMessageSchema,
  JobsDiscoveredMessageSchema,
  TokenRefreshRequestMessageSchema,
  JobRequestMessageSchema,
  JobResponseMessageSchema,
  TokenRefreshResponseMessageSchema,
  ShutdownMessageSchema,
  
  // Union schemas for validation
  CrawlerToWebAppMessageSchema,
  WebAppToCrawlerMessageSchema,
  AnySocketMessageSchema,
  
  // Validation utilities
  validateCrawlerMessage,
  validateWebAppMessage,
  validateAnySocketMessage,
  
  // Type exports
  type SocketMessage,
  type HeartbeatData,
  type ProgressData,
  type CompletionData,
  type FailureData,
  type DiscoveryData,
  type SimpleJob,
  type JobAssignmentData,
  type DiscoveredJob,
  type DiscoverySummary,
  type ErrorContext,
  type HeartbeatMessage,
  type JobStartedMessage,
  type JobProgressMessage,
  type JobCompletedMessage,
  type JobFailedMessage,
  type DiscoveryMessage,
  type JobsDiscoveredMessage,
  type TokenRefreshRequestMessage,
  type JobRequestMessage,
  type JobResponseMessage,
  type TokenRefreshResponseMessage,
  type ShutdownMessage,
  type CrawlerToWebAppMessage,
  type WebAppToCrawlerMessage,
  type AnySocketMessage
} from '@copima/lib-common';

// Re-export everything for compatibility
export {
  // Core schemas
  EntityTypeSchema,
  JobStatusSchema,
  TokenProviderSchema,
  
  // Message data schemas
  SocketMessageSchema,
  HeartbeatDataSchema,
  ProgressDataSchema,
  CompletionDataSchema,
  FailureDataSchema,
  DiscoveryDataSchema,
  SimpleJobSchema,
  JobAssignmentDataSchema,
  DiscoveredJobSchema,
  DiscoverySummarySchema,
  ErrorContextSchema,
  
  // Complete message schemas
  HeartbeatMessageSchema,
  JobStartedMessageSchema,
  JobProgressMessageSchema,
  JobCompletedMessageSchema,
  JobFailedMessageSchema,
  DiscoveryMessageSchema,
  JobsDiscoveredMessageSchema,
  TokenRefreshRequestMessageSchema,
  JobRequestMessageSchema,
  JobResponseMessageSchema,
  TokenRefreshResponseMessageSchema,
  ShutdownMessageSchema,
  
  // Union schemas for validation
  CrawlerToWebAppMessageSchema,
  WebAppToCrawlerMessageSchema,
  AnySocketMessageSchema,
  
  // Validation utilities
  validateCrawlerMessage,
  validateWebAppMessage,
  validateAnySocketMessage,
  
  // Type exports
  type SocketMessage,
  type HeartbeatData,
  type ProgressData,
  type CompletionData,
  type FailureData,
  type DiscoveryData,
  type SimpleJob,
  type JobAssignmentData,
  type DiscoveredJob,
  type DiscoverySummary,
  type ErrorContext,
  type HeartbeatMessage,
  type JobStartedMessage,
  type JobProgressMessage,
  type JobCompletedMessage,
  type JobFailedMessage,
  type DiscoveryMessage,
  type JobsDiscoveredMessage,
  type TokenRefreshRequestMessage,
  type JobRequestMessage,
  type JobResponseMessage,
  type TokenRefreshResponseMessage,
  type ShutdownMessage,
  type CrawlerToWebAppMessage,
  type WebAppToCrawlerMessage,
  type AnySocketMessage
} from '@copima/lib-common';

// Legacy compatibility exports
export const BaseMessageSchema = SocketMessageSchema;
export const JobAssignmentSchema = JobAssignmentDataSchema;

// Legacy compatibility schema for backend processing (transforms jobId -> job_id internally)
export const BackendProcessingSchema = z.object({
  type: z.string(),
  timestamp: z.string(),
  job_id: z.string().optional(),
});

// Legacy type exports for backward compatibility
export type BaseMessage = SocketMessage;
export type JobAssignment = JobAssignmentData;
export type ProgressDataType = ProgressData;
export type ErrorContextType = ErrorContext;
export type CrawlerMessage = CrawlerToWebAppMessage;
export type WebAppMessage = WebAppToCrawlerMessage;

// Web application specific extensions (if any are needed)
export const WebAppJobAssignmentDataSchema = JobAssignmentDataSchema.extend({
  // Additional web app specific fields
  account_id: z.string(),
  user_id: z.string().optional(),
  provider: TokenProviderSchema,
  web_app_job_id: z.string(), // Maps to database job.id
  created_by_user_id: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
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
  status: JobStatusSchema,
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
  provider: TokenProviderSchema,
  requires_user_action: z.boolean().default(false),
  admin_notification_sent: z.boolean().default(false),
});

// Socket connection management
export const SocketConnectionEventSchema = z.object({
  event_type: z.enum(['connected', 'disconnected', 'error', 'heartbeat_timeout']),
  crawler_id: z.string().optional(),
  timestamp: z.string(),
  details: z.record(z.string(), z.any()).optional(),
});

// Web app specific type exports
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