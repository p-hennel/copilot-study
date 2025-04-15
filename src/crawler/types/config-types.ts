/**
 * Configuration types for the GitLab crawler
 * 
 * @packageDocumentation
 */

import type { JobFailedEvent } from '../events';
import { type Job, type JobResult } from './job-types';

/**
 * Authentication configuration for GitLab API
 */
export interface AuthConfig {
  /**
   * OAuth token for authentication
   */
  oauthToken?: string;
  
  /**
   * OAuth refresh token for token renewal
   */
  refreshToken?: string;
  
  /**
   * OAuth client ID for token renewal
   */
  clientId?: string;
  
  /**
   * OAuth client secret for token renewal
   */
  clientSecret?: string;
  
  /**
   * Token expiration date
   */
  tokenExpiresAt?: Date;
  
  /**
   * Callback function invoked when a token is refreshed
   * @param newToken - The new OAuth token
   */
  tokenRefreshCallback?: (newToken: string) => void;
}

/**
 * Resource filtering configuration
 */
export interface ResourceFilters {
  /**
   * Array of project IDs to include
   */
  projectIds?: (string | number)[];
  
  /**
   * Array of group IDs to include
   */
  groupIds?: (string | number)[];
  
  /**
   * Array of project paths to include (prefixes)
   */
  projectPaths?: string[];
  
  /**
   * Array of group paths to include (prefixes)
   */
  groupPaths?: string[];
  
  /**
   * Custom filter function for projects
   * @param project - The project object from GitLab API
   * @returns Whether to include this project
   */
  projectFilterFn?: (project: any) => boolean;
  
  /**
   * Custom filter function for groups
   * @param group - The group object from GitLab API
   * @returns Whether to include this group
   */
  groupFilterFn?: (group: any) => boolean;
}

/**
 * Processing hooks configuration
 */
export interface ProcessingHooks {
  /**
   * Called before a job starts processing
   * @param job - The job to be processed
   * @returns Whether to process the job (false to skip)
   */
  beforeJobStart?: (job: Job) => Promise<boolean>;
  
  /**
   * Called after a job completes
   * @param job - The completed job
   * @param result - The job result
   */
  afterJobComplete?: (job: Job, result: JobResult) => Promise<void>;

  /**
   * Called after a job fails
   * @param job - The failed job
   * @param event - The error
   */
  jobFailed?: (job: Job, event?: JobFailedEvent) => Promise<void>;
  
  /**
   * Called when a resource is discovered
   * @param type - The resource type
   * @param id - The resource ID
   * @param path - The resource path (if available)
   * @returns Whether to process this resource (false to skip)
   */
  onResourceDiscovered?: (type: string, id: string | number, path?: string) => Promise<boolean>;
  
  /**
   * Transform data before saving
   * @param data - The data to transform
   * @param resourceType - The resource type
   * @param resourceId - The resource ID
   * @returns Transformed data
   */
  transformData?: (data: any, resourceType: string, resourceId: string | number) => Promise<any>;
}

/**
 * File naming strategy type
 */
export type FileNamingStrategy = 
  | 'default'
  | 'flat'
  | 'hierarchical'
  | ((resourceType: string, resourceId: string | number, parentInfo?: any) => string);

/**
 * Complete crawler configuration
 */
export interface CrawlerConfig {
  /**
   * GitLab instance URL
   */
  gitlabUrl: string;
  
  /**
   * Authentication settings
   */
  auth: AuthConfig;
  
  /**
   * Output directory for data files
   */
  outputDir: string;
  
  /**
   * Strategy for naming output files
   */
  fileNamingStrategy?: FileNamingStrategy;
  
  /**
   * Maximum requests per second (global rate limit)
   */
  requestsPerSecond: number;
  
  /**
   * Resource-specific rate limits (requests per second)
   */
  resourceSpecificRateLimits?: Record<string, number>;
  
  /**
   * Maximum concurrent jobs
   */
  concurrency: number;
  
  /**
   * Resource-specific concurrency limits
   */
  concurrencyPerResourceType?: Record<string, number>;
  
  /**
   * Maximum retry attempts for failed jobs
   */
  maxRetries: number;
  
  /**
   * Base delay between retries (ms)
   */
  retryDelayMs: number;
  
  /**
   * Exponential backoff factor for retries
   */
  retryBackoffFactor?: number;
  
  /**
   * Random jitter factor for retry delays (0-1)
   */
  retryJitter?: number;
  
  /**
   * Memory limit in MB (pause if exceeded)
   */
  memoryLimitMB?: number;
  
  /**
   * Whether to include external data (e.g., from linked systems)
   */
  includeExternalData?: boolean;
  
  /**
   * Job timeout in milliseconds
   */
  timeout?: number;
  
  /**
   * Maximum items per page for paginated requests
   */
  maxPageSize?: number;
  
  /**
   * Batch size for processing items
   */
  batchSize?: number;
  
  /**
   * Filters for resources to crawl
   */
  includeResources?: ResourceFilters;
  
  /**
   * Hooks for custom processing
   */
  hooks?: ProcessingHooks;
}