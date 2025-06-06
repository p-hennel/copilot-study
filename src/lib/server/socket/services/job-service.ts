import { getLogger } from "$lib/logging";
import { db } from "$lib/server/db";
import { job as jobSchema } from "$lib/server/db/schema";
import { JobStatus, CrawlCommand } from "$lib/types";
import type { Job, JobInsert } from "$lib/server/db/base-schema";
import { and, eq, or, desc, sql } from "drizzle-orm";
import type { 
  SimpleJob, 
  EntityType, 
  ProgressData, 
  CompletionData, 
  FailureData 
} from "../types/index.js";

const logger = getLogger(["backend", "socket", "job-service"]);

/**
 * Job Service - Bridges the job manager with socket communication system
 * 
 * Handles job assignment, status tracking, progress persistence, and resume state management
 * for the crawler socket communication layer.
 */
export class JobService {
  /**
   * Get available jobs for assignment to crawlers
   */
  async getAvailableJobs(limit: number = 5): Promise<SimpleJob[]> {
    try {
      logger.info(`🔍 Fetching up to ${limit} available jobs from database...`);
      
      // Query for queued jobs
      const dbJobs = await db.query.job.findMany({
        where: eq(jobSchema.status, JobStatus.queued),
        orderBy: [desc(jobSchema.created_at)],
        limit,
        with: {
          usingAccount: true
        }
      });

      logger.info(`📋 Found ${dbJobs.length} queued jobs in database`);

      // Convert database jobs to SimpleJob format for crawler
      const simpleJobs = await Promise.all(
        dbJobs.map(job => this.convertToSimpleJob(job))
      );

      // Filter out jobs that couldn't be converted (missing data, etc.)
      const validJobs = simpleJobs.filter(job => job !== null) as SimpleJob[];
      
      logger.info(`✅ Returning ${validJobs.length} valid jobs for assignment`);
      return validJobs;

    } catch (error) {
      logger.error("❌ Error fetching available jobs:", { error });
      return [];
    }
  }

  /**
   * Mark a job as started and update database
   */
  async markJobStarted(jobId: string, connectionId: string, startData?: any): Promise<boolean> {
    try {
      logger.info(`🚀 Marking job ${jobId} as started by connection ${connectionId}`);
      
      const result = await db
        .update(jobSchema)
        .set({
          status: JobStatus.running,
          started_at: new Date(),
          progress: {
            ...startData,
            started_by_connection: connectionId,
            started_at: new Date().toISOString()
          }
        })
        .where(eq(jobSchema.id, jobId));

      logger.info(`✅ Job ${jobId} marked as started`);
      return true;

    } catch (error) {
      logger.error(`❌ Error marking job ${jobId} as started:`, { error });
      return false;
    }
  }

  /**
   * Update job progress and resume state
   */
  async updateJobProgress(
    jobId: string, 
    progressData: ProgressData, 
    connectionId: string
  ): Promise<boolean> {
    try {
      logger.debug(`📊 Updating progress for job ${jobId}`);
      
      // Get current job to merge with existing progress
      const currentJob = await db.query.job.findFirst({
        where: eq(jobSchema.id, jobId)
      });

      if (!currentJob) {
        logger.error(`❌ Job ${jobId} not found for progress update`);
        return false;
      }

      // Merge progress data
      const existingProgress = currentJob.progress as any || {};
      const updatedProgress = {
        ...existingProgress,
        stage: progressData.stage,
        entityType: progressData.entityType,
        processed: progressData.processed,
        total: progressData.total,
        message: progressData.message,
        last_update: new Date().toISOString(),
        updated_by_connection: connectionId
      };

      // Update resume state if provided
      const updatedResumeState = progressData.resumeState 
        ? {
            lastEntityId: progressData.resumeState.lastEntityId,
            currentPage: progressData.resumeState.currentPage,
            entityType: progressData.resumeState.entityType,
            updated_at: new Date().toISOString()
          }
        : currentJob.resumeState;

      await db
        .update(jobSchema)
        .set({
          progress: updatedProgress,
          resumeState: updatedResumeState
        })
        .where(eq(jobSchema.id, jobId));

      logger.debug(`✅ Progress updated for job ${jobId}`);
      return true;

    } catch (error) {
      logger.error(`❌ Error updating progress for job ${jobId}:`, { error });
      return false;
    }
  }

  /**
   * Mark job as completed with final results
   */
  async markJobCompleted(
    jobId: string, 
    completionData: CompletionData,
    connectionId: string
  ): Promise<boolean> {
    try {
      logger.info(`🎉 Marking job ${jobId} as completed`);
      
      const finalProgress = {
        success: completionData.success,
        finalCounts: completionData.finalCounts,
        message: completionData.message,
        outputFiles: completionData.outputFiles,
        completed_at: new Date().toISOString(),
        completed_by_connection: connectionId
      };

      await db
        .update(jobSchema)
        .set({
          status: JobStatus.finished,
          finished_at: new Date(),
          progress: finalProgress,
          resumeState: null // Clear resume state on completion
        })
        .where(eq(jobSchema.id, jobId));

      logger.info(`✅ Job ${jobId} marked as completed`);
      return true;

    } catch (error) {
      logger.error(`❌ Error marking job ${jobId} as completed:`, { error });
      return false;
    }
  }

  /**
   * Mark job as failed with error details
   */
  async markJobFailed(
    jobId: string, 
    failureData: FailureData,
    connectionId: string
  ): Promise<boolean> {
    try {
      logger.error(`💥 Marking job ${jobId} as failed: ${failureData.error}`);
      
      const errorProgress = {
        error: failureData.error,
        errorType: failureData.errorType,
        isRecoverable: failureData.isRecoverable,
        partialCounts: failureData.partialCounts,
        failed_at: new Date().toISOString(),
        failed_by_connection: connectionId
      };

      // Keep resume state if the error is recoverable
      const resumeState = failureData.isRecoverable && failureData.resumeState
        ? {
            ...failureData.resumeState,
            error_context: {
              error: failureData.error,
              failed_at: new Date().toISOString()
            }
          }
        : null;

      await db
        .update(jobSchema)
        .set({
          status: JobStatus.failed,
          finished_at: new Date(),
          progress: errorProgress,
          resumeState: resumeState
        })
        .where(eq(jobSchema.id, jobId));

      logger.error(`❌ Job ${jobId} marked as failed`);
      return true;

    } catch (error) {
      logger.error(`❌ Error marking job ${jobId} as failed:`, { error });
      return false;
    }
  }

  /**
   * Get job status and progress
   */
  async getJobStatus(jobId: string): Promise<Job | null> {
    try {
      const job = await db.query.job.findFirst({
        where: eq(jobSchema.id, jobId),
        with: {
          usingAccount: true
        }
      });

      return job || null;
    } catch (error) {
      logger.error(`❌ Error fetching job ${jobId} status:`, { error });
      return null;
    }
  }

  /**
   * Convert database job to SimpleJob format for crawler
   */
  private async convertToSimpleJob(dbJob: any): Promise<SimpleJob | null> {
    try {
      if (!dbJob.usingAccount) {
        logger.warn(`❌ Job ${dbJob.id} missing account information, skipping`);
        return null;
      }

      // Map CrawlCommand to EntityType
      const entityType = this.mapCommandToEntityType(dbJob.command);
      if (!entityType) {
        logger.warn(`❌ Unknown command ${dbJob.command} for job ${dbJob.id}, skipping`);
        return null;
      }

      // Get GitLab URL from job or account
      const gitlabUrl = dbJob.gitlabGraphQLUrl || this.getGitLabUrlFromProvider(dbJob.provider);
      if (!gitlabUrl) {
        logger.warn(`❌ No GitLab URL available for job ${dbJob.id}, skipping`);
        return null;
      }

      // Get access token (this would normally be from account table)
      const accessToken = dbJob.usingAccount.access_token;
      if (!accessToken) {
        logger.warn(`❌ No access token available for job ${dbJob.id}, skipping`);
        return null;
      }

      const simpleJob: SimpleJob = {
        id: dbJob.id,
        entityType: entityType,
        entityId: dbJob.full_path || dbJob.accountId, // Use full_path or fallback to accountId
        gitlabUrl: gitlabUrl,
        accessToken: accessToken,
        resumeState: dbJob.resumeState ? {
          lastEntityId: dbJob.resumeState.lastEntityId,
          currentPage: dbJob.resumeState.currentPage,
          entityType: dbJob.resumeState.entityType
        } : undefined
      };

      logger.debug(`✅ Converted job ${dbJob.id} to SimpleJob format`);
      return simpleJob;

    } catch (error) {
      logger.error(`❌ Error converting job ${dbJob.id} to SimpleJob:`, { error });
      return null;
    }
  }

  /**
   * Map database CrawlCommand to crawler EntityType
   */
  private mapCommandToEntityType(command: CrawlCommand): EntityType | null {
    const mapping: Record<string, EntityType> = {
      [CrawlCommand.GROUP_PROJECT_DISCOVERY]: 'group',
      [CrawlCommand.group]: 'group',
      [CrawlCommand.project]: 'project',
      [CrawlCommand.issues]: 'issue',
      [CrawlCommand.mergeRequests]: 'merge_request',
      [CrawlCommand.commits]: 'commit',
      [CrawlCommand.branches]: 'branch',
      [CrawlCommand.pipelines]: 'pipeline',
      [CrawlCommand.users]: 'user'
    };

    return mapping[command] || null;
  }

  /**
   * Get GitLab URL based on provider type
   */
  private getGitLabUrlFromProvider(provider: string): string | null {
    // This would typically come from settings/config
    switch (provider) {
      case 'gitlab-cloud':
        return 'https://gitlab.com';
      case 'gitlab-onprem':
        // This should come from configuration
        return process.env.GITLAB_ONPREM_URL || null;
      default:
        return null;
    }
  }

  /**
   * Get running jobs count for monitoring
   */
  async getRunningJobsCount(): Promise<number> {
    try {
      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(jobSchema)
        .where(eq(jobSchema.status, JobStatus.running));

      return result[0]?.count || 0;
    } catch (error) {
      logger.error("❌ Error counting running jobs:", { error });
      return 0;
    }
  }

  /**
   * Get job queue statistics
   */
  async getJobQueueStats(): Promise<{
    queued: number;
    running: number;
    completed: number;
    failed: number;
  }> {
    try {
      const stats = await db
        .select({
          status: jobSchema.status,
          count: sql<number>`count(*)`
        })
        .from(jobSchema)
        .groupBy(jobSchema.status);

      const result = {
        queued: 0,
        running: 0,
        completed: 0,
        failed: 0
      };

      for (const stat of stats) {
        switch (stat.status) {
          case JobStatus.queued:
            result.queued = stat.count;
            break;
          case JobStatus.running:
            result.running = stat.count;
            break;
          case JobStatus.finished:
            result.completed = stat.count;
            break;
          case JobStatus.failed:
            result.failed = stat.count;
            break;
        }
      }

      return result;
    } catch (error) {
      logger.error("❌ Error fetching job queue stats:", { error });
      return { queued: 0, running: 0, completed: 0, failed: 0 };
    }
  }
}

// Export singleton instance
export const jobService = new JobService();
