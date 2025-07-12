import { eq, and, desc, asc, gte, lte, inArray } from 'drizzle-orm';
import { job } from '$lib/server/db/base-schema';
import { JobStatus, CrawlCommand, TokenProvider } from '../../../types';
import type { DatabaseManager } from './database-manager';
import type {
  Job,
  JobInsert,
  SocketJobProgress
} from '../types/database';
import type { WebAppJobAssignmentData } from '../types/messages';

/**
 * Safely converts a value to a Date object for Drizzle timestamp columns
 */
function ensureDate(value: any): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid date value: ${value}`);
    }
    return date;
  }
  throw new Error(`Cannot convert to Date: ${typeof value} ${value}`);
}

/**
 * Database operations for Job table management
 * 
 * Provides:
 * - Job creation, updates, and status changes
 * - Progress tracking updates with resume state management
 * - Query builders for job filtering and status tracking
 * - Integration with crawler job assignments
 */
export class JobRepository {
  constructor(private dbManager: DatabaseManager) {}

  /**
   * Create a new job from crawler assignment
   */
  async createJob(jobData: JobInsert): Promise<Job> {
    return await this.dbManager.withTransaction(async (db) => {
      const [createdJob] = await db.insert(job).values(jobData).returning();
      return createdJob as Job;
    });
  }

  /**
   * Update job status and metadata
   */
  async updateJobStatus(
    jobId: string, 
    status: JobStatus, 
    metadata?: {
      startedAt?: Date;
      finishedAt?: Date;
      errorMessage?: string;
    }
  ): Promise<Job> {
    return await this.dbManager.withTransaction<Job>(async (db) => {
      const updateData: Partial<JobInsert> = {
        status,
        updated_at: new Date()
      };

      if (metadata?.startedAt) {
        updateData.started_at = ensureDate(metadata.startedAt);
      }
      if (metadata?.finishedAt) {
        updateData.finished_at = ensureDate(metadata.finishedAt);
      }

      const [updatedJob] = await db
        .update(job)
        .set(updateData)
        .where(eq(job.id, jobId))
        .returning();

      if (!updatedJob) {
        throw new Error(`Job not found: ${jobId}`);
      }

      return updatedJob as Job;
    });
  }

  /**
   * Update job progress data
   */
  async updateJobProgress(jobId: string, progressData: SocketJobProgress): Promise<Job> {
    return await this.dbManager.withTransaction(async (db) => {
      const [updatedJob] = await db
        .update(job)
        .set({
          progress: progressData as any,
          updated_at: new Date()
        })
        .where(eq(job.id, jobId))
        .returning();

      if (!updatedJob) {
        throw new Error(`Job not found: ${jobId}`);
      }

      return updatedJob as Job;
    });
  }

  /**
   * Update job resume state
   */
  async updateResumeState(jobId: string, resumeState: Record<string, any>): Promise<Job> {
    return await this.dbManager.withTransaction(async (db) => {
      const [updatedJob] = await db
        .update(job)
        .set({
          resumeState: resumeState,
          updated_at: new Date()
        })
        .where(eq(job.id, jobId))
        .returning();

      if (!updatedJob) {
        throw new Error(`Job not found: ${jobId}`);
      }

      return updatedJob as Job;
    });
  }

  /**
   * Get job by ID
   */
  async getJob(jobId: string): Promise<Job | null> {
    const db = this.dbManager.getDatabase();
    const [foundJob] = await db
      .select()
      .from(job)
      .where(eq(job.id, jobId))
      .limit(1);

    return foundJob as Job || null;
  }

  /**
   * Get jobs by status
   */
  async getJobsByStatus(status: JobStatus, accountId?: string): Promise<Job[]> {
    const db = this.dbManager.getDatabase();
    if (accountId) {
      return await db
        .select()
        .from(job)
        .where(and(eq(job.status, status), eq(job.accountId, accountId)))
        .orderBy(desc(job.created_at)) as Job[];
    }

    return await db
      .select()
      .from(job)
      .where(eq(job.status, status))
      .orderBy(desc(job.created_at)) as Job[];
  }

  /**
   * Get active jobs (queued or running)
   */
  async getActiveJobs(accountId?: string): Promise<Job[]> {
    const db = this.dbManager.getDatabase();
    const activeStatuses = [JobStatus.queued, JobStatus.running];
    
    if (accountId) {
      return await db
        .select()
        .from(job)
        .where(and(
          inArray(job.status, activeStatuses),
          eq(job.accountId, accountId)
        ))
        .orderBy(desc(job.created_at)) as Job[];
    }

    return await db
      .select()
      .from(job)
      .where(inArray(job.status, activeStatuses))
      .orderBy(desc(job.created_at)) as Job[];
  }

  /**
   * Get jobs requiring retry (failed but retryable)
   */
  async getRetryableJobs(maxAge: Date): Promise<Job[]> {
    const db = this.dbManager.getDatabase();
    return await db
      .select()
      .from(job)
      .where(
        and(
          eq(job.status, JobStatus.failed),
          gte(job.updated_at, maxAge)
        )
      )
      .orderBy(asc(job.updated_at)) as Job[];
  }

  /**
   * Get jobs by account and command
   */
  async getJobsByAccountAndCommand(accountId: string, command: CrawlCommand): Promise<Job[]> {
    const db = this.dbManager.getDatabase();
    return await db
      .select()
      .from(job)
      .where(
        and(
          eq(job.accountId, accountId),
          eq(job.command, command)
        )
      )
      .orderBy(desc(job.created_at)) as Job[];
  }

  /**
   * Get jobs by full path
   */
  async getJobsByPath(fullPath: string, status?: JobStatus): Promise<Job[]> {
    const db = this.dbManager.getDatabase();
    
    if (status) {
      return await db
        .select()
        .from(job)
        .where(and(eq(job.full_path, fullPath), eq(job.status, status)))
        .orderBy(desc(job.created_at)) as Job[];
    }

    return await db
      .select()
      .from(job)
      .where(eq(job.full_path, fullPath))
      .orderBy(desc(job.created_at)) as Job[];
  }

  /**
   * Get job statistics for an account
   */
  async getJobStatistics(accountId: string): Promise<JobStatistics> {
    const db = this.dbManager.getDatabase();
    const jobs = await db
      .select()
      .from(job)
      .where(eq(job.accountId, accountId));

    const stats: JobStatistics = {
      total: jobs.length,
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      paused: 0,
      by_command: {}
    };

    jobs.forEach(j => {
      switch (j.status) {
        case JobStatus.queued: stats.queued++; break;
        case JobStatus.running: stats.running++; break;
        case JobStatus.finished: stats.completed++; break;
        case JobStatus.failed: stats.failed++; break;
        case JobStatus.paused: stats.paused++; break;
      }

      if (!stats.by_command[j.command]) {
        stats.by_command[j.command] = 0;
      }
      stats.by_command[j.command]!++;
    });

    return stats;
  }

  /**
   * Delete job by ID
   */
  async deleteJob(jobId: string): Promise<void> {
    await this.dbManager.withTransaction(async (db) => {
      const result = await db.delete(job).where(eq(job.id, jobId));
      if (result.rowsAffected === 0) {
        throw new Error(`Job not found: ${jobId}`);
      }
    });
  }

  /**
   * Delete jobs older than specified date
   */
  async deleteJobsOlderThan(olderThan: Date, status?: JobStatus): Promise<number> {
    return await this.dbManager.withTransaction(async (db) => {
      if (status) {
        const result = await db
          .delete(job)
          .where(and(lte(job.updated_at, olderThan), eq(job.status, status)));
        return result.rowsAffected || 0;
      }

      const result = await db
        .delete(job)
        .where(lte(job.updated_at, olderThan));
      return result.rowsAffected || 0;
    });
  }

  /**
   * Mark job as failed with error details
   */
  async markJobFailed(jobId: string, errorMessage: string): Promise<Job> {
    return await this.updateJobStatus(jobId, JobStatus.failed, {
      finishedAt: new Date(),
      errorMessage
    });
  }

  /**
   * Mark job as completed with output files
   */
  async markJobCompleted(jobId: string, outputFiles?: string[], summary?: string): Promise<Job> {
    return await this.dbManager.withTransaction(async (db) => {
      // Update the job progress with final data if provided
      const progressUpdate: any = {};
      if (outputFiles) {
        progressUpdate.output_files = outputFiles;
      }
      if (summary) {
        progressUpdate.summary = summary;
      }

      const [updatedJob] = await db
        .update(job)
        .set({
          status: JobStatus.finished,
          finished_at: new Date(),
          updated_at: new Date(),
          ...(Object.keys(progressUpdate).length > 0 && { progress: progressUpdate })
        })
        .where(eq(job.id, jobId))
        .returning();

      if (!updatedJob) {
        throw new Error(`Job not found: ${jobId}`);
      }

      return updatedJob as Job;
    });
  }

  /**
   * Pause a running job
   */
  async pauseJob(jobId: string): Promise<Job> {
    return await this.updateJobStatus(jobId, JobStatus.paused);
  }

  /**
   * Resume a paused job
   */
  async resumeJob(jobId: string): Promise<Job> {
    return await this.updateJobStatus(jobId, JobStatus.queued);
  }

  /**
   * Map crawler job type to crawl command
   */
  private mapJobTypeToCrawlCommand(jobType: string): CrawlCommand {
    switch (jobType) {
      case 'discover_namespaces':
        return CrawlCommand.GROUP_PROJECT_DISCOVERY;
      case 'crawl_user':
        return CrawlCommand.users;
      case 'crawl_group':
        return CrawlCommand.group;
      case 'crawl_project':
        return CrawlCommand.project;
      default:
        return CrawlCommand.authorizationScope;
    }
  }
}

// Type definitions
interface JobStatistics {
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  paused: number;
  by_command: Record<string, number>;
}