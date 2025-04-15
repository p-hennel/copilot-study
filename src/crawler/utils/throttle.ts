/**
 * Rate limiting and throttling utilities
 * 
 * @packageDocumentation
 */

import { throttle as lodashThrottle } from 'lodash';

/**
 * Options for creating a throttled function with exponential backoff
 */
export interface ThrottleOptions {
  /**
   * Requests per second rate limit
   */
  requestsPerSecond: number;
  
  /**
   * Base delay for retry backoff in milliseconds
   */
  baseRetryDelayMs: number;
  
  /**
   * Exponential factor for backoff calculation
   */
  backoffFactor: number;
  
  /**
   * Random jitter factor (0-1) to add to backoff times
   */
  jitterFactor: number;
  
  /**
   * Maximum backoff time in milliseconds
   */
  maxBackoffMs: number;
  
  /**
   * Optional resource key for tracking consecutive errors
   */
  resourceKey?: string;
}

/**
 * Create a throttled function with exponential backoff for API requests
 * 
 * @param options - Throttle options
 * @returns Throttled function wrapper
 */
// : (fn: () => Promise<T>) => Promise<T>
export function createThrottledRequest<T>(
  options: ThrottleOptions
) {
  const {
    requestsPerSecond,
    baseRetryDelayMs,
    backoffFactor,
    jitterFactor,
    maxBackoffMs,
    resourceKey = 'default'
  } = options;
  
  // Track consecutive errors per resource
  const consecutiveErrorsByResource = new Map<string, number>();
  
  // Calculate throttle interval in milliseconds
  const throttleInterval = Math.ceil(1000 / requestsPerSecond);

  const throttleFn = async <T>(fn: () => Promise<T>): Promise<T> => {
    // Get current consecutive errors for this resource
    let consecutiveErrors = consecutiveErrorsByResource.get(resourceKey) || 0;
    
    try {
      // Execute the function
      const result = await fn();
      
      // Reset consecutive errors on success
      if (consecutiveErrors > 0) {
        consecutiveErrorsByResource.set(resourceKey, 0);
      }
      
      return result;
    } catch (error) {
      // Increment consecutive errors
      consecutiveErrors++;
      consecutiveErrorsByResource.set(resourceKey, consecutiveErrors);
      
      // Calculate backoff time with exponential increase
      const baseBackoff = baseRetryDelayMs * Math.pow(
        backoffFactor,
        consecutiveErrors - 1
      );
      
      // Add jitter to prevent thundering herd
      const jitter = 1 + (Math.random() * jitterFactor * 2) - jitterFactor;
      const backoffTime = Math.min(
        baseBackoff * jitter,
        maxBackoffMs
      );
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Handle rate limiting errors (usually HTTP 429)
      if (errorMessage.includes('429') || 
          errorMessage.toLowerCase().includes('rate limit') ||
          errorMessage.toLowerCase().includes('too many requests')) {
        
        // Wait for the calculated backoff time
        await Bun.sleep(Math.round(backoffTime));
        
        // Retry the request
        return fn();
      }
      
      // Re-throw other errors
      throw error;
    }
  }
  
  return lodashThrottle(throttleFn, throttleInterval);
}

/**
 * Default resource-specific rate limits for GitLab API
 */
export const DEFAULT_RESOURCE_RATE_LIMITS: Record<string, number> = {
  // Discovery endpoints tend to have stricter rate limits
  DISCOVER_GROUPS: 1,
  DISCOVER_PROJECTS: 1,
  DISCOVER_SUBGROUPS: 1,
  
  // Group endpoints
  GROUP_DETAILS: 2,
  GROUP_MEMBERS: 2,
  GROUP_PROJECTS: 1,
  GROUP_ISSUES: 2,
  
  // Project endpoints generally have higher limits
  PROJECT_DETAILS: 5,
  PROJECT_BRANCHES: 3,
  PROJECT_MERGE_REQUESTS: 2,
  PROJECT_ISSUES: 2,
  PROJECT_MILESTONES: 5,
  PROJECT_RELEASES: 5,
  
  // These endpoints can be more resource-intensive
  PROJECT_PIPELINES: 2,
  PROJECT_VULNERABILITIES: 1,
  MERGE_REQUEST_DISCUSSIONS: 1,
  ISSUE_DISCUSSIONS: 1,
  PIPELINE_DETAILS: 2,
  PIPELINE_TEST_REPORTS: 1,
};