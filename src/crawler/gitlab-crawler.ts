/**
 * Main GitLab crawler implementation
 *
 * This file contains the main GitLabCrawler class that orchestrates
 * the crawling process for GitLab resources.
 *
 * @packageDocumentation
 */

import { getLogger } from "@logtape/logtape";
import { v4 as uuidv4 } from "uuid";
import { GitLabCrawlerEventEmitter } from "./events/event-emitter";
import {
  type CrawlerEventEmitter,
  type CrawlerEventUnion,
  EventType,
  type JobCompletedEvent,
  type JobFailedEvent,
  type PaginationCursor
} from "./events/event-types";
import { JobProcessors } from "./processors/job-processors";
import { CursorRegistry } from "./registry/cursor-registry";
import { type AuthConfig, type CrawlerConfig } from "./types/config-types"; // Added AuthConfig
import { type Job, JOB_PRIORITIES, type JobResult, JobType } from "./types/job-types";
import {
  refreshJobToken, // Added for per-job refresh
  refreshOAuthToken,
  tokenNeedsRefresh
} from "./utils/auth";
import { ensureDirectoryExists } from "./utils/filesystem";
import { createThrottledRequest, DEFAULT_RESOURCE_RATE_LIMITS } from "./utils/throttle";

// Initialize logger
const logger = getLogger(["crawlib"]);

/**
 * Main GitLab REST API crawler class
 */
export class GitLabCrawler {
  /**
   * Configuration for the crawler
   */
  private config: CrawlerConfig;

  /**
   * Event emitter for sending events
   */
  private eventEmitter: CrawlerEventEmitter;

  /**
   * Registry for tracking pagination cursors and discovered resources
   */
  private cursorRegistry: CursorRegistry;

  /**
   * Job processors for handling different resource types
   */
  private processors: JobProcessors;

  /**
   * Map of currently running jobs
   */
  private runningJobs: Map<string, Job> = new Map();

  /**
   * Map of running jobs by type
   */
  private runningJobsByType: Map<string, Set<string>> = new Map();

  /**
   * Map of job queues by type
   */
  private jobQueue: Map<string, Job[]> = new Map();

  /**
   * Whether the crawler is currently running
   */
  private isRunning: boolean = false;

  /**
   * Whether the crawler is currently paused
   */
  private isPaused: boolean = false;

  /**
   * Map of resource-specific throttled request functions
   */
  private resourceThrottles: Map<string, <T>(fn: () => Promise<T>) => Promise<T>> = new Map();

  /**
   * Map of retry timeouts by job ID
   */
  private retryTimeoutsById: Map<string, number> = new Map();

  /**
   * Interval ID for memory monitoring
   */
  private memoryMonitorInterval?: number;

  /**
   * Create a new GitLab crawler
   *
   * @param config - Crawler configuration
   */
  constructor(config: CrawlerConfig) {
    // Apply default configuration values
    this.config = {
      ...config,
      concurrency: config.concurrency || 5,
      maxRetries: config.maxRetries || 3,
      retryDelayMs: config.retryDelayMs || 5000,
      retryBackoffFactor: config.retryBackoffFactor || 2,
      retryJitter: config.retryJitter || 0.1,
      resourceSpecificRateLimits: {
        ...DEFAULT_RESOURCE_RATE_LIMITS,
        ...config.resourceSpecificRateLimits
      }
    };

    // Ensure output directory exists
    try {
      ensureDirectoryExists(this.config.outputDir);
    } catch (error) {
      logger.error(`Failed to create output directory: ${error}`);
      throw error;
    }

    // Create event emitter
    this.eventEmitter = new GitLabCrawlerEventEmitter();

    // Create cursor registry
    this.cursorRegistry = new CursorRegistry(this.eventEmitter);

    // Initialize resource-specific throttles
    this.initializeResourceThrottles();

    // Create job processors
    // Initialize JobProcessors without api and oauthToken
    this.processors = new JobProcessors({
      gitlabUrl: this.config.gitlabUrl,
      // oauthToken: this.config.auth.oauthToken || '', // Removed
      outputDir: this.config.outputDir,
      eventEmitter: this.eventEmitter,
      cursorRegistry: this.cursorRegistry,
      resourceThrottles: this.resourceThrottles
    });

    // Initialize running jobs by type tracking
    Object.values(JobType).forEach((type) => {
      this.runningJobsByType.set(type, new Set());
      this.jobQueue.set(type, []);
    });

    // Handle job completed events to manage running jobs
    this.eventEmitter.on(EventType.JOB_COMPLETED, async (event: CrawlerEventUnion) => {
      // Type guard to make sure this is a JobCompletedEvent
      if (event.type !== EventType.JOB_COMPLETED || !("job" in event)) {
        return;
      }

      // Now TypeScript knows this is a JobCompletedEvent
      const completedEvent = event as JobCompletedEvent;

      // Remove job from running jobs
      this.runningJobs.delete(completedEvent.job.id);

      // Remove from type tracking
      const typeSet = this.runningJobsByType.get(completedEvent.job.type);
      if (typeSet) {
        typeSet.delete(completedEvent.job.id);
      }

      // Call hook if provided
      if (this.config.hooks?.afterJobComplete) {
        try {
          await this.config.hooks.afterJobComplete(completedEvent.job, {
            job: completedEvent.job,
            success: true,
            data: completedEvent.result
          });
        } catch (error) {
          logger.error(`Error in afterJobComplete hook: ${error}`);
        }
      }

      // Add discovered jobs
      if (completedEvent.discoveredJobs && completedEvent.discoveredJobs.length > 0) {
        for (const job of completedEvent.discoveredJobs) {
          // Check filters before enqueueing
          if (await this.shouldProcessJob(job)) {
            await this.enqueueJob(job);
          }
        }
      }

      // Schedule next jobs
      logger.debug(`JOB_COMPLETED (${completedEvent.job.id}) triggered processNextJobs`);
      if (this.isRunning && !this.isPaused) {
        this.processNextJobs();
      }
    });

    // Handle job failed events
    this.eventEmitter.on(EventType.JOB_FAILED, async (event: CrawlerEventUnion) => {
      // Type guard to make sure this is a JobFailedEvent
      if (event.type !== EventType.JOB_FAILED || !("job" in event)) {
        return;
      }

      // Now TypeScript knows this is a JobFailedEvent
      const failedEvent = event as JobFailedEvent;

      // Remove job from running jobs
      this.runningJobs.delete(failedEvent.job.id);

      // Remove from type tracking
      const typeSet = this.runningJobsByType.get(failedEvent.job.type);
      if (typeSet) {
        typeSet.delete(failedEvent.job.id);
      }

      // Call hook if provided
      if (this.config.hooks?.jobFailed) {
        try {
          await this.config.hooks.jobFailed(failedEvent.job, failedEvent);
        } catch (error) {
          logger.error(`Error in jobFailed hook: ${error}`);
        }
      }

      // Schedule next jobs
      logger.debug(`JOB_FAILED (${failedEvent.job.id}) triggered processNextJobs`);
      if (this.isRunning && !this.isPaused) {
        this.processNextJobs();
      }
    });
  }

  /**
   * Initialize resource-specific throttles
   */
  private initializeResourceThrottles(): void {
    Object.values(JobType).forEach((jobType) => {
      const rateLimit =
        this.config.resourceSpecificRateLimits?.[jobType] || this.config.requestsPerSecond;
      this.resourceThrottles.set(
        jobType,
        createThrottledRequest({
          requestsPerSecond: rateLimit,
          baseRetryDelayMs: this.config.retryDelayMs,
          backoffFactor: this.config.retryBackoffFactor || 2,
          jitterFactor: this.config.retryJitter || 0.1,
          maxBackoffMs: 60000, // Cap at 1 minute
          resourceKey: jobType
        })
      );
    });
  }

  /**
   * Stop memory monitoring
   */
  private stopMemoryMonitoring(): void {
    if (this.memoryMonitorInterval) {
      clearInterval(this.memoryMonitorInterval);
      this.memoryMonitorInterval = undefined;
    }
  }

  /**
   * Check if a token needs refresh and refresh if needed
   */
  private async checkAndRefreshGlobalToken(): Promise<void> {
    // Skip if using basic token auth
    if (!this.config.auth.refreshToken || !this.config.auth.tokenExpiresAt) {
      return;
    }

    if (tokenNeedsRefresh(this.config.auth.tokenExpiresAt, 5)) {
      logger.info("Token is about to expire, refreshing...");
      await this.refreshToken();
    }
  }

  /**
   * Refresh the OAuth token
   */
  private async refreshToken(): Promise<void> {
    try {
      const result = await refreshOAuthToken(this.config.gitlabUrl, this.config.auth);

      // Removed updateApiClient call as processors now create their own clients
      // this.processors.updateApiClient(this.api);

      // Update token in config
      this.config.auth.oauthToken = result.accessToken;
      this.config.auth.refreshToken = result.refreshToken || this.config.auth.refreshToken;
      this.config.auth.tokenExpiresAt = result.expiresAt;

      // Notify callback
      if (this.config.auth.tokenRefreshCallback) {
        this.config.auth.tokenRefreshCallback(result.accessToken);
      }

      logger.info("Token refreshed successfully");
    } catch (error) {
      logger.error("Failed to refresh token:", { error });
      throw error;
    }
  }

  /**
   * Check if a job should be processed based on filters
   */
  private async shouldProcessJob(job: Job): Promise<boolean> {
    // Call hook if provided
    if (this.config.hooks?.beforeJobStart) {
      try {
        const shouldProcess = await this.config.hooks.beforeJobStart(job);
        if (!shouldProcess) {
          return false;
        }
      } catch (error) {
        logger.error(`Error in beforeJobStart hook: ${error}`);
      }
    }

    // Check resource filters
    if (this.config.includeResources) {
      // Project-specific filters
      if (job.type.includes("PROJECT_")) {
        const projectId = job.resourceId as string | number;
        const projectPath = job.resourcePath;

        // Project ID filter
        if (
          this.config.includeResources.projectIds &&
          this.config.includeResources.projectIds.length > 0 &&
          !this.config.includeResources.projectIds.includes(projectId)
        ) {
          return false;
        }

        // Project path filter
        if (
          this.config.includeResources.projectPaths &&
          this.config.includeResources.projectPaths.length > 0 &&
          projectPath &&
          !this.config.includeResources.projectPaths.some((p) => projectPath.startsWith(p))
        ) {
          return false;
        }
      }

      // Group-specific filters
      if (job.type.includes("GROUP_")) {
        const groupId = job.resourceId as string | number;
        const groupPath = job.resourcePath;

        // Group ID filter
        if (
          this.config.includeResources.groupIds &&
          this.config.includeResources.groupIds.length > 0 &&
          !this.config.includeResources.groupIds.includes(groupId)
        ) {
          return false;
        }

        // Group path filter
        if (
          this.config.includeResources.groupPaths &&
          this.config.includeResources.groupPaths.length > 0 &&
          groupPath &&
          !this.config.includeResources.groupPaths.some((p) => groupPath.startsWith(p))
        ) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Register an event listener
   *
   * @param eventType - Event type to listen for, or '*' for all events
   * @param listener - Event listener function
   */
  on(eventType: EventType | string, listener: (event: CrawlerEventUnion) => void): void {
    this.eventEmitter.on(eventType, listener);
  }

  /**
   * Remove an event listener
   *
   * @param eventType - Event type to remove listener from
   * @param listener - Event listener function to remove
   */
  off(eventType: EventType | string, listener: (event: CrawlerEventUnion) => void): void {
    this.eventEmitter.off(eventType, listener);
  }

  /**
   * Create a discovery job
   *
   * @param type - Job type (must be a discovery job)
   * @returns The created job
   */
  createDiscoveryJob(type: JobType.DISCOVER_GROUPS | JobType.DISCOVER_PROJECTS): Job {
    const job: Job = {
      id: `${type}-${uuidv4()}`,
      type,
      resourceId: "all",
      createdAt: new Date(),
      priority: JOB_PRIORITIES[type],
      retryCount: 0
    };

    return job;
  }

  /**
   * Enqueue a job for processing
   *
   * @param job - Job to enqueue
   */
  async enqueueJob(job: Job): Promise<void> {
    // Check if we should process this job
    if (!(await this.shouldProcessJob(job))) {
      logger.debug(`Skipping job ${job.id} due to filters`);
      return;
    }

    // Add to queue for the job type
    const queue = this.jobQueue.get(job.type) || [];
    queue.push(job);
    this.jobQueue.set(job.type, queue);

    logger.debug(
      `Enqueueing job: ${job.id} (${job.type}), Priority: ${job.priority}. Queue size for type ${job.type}: ${queue.length}`
    );
    // Mark as pending in cursor registry
    const resourceType = job.type;
    const resourceId = job.resourceId;

    // If we already have a cursor for this resource, update it
    if (this.cursorRegistry.getCursor(resourceType, resourceId)) {
      // Resource already tracked, no need to do anything
    } else {
      // Register a new cursor with page 0 (will start at page 1)
      this.cursorRegistry.registerCursor(resourceType, resourceId, 0, true);
    }

    // Process the job if we have capacity
    if (this.isRunning && !this.isPaused) {
      this.processNextJobs();
    }
  }

  /**
   * Process a specific job
   *
   * @param job - Job to process
   */
  private async processJob(job: Job): Promise<void> {
    if (this.runningJobs.has(job.id)) {
      // Job already running
      return;
    }

    // Mark job as running
    this.runningJobs.set(job.id, job);

    // Add to type tracking
    const typeSet = this.runningJobsByType.get(job.type) || new Set();
    typeSet.add(job.id);
    this.runningJobsByType.set(job.type, typeSet);

    // Emit job started event
    this.eventEmitter.emit({
      type: EventType.JOB_STARTED,
      timestamp: new Date(),
      job
    });

    // Get processor for job type
    const processors = this.processors.getProcessors();
    const processor = processors[job.type];

    if (!processor) {
      // No processor for this job type
      this.eventEmitter.emit({
        type: EventType.JOB_FAILED,
        timestamp: new Date(),
        job,
        error: `No processor for job type: ${job.type}`,
        attempts: 1,
        willRetry: false
      });

      this.runningJobs.delete(job.id);
      const typeSet = this.runningJobsByType.get(job.type);
      if (typeSet) {
        typeSet.delete(job.id);
      }
      return;
    }

    try {
      // Determine effective authentication and refresh token if needed
      let effectiveAuth: AuthConfig;
      if (job.auth) {
        // Use job-specific auth, refresh if needed
        logger.debug(`Using job-specific auth for job ${job.id}`);
        // refreshJobToken updates job.auth in place and returns it
        job.auth = await refreshJobToken(job.auth, this.config.gitlabUrl);
        effectiveAuth = job.auth;
      } else {
        // Use global auth, refresh if needed
        logger.debug(`Using global auth for job ${job.id}`);
        await this.checkAndRefreshGlobalToken();
        effectiveAuth = this.config.auth;
      }

      // Set timeout if configured
      let timeoutId: number | undefined;
      const timeoutPromise = new Promise<JobResult>((_, reject) => {
        if (this.config.timeout) {
          timeoutId = setTimeout(() => {
            reject(new Error(`Job ${job.id} timed out after ${this.config.timeout}ms`));
          }, this.config.timeout) as unknown as number;
        }
      });

      // Process the job with timeout, passing the effective auth config
      // TODO: Update processor signature to accept authConfig
      const processingPromise = processor(job, effectiveAuth);
      const result = await Promise.race([processingPromise, timeoutPromise]);

      // Clear timeout if set
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }

      // Handle job result
      if (result.success) {
        // Job completed successfully
        // The job completed event is already emitted by the processor
      } else {
        // Job failed
        this.eventEmitter.emit({
          type: EventType.JOB_FAILED,
          timestamp: new Date(),
          job,
          error: result.error || "Unknown error",
          attempts: job.retryCount + 1,
          willRetry: job.retryCount < this.config.maxRetries
        });

        // Retry job if needed
        if (job.retryCount < this.config.maxRetries) {
          // Calculate retry delay with backoff
          const backoffTime =
            this.config.retryDelayMs *
            Math.pow(this.config.retryBackoffFactor || 2, job.retryCount);

          // Add jitter
          const jitterFactor =
            1 +
            Math.random() * (this.config.retryJitter || 0.1) * 2 -
            (this.config.retryJitter || 0.1);
          const retryDelay = Math.round(backoffTime * jitterFactor);

          // Schedule retry
          const retryTimeoutId = setTimeout(() => {
            this.retryTimeoutsById.delete(job.id);

            const retryJob: Job = {
              ...job,
              retryCount: job.retryCount + 1
            };

            this.enqueueJob(retryJob).catch((error) => {
              logger.error(`Failed to retry job ${job.id}:`, { error });
            });
          }, retryDelay) as unknown as number;

          this.retryTimeoutsById.set(job.id, retryTimeoutId);
        }
      }
    } catch (error) {
      // Job failed with exception
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.eventEmitter.emit({
        type: EventType.JOB_FAILED,
        timestamp: new Date(),
        job,
        error: errorMessage,
        attempts: job.retryCount + 1,
        willRetry: job.retryCount < this.config.maxRetries
      });

      // Retry job if needed
      if (job.retryCount < this.config.maxRetries) {
        // Calculate retry delay with backoff
        const backoffTime =
          this.config.retryDelayMs * Math.pow(this.config.retryBackoffFactor || 2, job.retryCount);

        // Add jitter
        const jitterFactor =
          1 +
          Math.random() * (this.config.retryJitter || 0.1) * 2 -
          (this.config.retryJitter || 0.1);
        const retryDelay = Math.round(backoffTime * jitterFactor);

        // Schedule retry
        const retryTimeoutId = setTimeout(() => {
          this.retryTimeoutsById.delete(job.id);

          const retryJob: Job = {
            ...job,
            retryCount: job.retryCount + 1
          };

          this.enqueueJob(retryJob).catch((error) => {
            logger.error(`Failed to retry job ${job.id}:`, { error });
          });
        }, retryDelay) as unknown as number;

        this.retryTimeoutsById.set(job.id, retryTimeoutId);
      }
    } finally {
      // Remove job from running jobs if still there
      // (it might have been removed in the job completed event handler)
      this.runningJobs.delete(job.id);

      // Remove from type tracking
      const typeSet = this.runningJobsByType.get(job.type);
      if (typeSet) {
        typeSet.delete(job.id);
      }
    }
  }

  /**
   * Process next jobs if capacity allows
   */
  private processNextJobs(): void {
    logger.debug(
      `processNextJobs called. Running jobs: ${this.runningJobs.size}, Paused: ${this.isPaused}`
    );
    if (this.isPaused || !this.isRunning) {
      return;
    }

    // Check overall capacity
    let availableSlots = this.config.concurrency - this.runningJobs.size;

    if (availableSlots <= 0) {
      return;
    }

    // Process jobs by type, respecting type-specific concurrency limits
    for (const [jobType, queue] of this.jobQueue.entries()) {
      if (queue.length === 0) {
        continue;
      }

      // Check type-specific concurrency limit
      const typeLimit =
        this.config.concurrencyPerResourceType?.[jobType] || this.config.concurrency;
      const runningForType = this.runningJobsByType.get(jobType)?.size || 0;
      const typeAvailableSlots = Math.min(typeLimit - runningForType, availableSlots);

      if (typeAvailableSlots <= 0) {
        continue;
      }

      // Sort queue by priority (higher first) and creation time (older first)
      queue.sort(
        (a, b) => b.priority - a.priority || a.createdAt.getTime() - b.createdAt.getTime()
      );

      // Process jobs up to the available slots
      const jobsToProcess = queue.splice(0, typeAvailableSlots);
      availableSlots -= jobsToProcess.length;

      // Update the queue
      this.jobQueue.set(jobType, queue);

      // Process jobs
      for (const job of jobsToProcess) {
        logger.debug(`Dequeued job: ${job.id} (${job.type})`);
        this.processJob(job).catch((error) => {
          logger.error(`Error processing job ${job.id}:`, { error });
        });
      }

      if (availableSlots <= 0) {
        break;
      }
    }

    // Check if we're done
    if (this.runningJobs.size === 0 && this.getTotalQueuedJobs() === 0) {
      // We're done
      this.eventEmitter.emit({
        type: EventType.CRAWLER_STOPPED,
        timestamp: new Date()
      });

      logger.debug(`processNextJobs finished. Running jobs: ${this.runningJobs.size}`);
      this.isRunning = false;
    }
  }

  /**
   * Get total number of queued jobs
   */
  private getTotalQueuedJobs(): number {
    let total = 0;
    for (const queue of this.jobQueue.values()) {
      total += queue.length;
    }
    return total;
  }

  /**
   * Start discovery process
   */
  async startDiscovery(): Promise<void> {
    if (this.isRunning) {
      logger.warn("Crawler is already running");
      return;
    }

    this.isRunning = true;
    this.isPaused = false;

    // Emit crawler started event
    this.eventEmitter.emit({
      type: EventType.CRAWLER_STARTED,
      timestamp: new Date()
    });

    // Create and enqueue discovery jobs
    const groupsJob = this.createDiscoveryJob(JobType.DISCOVER_GROUPS);
    const projectsJob = this.createDiscoveryJob(JobType.DISCOVER_PROJECTS);

    await this.enqueueJob(groupsJob);
    await this.enqueueJob(projectsJob);
  }

  /**
   * Start processing a specific resource type
   *
   * @param type - Job type to process
   * @param resourceId - Resource ID to process
   * @param options - Additional options
   */
  async startResourceType(
    type: JobType,
    resourceId: string | number,
    options?: {
      resourcePath?: string;
      data?: Record<string, any>;
    }
  ): Promise<void> {
    if (!this.isRunning) {
      this.isRunning = true;
      this.isPaused = false;

      // Emit crawler started event
      this.eventEmitter.emit({
        type: EventType.CRAWLER_STARTED,
        timestamp: new Date()
      });
    }

    // Create and enqueue job
    const job: Job = {
      id: `${type}-${resourceId}-${uuidv4()}`,
      type,
      resourceId,
      resourcePath: options?.resourcePath,
      data: options?.data,
      createdAt: new Date(),
      priority: JOB_PRIORITIES[type] || 0,
      retryCount: 0
    };

    await this.enqueueJob(job);
  }

  /**
   * Pause the crawler
   */
  pause(): void {
    if (!this.isRunning || this.isPaused) {
      return;
    }

    this.isPaused = true;

    // Emit crawler paused event
    this.eventEmitter.emit({
      type: EventType.CRAWLER_PAUSED,
      timestamp: new Date()
    });

    logger.info("Crawler paused");
  }

  /**
   * Resume the crawler
   */
  resume(): void {
    if (!this.isRunning || !this.isPaused) {
      return;
    }

    this.isPaused = false;

    // Emit crawler resumed event
    this.eventEmitter.emit({
      type: EventType.CRAWLER_RESUMED,
      timestamp: new Date()
    });

    logger.info("Crawler resumed");

    // Resume processing
    this.processNextJobs();
  }

  /**
   * Stop the crawler
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.isPaused = false;

    // Clear all retry timeouts
    for (const timeoutId of this.retryTimeoutsById.values()) {
      clearTimeout(timeoutId);
    }
    this.retryTimeoutsById.clear();

    // Stop memory monitoring
    this.stopMemoryMonitoring();

    // Clear all queues
    for (const jobType of this.jobQueue.keys()) {
      this.jobQueue.set(jobType, []);
    }

    // Emit crawler stopped event
    this.eventEmitter.emit({
      type: EventType.CRAWLER_STOPPED,
      timestamp: new Date()
    });

    logger.info("Crawler stopped");
  }

  /**
   * Check if the crawler is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Check if the crawler is paused
   */
  isPausedState(): boolean {
    return this.isPaused;
  }

  /**
   * Get the current state of the crawler
   */
  getState(): {
    isRunning: boolean;
    isPaused: boolean;
    runningJobs: number;
    queuedJobs: number;
    pendingResources: number;
    cursors: PaginationCursor[];
    resourceCounts: Record<
      string,
      {
        running: number;
        queued: number;
        completed: number;
        failed: number;
      }
    >;
  } {
    const pendingCursors = this.cursorRegistry.getPendingCursors();

    // Collect resource counts
    const resourceCounts: Record<
      string,
      {
        running: number;
        queued: number;
        completed: number;
        failed: number;
      }
    > = {};

    // Initialize counts
    Object.values(JobType).forEach((type) => {
      resourceCounts[type] = {
        running: this.runningJobsByType.get(type)?.size || 0,
        queued: this.jobQueue.get(type)?.length || 0,
        completed: 0,
        failed: 0
      };
    });

    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      runningJobs: this.runningJobs.size,
      queuedJobs: this.getTotalQueuedJobs(),
      pendingResources: pendingCursors.length,
      cursors: pendingCursors,
      resourceCounts
    };
  }

  /**
   * Export crawler state for persistence
   */
  exportState(): {
    cursors: PaginationCursor[];
    discoveredResources: Record<string, (string | number)[]>;
    queuedJobs: Record<string, Job[]>;
    config: Partial<CrawlerConfig>;
  } {
    // Get cursor registry state
    const cursorState = this.cursorRegistry.exportState();

    // Export queued jobs
    const queuedJobs: Record<string, Job[]> = {};
    for (const [type, queue] of this.jobQueue.entries()) {
      queuedJobs[type] = [...queue];
    }

    // Export minimal config needed for resumption
    const configForExport: Partial<CrawlerConfig> = {
      gitlabUrl: this.config.gitlabUrl,
      // Don't export sensitive auth info
      outputDir: this.config.outputDir,
      requestsPerSecond: this.config.requestsPerSecond,
      concurrency: this.config.concurrency,
      concurrencyPerResourceType: this.config.concurrencyPerResourceType,
      includeResources: this.config.includeResources
    };

    return {
      ...cursorState,
      queuedJobs,
      config: configForExport
    };
  }

  /**
   * Import crawler state for resumption
   */
  importState(state: {
    cursors: PaginationCursor[];
    discoveredResources: Record<string, (string | number)[]>;
    queuedJobs?: Record<string, Job[]>;
    config?: Partial<CrawlerConfig>;
  }): void {
    // Import cursor registry state
    this.cursorRegistry.importState(state);

    // Import queued jobs if provided
    if (state.queuedJobs) {
      for (const [type, jobs] of Object.entries(state.queuedJobs)) {
        const queue = this.jobQueue.get(type as JobType) || [];
        queue.push(...jobs);
        this.jobQueue.set(type as JobType, queue);
      }
    }

    // Import config if provided (but preserve sensitive settings)
    if (state.config) {
      this.config = {
        ...this.config,
        ...state.config,
        // Preserve auth settings
        auth: this.config.auth
      };
    }

    logger.info(
      `Imported state: ${state.cursors.length} cursors, ${Object.keys(state.discoveredResources).length} resource types, ${this.getTotalQueuedJobs()} queued jobs`
    );
  }

  /**
   * Set concurrency level
   */
  setConcurrency(concurrency: number): void {
    this.config.concurrency = concurrency;

    // Process more jobs if we increased concurrency
    if (this.isRunning && !this.isPaused) {
      this.processNextJobs();
    }
  }

  /**
   * Get resource-specific concurrency
   */
  getResourceConcurrency(resourceType: string): number {
    return this.config.concurrencyPerResourceType?.[resourceType] || this.config.concurrency;
  }

  /**
   * Set resource-specific concurrency
   */
  setResourceConcurrency(resourceType: string, concurrency: number): void {
    if (!this.config.concurrencyPerResourceType) {
      this.config.concurrencyPerResourceType = {};
    }

    this.config.concurrencyPerResourceType[resourceType] = concurrency;

    // Process more jobs if we increased concurrency
    if (this.isRunning && !this.isPaused) {
      this.processNextJobs();
    }
  }

  /**
   * Clear all queued jobs
   */
  clearQueues(): void {
    for (const jobType of this.jobQueue.keys()) {
      this.jobQueue.set(jobType, []);
    }

    logger.info("All job queues cleared");
  }

  /**
   * Get queue statistics
   */
  getQueueStats(): Record<string, { queued: number; running: number }> {
    const stats: Record<string, { queued: number; running: number }> = {};

    for (const [type, queue] of this.jobQueue.entries()) {
      stats[type] = {
        queued: queue.length,
        running: this.runningJobsByType.get(type)?.size || 0
      };
    }

    return stats;
  }
}
