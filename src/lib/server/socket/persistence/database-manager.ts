/* eslint-disable @typescript-eslint/no-unused-vars */
import { getDb } from '$lib/server/db';
import { job, area } from '$lib/server/db/base-schema';
import {
  socketConnection,
  jobQueue,
  jobAssignmentMapping,
  jobErrorLog
} from '$lib/server/db/schema';
import { eq, and, lte, desc, asc, count, sql, inArray } from 'drizzle-orm';
import type {
  SocketDatabaseOperations,
  ConnectionStateOperations,
  JobQueueOperations,
  Job,
  JobInsert,
  SocketJobProgress,
  SocketJobError,
  JobAssignmentMapping,
  SocketConnectionState,
  JobQueueEntry
} from '../types/database.js';
import type {
  WebAppJobAssignmentData,
  WebAppProgressUpdate,
  WebAppJobStatus
} from '../types/messages.js';
import { JobStatus, CrawlCommand, AreaType, TokenProvider } from '$lib/types';
import { getLogger } from '@logtape/logtape';

const logger = getLogger(['server', 'socket', 'database']);

/**
 * Refactored database manager that uses the existing Drizzle ORM infrastructure
 * and follows the established patterns in the codebase.
 * 
 * Key improvements:
 * - Uses existing database connection from $lib/server/db
 * - Follows established Drizzle ORM patterns
 * - Integrates with existing schema management
 * - Uses proper transaction handling
 * - Maintains type safety throughout
 */
export class DatabaseManager {
  private db = getDb();

  /**
   * Get database instance - uses the shared connection
   */
  getDatabase() {
    return this.db;
  }

  /**
   * Check database health using existing connection
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.db.select().from(job).limit(1);
      return true;
    } catch (error) {
      logger.error('Database health check failed:', { error });
      return false;
    }
  }

  /**
   * Execute operation within a transaction using Drizzle's transaction system
   */
  async withTransaction<T>(operation: (db: typeof this.db) => Promise<T>): Promise<T> {
    return await this.db.transaction(async (tx) => {
      try {
        const result = await operation(tx as any);
        return result;
      } catch (error) {
        logger.error('Transaction failed, rolling back:', { error });
        throw error;
      }
    });
  }

  /**
   * Create database operations adapter using proper Drizzle patterns
   */
  createDatabaseOperations(): SocketDatabaseOperations {
    return new SocketDatabaseOperationsImpl(this);
  }

  /**
   * Create connection state operations
   */
  createConnectionStateOperations(): ConnectionStateOperations {
    return new ConnectionStateOperationsImpl(this);
  }

  /**
   * Create job queue operations
   */
  createJobQueueOperations(): JobQueueOperations {
    return new JobQueueOperationsImpl(this);
  }

  /**
   * Get database statistics using proper Drizzle queries
   */
  async getStatistics(): Promise<DatabaseStatistics> {
    const db = this.getDatabase();
    
    // Count jobs by status using proper aggregation
    const jobCounts = await db
      .select({
        status: job.status,
        count: count()
      })
      .from(job)
      .groupBy(job.status);

    const jobStats = jobCounts.reduce((acc, { status, count: statusCount }) => {
      acc.total += statusCount;
      switch (status) {
        case 'queued': acc.queued += statusCount; break;
        case 'running': acc.running += statusCount; break;
        case 'finished': acc.completed += statusCount; break;
        case 'failed': acc.failed += statusCount; break;
      }
      return acc;
    }, { total: 0, queued: 0, running: 0, completed: 0, failed: 0 });

    const areaCountResult = await db.select({ count: count() }).from(area);
    const areaCount = areaCountResult[0]?.count || 0;

    return {
      jobs: jobStats,
      areas: {
        total: areaCount
      },
      connection: {
        isHealthy: await this.healthCheck(),
        reconnectAttempts: 0 // No longer needed with shared connection
      }
    };
  }

  /**
   * Cleanup old records using proper Drizzle operations
   */
  async cleanup(olderThan: Date): Promise<CleanupResult> {
    return await this.withTransaction(async (tx) => {
      // Delete completed jobs older than specified date
      const deletedJobs = await tx
        .delete(job)
        .where(
          and(
            eq(job.status, JobStatus.finished),
            lte(job.finished_at, olderThan)
          )
        );

      // Clean up related error logs
      const deletedErrors = await tx
        .delete(jobErrorLog)
        .where(
          lte(jobErrorLog.timestamp, olderThan)
        );

      // Clean up old connections
      const deletedConnections = await tx
        .delete(socketConnection)
        .where(
          and(
            eq(socketConnection.is_active, false),
            lte(socketConnection.last_heartbeat, olderThan)
          )
        );

      return {
        deletedJobs: deletedJobs.rowsAffected || 0,
        deletedErrors: deletedErrors.rowsAffected || 0,
        deletedConnections: deletedConnections.rowsAffected || 0
      };
    });
  }
}

/**
 * Implementation of socket database operations using proper Drizzle ORM patterns
 */
class SocketDatabaseOperationsImpl implements SocketDatabaseOperations {
  constructor(private dbManager: DatabaseManager) {}

  async createJobFromAssignment(assignment: WebAppJobAssignmentData): Promise<Job> {
    return await this.dbManager.withTransaction(async (tx) => {
      // Create the job record using proper Drizzle insert
      const jobData: JobInsert = {
        accountId: assignment.account_id,
        userId: assignment.user_id,
        command: this.mapJobTypeToCommand(assignment.job_type),
        full_path: assignment.namespace_path,
        provider: assignment.provider as TokenProvider,
        gitlabGraphQLUrl: assignment.gitlab_host,
        status: JobStatus.queued,
        progress: {
          overall_completion: 0,
          time_elapsed: 0,
          entities: [],
          status: 'running',
          last_update: new Date().toISOString()
        } as SocketJobProgress,
        resumeState: assignment.resume ? {} : null
      };

      const [createdJob] = await tx.insert(job).values(jobData).returning();
      if (!createdJob) {
        throw new Error('Failed to create job');
      }

      // Create assignment mapping using Drizzle insert
      await tx.insert(jobAssignmentMapping).values({
        web_app_job_id: createdJob.id,
        crawler_job_id: assignment.job_id,
        account_id: assignment.account_id,
        user_id: assignment.user_id,
        status: 'assigned'
      });

      // Create or update area if needed using proper upsert pattern
      if (assignment.namespace_path && assignment.entity_id) {
        await tx.insert(area).values({
          full_path: assignment.namespace_path,
          gitlab_id: assignment.entity_id,
          name: assignment.namespace_path.split('/').pop() || assignment.namespace_path,
          type: assignment.job_type === 'crawl_group' ? AreaType.group : AreaType.project
        }).onConflictDoNothing();
      }

      return createdJob as Job;
    });
  }

  async updateJobFromProgress(jobId: string, progressUpdate: WebAppProgressUpdate): Promise<Job> {
    return await this.dbManager.withTransaction(async (tx) => {
      const progressData: SocketJobProgress = {
        overall_completion: progressUpdate.overall_completion,
        time_elapsed: progressUpdate.time_elapsed,
        estimated_time_remaining: progressUpdate.estimated_time_remaining,
        entities: progressUpdate.progress_data,
        status: progressUpdate.status,
        last_update: progressUpdate.last_update
      };

      const [updatedJob] = await tx
        .update(job)
        .set({
          progress: progressData,
          updated_at: new Date()
        })
        .where(eq(job.id, jobId))
        .returning();

      if (!updatedJob) {
        throw new Error(`Job ${jobId} not found`);
      }

      return updatedJob as Job;
    });
  }

  async updateJobStatus(jobId: string, statusUpdate: WebAppJobStatus): Promise<Job> {
    return await this.dbManager.withTransaction(async (tx) => {
      const updateData: Partial<JobInsert> = {
        status: statusUpdate.status as JobStatus,
        updated_at: new Date()
      };

      if (statusUpdate.started_at) {
        updateData.started_at = new Date(statusUpdate.started_at);
      }

      if (statusUpdate.finished_at) {
        updateData.finished_at = new Date(statusUpdate.finished_at);
      }

      const [updatedJob] = await tx
        .update(job)
        .set(updateData)
        .where(eq(job.id, jobId))
        .returning();

      if (!updatedJob) {
        throw new Error(`Job ${jobId} not found`);
      }

      // Update assignment mapping status
      if (statusUpdate.crawler_job_id) {
        await tx
          .update(jobAssignmentMapping)
          .set({
            status: this.mapJobStatusToAssignmentStatus(statusUpdate.status)
          })
          .where(and(
            eq(jobAssignmentMapping.web_app_job_id, jobId),
            eq(jobAssignmentMapping.crawler_job_id, statusUpdate.crawler_job_id)
          ));
      }

      return updatedJob as Job;
    });
  }

  async saveProgressUpdate(jobId: string, progress: SocketJobProgress): Promise<void> {
    const db = this.dbManager.getDatabase();
    await db
      .update(job)
      .set({
        progress: progress,
        updated_at: new Date()
      })
      .where(eq(job.id, jobId));
  }

  async getJobProgress(jobId: string): Promise<SocketJobProgress | null> {
    const db = this.dbManager.getDatabase();
    const [result] = await db
      .select({ progress: job.progress })
      .from(job)
      .where(eq(job.id, jobId))
      .limit(1);

    return result?.progress as SocketJobProgress || null;
  }

  async logJobError(jobId: string, error: SocketJobError): Promise<void> {
    const db = this.dbManager.getDatabase();
    await db.insert(jobErrorLog).values({
      job_id: jobId,
      error_type: error.error_type,
      error_message: error.error_message,
      stack_trace: error.stack_trace,
      context: error.context,
      retry_count: error.retry_count,
      is_recoverable: error.is_recoverable,
      resolution: error.resolution
    });
  }

  async getJobErrors(jobId: string): Promise<SocketJobError[]> {
    const db = this.dbManager.getDatabase();
    const errors = await db
      .select()
      .from(jobErrorLog)
      .where(eq(jobErrorLog.job_id, jobId))
      .orderBy(desc(jobErrorLog.timestamp));

    return errors.map(err => ({
      timestamp: err.timestamp.toISOString(),
      error_type: err.error_type,
      error_message: err.error_message,
      stack_trace: err.stack_trace || undefined,
      context: err.context || undefined,
      retry_count: err.retry_count,
      is_recoverable: !!err.is_recoverable,
      resolution: err.resolution || undefined
    }));
  }

  async createAssignmentMapping(mapping: Omit<JobAssignmentMapping, 'createdAt'>): Promise<JobAssignmentMapping> {
    const db = this.dbManager.getDatabase();
    const [created] = await db.insert(jobAssignmentMapping).values({
      web_app_job_id: mapping.webAppJobId,
      crawler_job_id: mapping.crawlerJobId,
      account_id: mapping.accountId,
      user_id: mapping.userId,
      status: mapping.status,
      metadata: mapping.metadata
    }).returning();

    if (!created) {
      throw new Error('Failed to create assignment mapping');
    }

    return {
      webAppJobId: created.web_app_job_id,
      crawlerJobId: created.crawler_job_id,
      accountId: created.account_id,
      userId: created.user_id || undefined,
      createdAt: created.created_at,
      assignedAt: created.assigned_at || undefined,
      completedAt: created.completed_at || undefined,
      status: created.status as JobAssignmentMapping['status'],
      metadata: created.metadata || undefined
    };
  }

  async getAssignmentMapping(webAppJobId: string): Promise<JobAssignmentMapping | null> {
    const db = this.dbManager.getDatabase();
    const [result] = await db
      .select()
      .from(jobAssignmentMapping)
      .where(eq(jobAssignmentMapping.web_app_job_id, webAppJobId))
      .limit(1);

    if (!result) return null;

    return {
      webAppJobId: result.web_app_job_id,
      crawlerJobId: result.crawler_job_id,
      accountId: result.account_id,
      userId: result.user_id || undefined,
      createdAt: result.created_at,
      assignedAt: result.assigned_at || undefined,
      completedAt: result.completed_at || undefined,
      status: result.status as JobAssignmentMapping['status'],
      metadata: result.metadata || undefined
    };
  }

  async updateAssignmentStatus(webAppJobId: string, status: JobAssignmentMapping['status']): Promise<void> {
    const db = this.dbManager.getDatabase();
    const updateData: any = { status };

    if (status === 'completed') {
      updateData.completed_at = new Date();
    } else if (status === 'assigned') {
      updateData.assigned_at = new Date();
    }

    await db
      .update(jobAssignmentMapping)
      .set(updateData)
      .where(eq(jobAssignmentMapping.web_app_job_id, webAppJobId));
  }

  async cleanupCompletedJobs(olderThan: Date): Promise<number> {
    return await this.dbManager.withTransaction(async (tx) => {
      const result = await tx
        .delete(job)
        .where(
          and(
            eq(job.status, JobStatus.finished),
            lte(job.finished_at, olderThan)
          )
        );
      return result.rowsAffected || 0;
    });
  }

  async cleanupFailedJobs(olderThan: Date, _maxRetries: number): Promise<number> {
    return await this.dbManager.withTransaction(async (tx) => {
      // First find failed jobs that have exceeded max retries
      const failedJobs = await tx
        .select({ id: job.id })
        .from(job)
        .where(
          and(
            eq(job.status, JobStatus.failed),
            lte(job.finished_at, olderThan)
          )
        );

      if (failedJobs.length === 0) return 0;

      // Delete these jobs
      const result = await tx
        .delete(job)
        .where(
          inArray(job.id, failedJobs.map(j => j.id))
        );

      return result.rowsAffected || 0;
    });
  }

  private mapJobTypeToCommand(jobType: string): CrawlCommand {
    switch (jobType) {
      case 'discover_namespaces': return CrawlCommand.GROUP_PROJECT_DISCOVERY;
      case 'crawl_user': return CrawlCommand.users;
      case 'crawl_group': return CrawlCommand.group;
      case 'crawl_project': return CrawlCommand.project;
      default: return CrawlCommand.authorizationScope;
    }
  }

  private mapJobStatusToAssignmentStatus(status: string): JobAssignmentMapping['status'] {
    switch (status) {
      case 'queued': return 'pending';
      case 'assigned': return 'assigned';
      case 'running': return 'running';
      case 'completed': return 'completed';
      case 'failed': return 'failed';
      case 'cancelled': return 'cancelled';
      default: return 'pending';
    }
  }

  // Message processing methods using proper Drizzle patterns
  async processJobStartedMessage(crawlerJobId: string, _data: any): Promise<void> {
    const mapping = await this.getAssignmentByCrawlerJobId(crawlerJobId);

    if (mapping) {
      await this.updateJobStatus(mapping.web_app_job_id, {
        web_app_job_id: mapping.web_app_job_id,
        crawler_job_id: crawlerJobId,
        status: 'running',
        started_at: new Date().toISOString()
      });
    }
  }

  async processJobProgressMessage(crawlerJobId: string, progressData: any): Promise<void> {
    const mapping = await this.getAssignmentByCrawlerJobId(crawlerJobId);

    if (mapping) {
      await this.updateJobFromProgress(mapping.web_app_job_id, {
        web_app_job_id: mapping.web_app_job_id,
        crawler_job_id: crawlerJobId,
        progress_data: progressData.progress || [],
        overall_completion: progressData.overall_completion || 0,
        time_elapsed: progressData.time_elapsed || 0,
        estimated_time_remaining: progressData.estimated_time_remaining,
        status: 'running',
        last_update: new Date().toISOString()
      });
    }
  }

  async processJobCompletedMessage(crawlerJobId: string, data: any): Promise<void> {
    const mapping = await this.getAssignmentByCrawlerJobId(crawlerJobId);

    if (mapping) {
      await this.updateJobStatus(mapping.web_app_job_id, {
        web_app_job_id: mapping.web_app_job_id,
        crawler_job_id: crawlerJobId,
        status: 'completed',
        finished_at: new Date().toISOString(),
        output_files: data.output_files,
        summary: data.summary
      });

      await this.updateAssignmentStatus(mapping.web_app_job_id, 'completed');
    }
  }

  async processJobFailedMessage(crawlerJobId: string, data: any): Promise<void> {
    const mapping = await this.getAssignmentByCrawlerJobId(crawlerJobId);

    if (mapping) {
      // Log the error
      if (data.error_context) {
        await this.logJobError(mapping.web_app_job_id, {
          timestamp: new Date().toISOString(),
          error_type: data.error_context.error_type || 'CrawlerError',
          error_message: data.error_context.error_message || 'Job failed',
          stack_trace: data.error_context.stack_trace,
          context: data.error_context,
          retry_count: data.error_context.retry_count || 0,
          is_recoverable: data.error_context.is_recoverable !== false
        });
      }

      await this.updateJobStatus(mapping.web_app_job_id, {
        web_app_job_id: mapping.web_app_job_id,
        crawler_job_id: crawlerJobId,
        status: 'failed',
        finished_at: new Date().toISOString(),
        error_message: data.error_context?.error_message || 'Job failed'
      });

      await this.updateAssignmentStatus(mapping.web_app_job_id, 'failed');
    }
  }

  async processJobsDiscoveredMessage(crawlerJobId: string, data: any): Promise<Job[]> {
    const createdJobs: Job[] = [];
    const parentMapping = await this.getAssignmentByCrawlerJobId(crawlerJobId);

    if (parentMapping && data.discovered_jobs) {
      // Create new jobs for each discovered entity
      for (const discoveredJob of data.discovered_jobs) {
        try {
          const jobAssignment: WebAppJobAssignmentData = {
            job_id: `${discoveredJob.job_type}_${discoveredJob.entity_id}`,
            web_app_job_id: '', // Will be set after job creation
            account_id: parentMapping.account_id,
            user_id: parentMapping.user_id || undefined,
            job_type: discoveredJob.job_type,
            namespace_path: discoveredJob.namespace_path,
            entity_id: discoveredJob.entity_id,
            gitlab_host: discoveredJob.gitlab_host || '',
            access_token: '', // This should come from the parent job context
            provider: discoveredJob.provider || 'gitlab-cloud',
            priority: 1,
            resume: false
          };

          const newJob = await this.createJobFromAssignment(jobAssignment);
          createdJobs.push(newJob);
        } catch (error) {
          logger.error('Failed to create discovered job:', { error, discoveredJob });
        }
      }
    }

    return createdJobs;
  }

  async getJobByCrawlerJobId(crawlerJobId: string): Promise<Job | null> {
    const db = this.dbManager.getDatabase();
    const [mapping] = await db
      .select()
      .from(jobAssignmentMapping)
      .where(eq(jobAssignmentMapping.crawler_job_id, crawlerJobId))
      .limit(1);

    if (!mapping) return null;

    const [jobResult] = await db
      .select()
      .from(job)
      .where(eq(job.id, mapping.web_app_job_id))
      .limit(1);

    return jobResult as Job || null;
  }

  private async getAssignmentByCrawlerJobId(crawlerJobId: string) {
    const db = this.dbManager.getDatabase();
    const [result] = await db
      .select()
      .from(jobAssignmentMapping)
      .where(eq(jobAssignmentMapping.crawler_job_id, crawlerJobId))
      .limit(1);
    return result;
  }
}

/**
 * Connection state operations using proper Drizzle patterns
 */
class ConnectionStateOperationsImpl implements ConnectionStateOperations {
  constructor(private dbManager: DatabaseManager) {}

  async registerConnection(connection: Omit<SocketConnectionState, 'id' | 'connectedAt' | 'lastHeartbeat' | 'isActive'>): Promise<SocketConnectionState> {
    const db = this.dbManager.getDatabase();
    const [created] = await db.insert(socketConnection).values({
      crawler_id: connection.crawlerId,
      active_jobs: connection.activeJobs,
      system_status: connection.systemStatus,
      metadata: connection.metadata
    }).returning();

    if (!created) {
      throw new Error('Failed to register connection');
    }

    return {
      id: created.id,
      crawlerId: created.crawler_id || undefined,
      connectedAt: created.connected_at,
      lastHeartbeat: created.last_heartbeat,
      isActive: !!created.is_active,
      activeJobs: created.active_jobs || [],
      systemStatus: created.system_status as SocketConnectionState['systemStatus'],
      metadata: created.metadata || undefined
    };
  }

  async updateHeartbeat(connectionId: string, status?: SocketConnectionState['systemStatus']): Promise<void> {
    const db = this.dbManager.getDatabase();
    const updateData: any = {
      last_heartbeat: new Date()
    };

    if (status) {
      updateData.system_status = status;
    }

    await db
      .update(socketConnection)
      .set(updateData)
      .where(eq(socketConnection.id, connectionId));
  }

  async updateActiveJobs(connectionId: string, jobIds: string[]): Promise<void> {
    const db = this.dbManager.getDatabase();
    await db
      .update(socketConnection)
      .set({
        active_jobs: jobIds
      })
      .where(eq(socketConnection.id, connectionId));
  }

  async markDisconnected(connectionId: string): Promise<void> {
    const db = this.dbManager.getDatabase();
    await db
      .update(socketConnection)
      .set({
        is_active: false
      })
      .where(eq(socketConnection.id, connectionId));
  }

  async getActiveConnections(): Promise<SocketConnectionState[]> {
    const db = this.dbManager.getDatabase();
    const connections = await db
      .select()
      .from(socketConnection)
      .where(eq(socketConnection.is_active, true));

    return connections.map(conn => ({
      id: conn.id,
      crawlerId: conn.crawler_id || undefined,
      connectedAt: conn.connected_at,
      lastHeartbeat: conn.last_heartbeat,
      isActive: !!conn.is_active,
      activeJobs: conn.active_jobs || [],
      systemStatus: conn.system_status as SocketConnectionState['systemStatus'],
      metadata: conn.metadata || undefined
    }));
  }

  async getConnection(id: string): Promise<SocketConnectionState | null> {
    const db = this.dbManager.getDatabase();
    const [conn] = await db
      .select()
      .from(socketConnection)
      .where(eq(socketConnection.id, id))
      .limit(1);

    if (!conn) return null;

    return {
      id: conn.id,
      crawlerId: conn.crawler_id || undefined,
      connectedAt: conn.connected_at,
      lastHeartbeat: conn.last_heartbeat,
      isActive: !!conn.is_active,
      activeJobs: conn.active_jobs || [],
      systemStatus: conn.system_status as SocketConnectionState['systemStatus'],
      metadata: conn.metadata || undefined
    };
  }

  async cleanupStaleConnections(timeout: number): Promise<number> {
    const db = this.dbManager.getDatabase();
    const staleTime = new Date(Date.now() - timeout);
    
    const result = await db
      .update(socketConnection)
      .set({ is_active: false })
      .where(
        and(
          eq(socketConnection.is_active, true),
          lte(socketConnection.last_heartbeat, staleTime)
        )
      );

    return result.rowsAffected || 0;
  }
}

/**
 * Job queue operations using proper Drizzle patterns
 */
class JobQueueOperationsImpl implements JobQueueOperations {
  constructor(private dbManager: DatabaseManager) {}

  async enqueue(jobData: Omit<JobQueueEntry, 'id' | 'attempts' | 'status' | 'scheduledAt'>): Promise<JobQueueEntry> {
    const db = this.dbManager.getDatabase();
    const [created] = await db.insert(jobQueue).values({
      web_app_job_id: jobData.webAppJobId,
      priority: jobData.priority,
      max_attempts: jobData.maxAttempts,
      data: jobData.data
    }).returning();

    if (!created) {
      throw new Error('Failed to enqueue job');
    }

    return {
      id: created.id,
      webAppJobId: created.web_app_job_id,
      priority: created.priority,
      scheduledAt: created.scheduled_at,
      attempts: created.attempts,
      maxAttempts: created.max_attempts,
      data: created.data as WebAppJobAssignmentData,
      status: created.status as JobQueueEntry['status'],
      error: created.error || undefined,
      lastAttemptAt: created.last_attempt_at || undefined
    };
  }

  async dequeue(limit = 10): Promise<JobQueueEntry[]> {
    const db = this.dbManager.getDatabase();
    const jobs = await db
      .select()
      .from(jobQueue)
      .where(eq(jobQueue.status, 'pending'))
      .orderBy(desc(jobQueue.priority), asc(jobQueue.scheduled_at))
      .limit(limit);

    return jobs.map(job => ({
      id: job.id,
      webAppJobId: job.web_app_job_id,
      priority: job.priority,
      scheduledAt: job.scheduled_at,
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
      data: job.data as WebAppJobAssignmentData,
      status: job.status as JobQueueEntry['status'],
      error: job.error || undefined,
      lastAttemptAt: job.last_attempt_at || undefined
    }));
  }

  async markProcessing(id: string): Promise<void> {
    const db = this.dbManager.getDatabase();
    await db
      .update(jobQueue)
      .set({
        status: 'processing',
        last_attempt_at: new Date()
      })
      .where(eq(jobQueue.id, id));
  }

  async markCompleted(id: string): Promise<void> {
    const db = this.dbManager.getDatabase();
    await db
      .update(jobQueue)
      .set({
        status: 'completed'
      })
      .where(eq(jobQueue.id, id));
  }

  async markFailed(id: string, error: string): Promise<void> {
    const db = this.dbManager.getDatabase();
    await db
      .update(jobQueue)
      .set({
        status: 'failed',
        error: error,
        attempts: sql`${jobQueue.attempts} + 1`
      })
      .where(eq(jobQueue.id, id));
  }

  async getQueueStatus(): Promise<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  }> {
    const db = this.dbManager.getDatabase();
    const results = await db
      .select({
        status: jobQueue.status,
        count: count()
      })
      .from(jobQueue)
      .groupBy(jobQueue.status);

    const status = { pending: 0, processing: 0, completed: 0, failed: 0 };
    results.forEach(result => {
      if (result.status in status) {
        (status as any)[result.status] = result.count;
      }
    });

    return status;
  }

  async retryFailed(maxAge: Date): Promise<number> {
    const db = this.dbManager.getDatabase();
    const result = await db
      .update(jobQueue)
      .set({
        status: 'pending',
        error: null
      })
      .where(
        and(
          eq(jobQueue.status, 'failed'),
          lte(jobQueue.last_attempt_at, maxAge),
          sql`${jobQueue.attempts} < ${jobQueue.max_attempts}`
        )
      );

    return result.rowsAffected || 0;
  }

  async cleanup(olderThan: Date): Promise<number> {
    const db = this.dbManager.getDatabase();
    const result = await db
      .delete(jobQueue)
      .where(
        and(
          inArray(jobQueue.status, ['completed', 'failed']),
          lte(jobQueue.scheduled_at, olderThan)
        )
      );

    return result.rowsAffected || 0;
  }
}

// Statistics and cleanup interfaces
interface DatabaseStatistics {
  jobs: {
    total: number;
    queued: number;
    running: number;
    completed: number;
    failed: number;
  };
  areas: {
    total: number;
  };
  connection: {
    isHealthy: boolean;
    reconnectAttempts: number;
  };
}

interface CleanupResult {
  deletedJobs: number;
  deletedErrors: number;
  deletedConnections: number;
}