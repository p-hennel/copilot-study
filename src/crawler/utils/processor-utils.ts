/**
 * Utility functions for job processors
 *
 * @packageDocumentation
 */

import { Gitlab } from "@gitbeaker/node";
import { getLogger } from "@logtape/logtape";
import { type CrawlerEventEmitter, EventType, type JobCompletedEvent } from "../events/event-types";
import { CursorRegistry } from "../registry/cursor-registry";
import { type AuthConfig } from "../types/config-types";
import { type Job, type JobProcessor, type JobResult, JobType } from "../types/job-types";
import { createGitLabClient } from "./auth";

// Initialize logger
const logger = getLogger(["crawlib", "processor-utils"]);

/**
 * Configuration for GitLab API request
 */
export interface GitLabRequestConfig<T> {
  /**
   * GitLab instance URL
   */
  gitlabUrl: string;

  /**
   * Authentication configuration
   */
  authConfig: AuthConfig;

  /**
   * Function to execute GitLab API request
   */
  requestFn: (client: InstanceType<typeof Gitlab>, options: any) => Promise<T>;

  /**
   * Throttled request function
   */
  throttledRequest: <R>(fn: () => Promise<R>) => Promise<R>;

  /**
   * Options to pass to API request
   */
  options?: Record<string, any>;
}

/**
 * Configuration for fetching paginated data
 */
export interface PaginatedRequestConfig<T> extends GitLabRequestConfig<T[]> {
  /**
   * Resource type identifier
   */
  resourceType: string;

  /**
   * Resource ID
   */
  resourceId: string | number;

  /**
   * Cursor registry
   */
  cursorRegistry: CursorRegistry;

  /**
   * Event emitter
   */
  eventEmitter: CrawlerEventEmitter;

  /**
   * Items per page
   */
  itemsPerPage?: number;
}

/**
 * Configuration for saving data
 */
export interface SaveDataConfig {
  /**
   * Output directory
   */
  outputDir: string;

  /**
   * File path relative to output directory
   */
  fileName: string;

  /**
   * Whether to save as single object or array
   */
  asSingleObject?: boolean;
}

/**
 * Common configuration for job processors
 */
export interface ProcessorBaseConfig {
  /**
   * GitLab instance URL
   */
  gitlabUrl: string;

  /**
   * Output directory
   */
  outputDir: string;

  /**
   * Event emitter
   */
  eventEmitter: CrawlerEventEmitter;

  /**
   * Cursor registry
   */
  cursorRegistry: CursorRegistry;

  /**
   * Throttled request function for the job type
   */
  getThrottledRequest: (resourceType: string) => <T>(fn: () => Promise<T>) => Promise<T>;
}

/**
 * Make a GitLab API request with proper authentication and error handling
 *
 * @param config - Request configuration
 * @returns The result of the API request
 * @throws Error if the request fails
 */
export async function makeGitLabRequest<T>(config: GitLabRequestConfig<T>): Promise<T> {
  const { gitlabUrl, authConfig, requestFn, throttledRequest, options = {} } = config;

  // Create API client with the appropriate auth
  const client = createGitLabClient(gitlabUrl, authConfig.oauthToken || "");

  try {
    // Make throttled request
    return await throttledRequest(() => requestFn(client, options));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Handle specific GitLab error codes
    if (errorMessage.includes("429") || errorMessage.toLowerCase().includes("rate limit")) {
      logger.warn(`Rate limit hit, retrying after delay...`);
      // The throttle function should handle the retry with appropriate backoff
      throw error;
    }

    // Rethrow with context
    throw new Error(`GitLab API request failed: ${errorMessage}`);
  }
}

/**
 * Fetch paginated data from GitLab API
 *
 * @param config - Request configuration
 * @returns Array of fetched items
 */
export async function fetchPaginatedData<T>(config: PaginatedRequestConfig<T>): Promise<T[]> {
  const {
    resourceType,
    resourceId,
    cursorRegistry,
    eventEmitter,
    itemsPerPage = 100,
    ...requestConfig
  } = config;

  // Get next page from cursor registry
  const nextPage = cursorRegistry.getNextPage(resourceType, resourceId);

  logger.debug(`Fetching ${resourceType} for ${resourceId}, page ${nextPage}...`);

  // Prepare pagination options
  const options = {
    ...requestConfig.options,
    page: nextPage,
    per_page: itemsPerPage
  };

  // Make the API request
  const items = await makeGitLabRequest<T[]>({
    ...requestConfig,
    options
  });

  // Update cursor in registry
  const hasNextPage = items.length === itemsPerPage;
  cursorRegistry.registerCursor(resourceType, resourceId, nextPage, hasNextPage);

  // Emit page completed event with item count
  eventEmitter.emit({
    type: EventType.PAGE_COMPLETED,
    timestamp: new Date(),
    resourceType,
    resourceId,
    page: nextPage,
    hasNextPage,
    itemCount: items.length
  });

  return items;
}

/**
 * Create a job processor with standardized workflow
 *
 * @param baseConfig - Base processor configuration
 * @param processorFn - Function implementing the specific processor logic
 * @returns Job processor function
 */
export function createJobProcessor(
  baseConfig: ProcessorBaseConfig,
  processorFn: (
    job: Job,
    authConfig: AuthConfig,
    utils: {
      fetchPaginatedData: <R>(
        config: Omit<
          PaginatedRequestConfig<R>,
          "gitlabUrl" | "authConfig" | "cursorRegistry" | "eventEmitter"
        >
      ) => Promise<R[]>;
      makeGitLabRequest: <R>(
        config: Omit<GitLabRequestConfig<R>, "gitlabUrl" | "authConfig">
      ) => Promise<R>;
      createGitLabClient: (token: string) => InstanceType<typeof Gitlab>;
      emitJobCompleted: (job: Job, result: any, discoveredJobs?: Job[], duration?: number) => void;
    }
  ) => Promise<{ success: boolean; data?: any; discoveredJobs?: Job[]; error?: string }>
): JobProcessor {
  return async (job: Job, authConfig: AuthConfig): Promise<JobResult> => {
    const startTime = Date.now();
    logger.info(`Processing ${job.type} for ${job.resourceId}...`);

    try {
      // Create utility functions with pre-bound config
      const utils = {
        fetchPaginatedData: <R>(
          config: Omit<
            PaginatedRequestConfig<R>,
            "gitlabUrl" | "authConfig" | "cursorRegistry" | "eventEmitter"
          >
        ) =>
          fetchPaginatedData({
            ...config,
            gitlabUrl: baseConfig.gitlabUrl,
            authConfig,
            cursorRegistry: baseConfig.cursorRegistry,
            eventEmitter: baseConfig.eventEmitter
          }),

        makeGitLabRequest: <R>(config: Omit<GitLabRequestConfig<R>, "gitlabUrl" | "authConfig">) =>
          makeGitLabRequest({
            ...config,
            gitlabUrl: baseConfig.gitlabUrl,
            authConfig
          }),

        createGitLabClient: (token?: string) =>
          createGitLabClient(baseConfig.gitlabUrl, token || authConfig.oauthToken || ""),

        emitJobCompleted: (
          job: Job,
          result: any,
          discoveredJobs: Job[] = [],
          duration?: number
        ) => {
          baseConfig.eventEmitter.emit({
            type: EventType.JOB_COMPLETED,
            timestamp: new Date(),
            job,
            result,
            duration: duration || Date.now() - startTime,
            discoveredJobs
          } as JobCompletedEvent);
        }
      };

      // Execute the specific processor logic
      const result = await processorFn(job, authConfig, utils);

      // Handle successful result
      if (result.success) {
        // Emit completed event if not already emitted
        utils.emitJobCompleted(job, result.data, result.discoveredJobs);

        return {
          job,
          success: true,
          data: result.data,
          discoveredJobs: result.discoveredJobs
        };
      } else {
        // Handle explicit failure
        throw new Error(result.error || "Unknown error");
      }
    } catch (error) {
      // Handle exceptions
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to process ${job.type} for ${job.resourceId}: ${errorMessage}`);

      // Don't emit error event here - let the caller handle that
      throw error;
    }
  };
}

/**
 * Convert raw GitLab API error to a structured error object
 *
 * @param error - Error from GitLab API
 * @param context - Additional context
 * @returns Structured error info
 */
export function processGitLabError(
  error: unknown,
  context: {
    jobType: JobType;
    resourceId: string | number;
    resourcePath?: string;
  }
): {
  message: string;
  statusCode?: number;
  context: Record<string, any>;
  canRetry: boolean;
  isPermissionError: boolean;
} {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const context404 =
    errorMessage.includes("404") || errorMessage.toLowerCase().includes("not found");
  const context403 =
    errorMessage.includes("403") || errorMessage.toLowerCase().includes("forbidden");

  // Extract HTTP status code if present
  const statusCodeMatch = errorMessage.match(/(\d{3})/);
  const candidate = statusCodeMatch?.[1]
  const statusCode = candidate ? parseInt(candidate, 10) : undefined;

  return {
    message: errorMessage,
    statusCode,
    context: {
      ...context,
      rawError: error instanceof Error ? error.message : String(error)
    },
    canRetry: !(context404 || context403 || statusCode === 404 || statusCode === 403),
    isPermissionError: context403 || statusCode === 403
  };
}
