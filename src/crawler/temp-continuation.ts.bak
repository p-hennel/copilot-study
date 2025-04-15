        // Job failed with error in result
        const errorMessage = result.error || "Unknown error";
        logger.error(`Job ${job.id} (${job.type}) failed: ${errorMessage}`);

        this.eventEmitter.emit({
          type: EventType.JOB_FAILED,
          timestamp: new Date(),
          job,
          error: errorMessage,
          attempts: job.retryCount + 1,
          willRetry: job.retryCount < this.config.maxRetries
        });

        // Schedule retry if needed
        this.scheduleJobRetry(job, errorMessage);
      }
    } catch (error) {
      // Job failed with exception
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Job ${job.id} (${job.type}) threw exception: ${errorMessage}`);

      this.eventEmitter.emit({
        type: EventType.JOB_FAILED,
        timestamp: new Date(),
        job,
        error: errorMessage,
        attempts: job.retryCount + 1,
        willRetry: job.retryCount < this.config.maxRetries
      });

      // Schedule retry if needed
      this.scheduleJobRetry(job, errorMessage);
    } finally {
      // Clean up job tracking regardless of outcome
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
   * Modified to use supervisor client for creating jobs
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

    // Report discovery jobs to supervisor via IPC
    this.crawlerSupervisorClient.reportDiscoveredJobs([groupsJob, projectsJob]);

    // Still enqueue these jobs locally as well, as these are the initial discovery jobs
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
    if (.queuedJobs) {
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
    const stats: Record queued: number; running: number }> = {};

    for (const [type, queue] of this.jobQueue.entries()) {
      stats[type] = {
        queued: queue.length,
        running: this.runningJobsByType.get(type)?.size || 0
      };
    }

    return stats;
  }
}
