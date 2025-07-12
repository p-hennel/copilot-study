import { getLogger } from "$lib/logging";
import AppSettings from "$lib/server/settings";
import { db } from "$lib/server/db";
import { job as jobSchema } from "$lib/server/db/schema";
import { JobStatus, CrawlCommand } from "$lib/types";
// Removed unused Job import
import { eq, desc, sql } from "drizzle-orm";
import type {
  EntityType
} from "../types/index.js";
import type { CompletionData, FailureData, SimpleJob } from "../types/data";

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
      const queuedJobs = await db.query.job.findMany({
        where: eq(jobSchema.status, JobStatus.queued),
        orderBy: [desc(jobSchema.created_at)],
        limit,
        columns: { // Explicitly select columns
          id: true,
          command: true,
          accountId: true,
          full_path: true,
          gitlabGraphQLUrl: true, // Ensure this is selected
          userId: true,
          provider: true,
          resumeState: true,
          // Add other columns as needed
        },
        with: {
          usingAccount: true
        }
      });

      // Exclude discovery jobs (entityType "areas" or command GROUP_PROJECT_DISCOVERY)
      let dbJobs = queuedJobs.filter(job => job.command !== CrawlCommand.GROUP_PROJECT_DISCOVERY);

      logger.debug(`[JobService] Raw dbJobs fetched from database:`, { dbJobs });

      const settings = AppSettings();
      if (settings.app.sendFailedJobsToCrawler) {
        logger.info('📋 Including failed jobs in the job fetch.');
        const remainingLimit = limit - queuedJobs.length;
        if (remainingLimit > 0) {
          const failedJobs = await db.query.job.findMany({
            where: eq(jobSchema.status, JobStatus.failed),
            orderBy: [desc(jobSchema.created_at)],
            limit: remainingLimit,
            columns: { // Explicitly select columns
              id: true,
              command: true,
              accountId: true,
              full_path: true,
              gitlabGraphQLUrl: true, // Ensure this is selected
              userId: true,
              provider: true,
              resumeState: true,
              // Add other columns as needed
            },
            with: {
              usingAccount: true
            }
          });
          dbJobs = [...queuedJobs, ...failedJobs];
        }
      }

      logger.info(`📋 Found ${dbJobs.length} jobs in database`);
      
      // Debug: Log each job's details
      for (const job of dbJobs) {
        logger.info(`🔍 Job ${job.id}:`, {
          command: job.command,
          accountId: job.accountId,
          hasAccount: !!job.usingAccount,
          accountData: job.usingAccount ? {
            id: job.usingAccount.id,
            hasAccessToken: !!job.usingAccount.accessToken
          } : null
        });
      }

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
      
      // Debug: Log what we're setting
      logger.debug(`🔍 DEBUG: Setting started_at to sql(unixepoch()) for job ${jobId}`);
      
      // Safely prepare progress data
      const progressData = startData && typeof startData === 'object' ? { ...startData } : {};
      progressData.started_by_connection = connectionId;
      progressData.started_at = new Date().toISOString();

      // Use proper Date objects instead of raw SQL
      await db
        .update(jobSchema)
        .set({
          status: JobStatus.running,
          started_at: new Date(),
          progress: progressData
        })
        .where(eq(jobSchema.id, jobId));

      logger.info(`✅ Job ${jobId} marked as started`);
      return true;

    } catch (error) {
      console.error(`❌ DETAILED ERROR - marking job ${jobId} as started:`, error);
      logger.error(`❌ Error marking job ${jobId} as started:`, { error });
      return false;
    }
  }

  /**
   * Update job progress and resume state
   */
  async updateJobProgress(
    jobId: string,
    progressData: any, // Accept any format from message router transformations
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

      // Merge progress data - handle both formats
      const existingProgress = currentJob.progress as any || {};
      const updatedProgress = {
        ...existingProgress,
        // Handle backend format (snake_case)
        entity_type: progressData.entity_type || progressData.entityType,
        total_discovered: progressData.total_discovered || progressData.total || 0,
        total_processed: progressData.total_processed || progressData.processed || 0,
        current_page: progressData.current_page,
        items_per_page: progressData.items_per_page,
        sub_collection: progressData.sub_collection,
        estimated_remaining: progressData.estimated_remaining,
        last_update: new Date().toISOString(),
        updated_by_connection: connectionId,
        // Enhanced progress data
        item_counts: progressData.item_counts || progressData.itemCounts || {},
        processing_rate: progressData.processing_rate || progressData.processingRate,
        estimated_time_remaining: progressData.estimated_time_remaining || progressData.estimatedTimeRemaining
      };

      // Update resume state if provided - handle both formats
      const updatedResumeState = progressData.resumeState || progressData.resume_state
        ? {
            lastEntityId: (progressData.resumeState || progressData.resume_state)?.lastEntityId,
            currentPage: (progressData.resumeState || progressData.resume_state)?.currentPage,
            entityType: (progressData.resumeState || progressData.resume_state)?.entityType,
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
      
      // Debug: Log what we're setting
      logger.debug(`🔍 DEBUG: Setting finished_at to sql(unixepoch()) for job ${jobId}`);
      
      // Safely prepare completion data
      const safeCompletionData = completionData || {};
      const finalProgress = {
        success: safeCompletionData.success || false,
        finalCounts: safeCompletionData.finalCounts || {},
        message: safeCompletionData.message || 'Completed',
        outputFiles: safeCompletionData.outputFiles || [],
        completed_at: new Date().toISOString(),
        completed_by_connection: connectionId
      };

      // Use proper Date objects instead of raw SQL
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
      console.error(`❌ DETAILED ERROR - marking job ${jobId} as completed:`, error);
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
      
      // Debug: Log what we're setting
      logger.debug(`🔍 DEBUG: Setting finished_at to sql(unixepoch()) for failed job ${jobId}`);
      
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

      // Use proper Date objects and build update object safely
      const updateFields: any = {
        status: JobStatus.failed,
        finished_at: new Date(),
        progress: errorProgress
      };
      
      // Only set resumeState if it's not null
      if (resumeState !== null) {
        updateFields.resumeState = resumeState;
      }

      await db
        .update(jobSchema)
        .set(updateFields)
        .where(eq(jobSchema.id, jobId));

      logger.error(`❌ Job ${jobId} marked as failed`);
      return true;

    } catch (error) {
      console.error(`❌ DETAILED ERROR - marking job ${jobId} as failed:`, error);
      logger.error(`❌ Error marking job ${jobId} as failed:`, { error });
      return false;
    }
  }

  /**
   * Get job status and progress
   */
  async getJobStatus(jobId: string): Promise<any | null> {
    return this.getJobById(jobId)
  }
  async getJobById(jobId: string): Promise<any | null> {
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
    logger.debug(`[JobService] Converting dbJob to SimpleJob:`, dbJob);
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

      // Get GitLab URL from job or associated account
      const gitlabUrl = dbJob.gitlabGraphQLUrl || dbJob.usingAccount?.gitlabGraphQLUrl;
      if (!gitlabUrl) {
        logger.warn(`❌ No GitLab URL available for job ${dbJob.id}, skipping`);
        return null;
      }

      // Get access token (this would normally be from account table)
      const accessToken = dbJob.usingAccount.accessToken;
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

      logger.info(`✅ Converted job ${dbJob.id} to SimpleJob:`, {
        id: simpleJob.id,
        entityType: simpleJob.entityType,
        entityId: simpleJob.entityId,
        gitlabUrl: simpleJob.gitlabUrl,
        hasAccessToken: !!simpleJob.accessToken,
        accessTokenLength: simpleJob.accessToken?.length || 0
      });
      return simpleJob;

    } catch (error) {
      logger.error(`❌ Error converting job ${dbJob.id} to SimpleJob:`, { error });
      return null;
    }
  }

  /**
   * Map database CrawlCommand to crawler EntityType
   * FIXED: GROUP_PROJECT_DISCOVERY now maps to 'areas' to trigger proper discovery
   */
  private mapCommandToEntityType(command: CrawlCommand): EntityType | null {
    const mapping: Record<string, EntityType> = {
      [CrawlCommand.GROUP_PROJECT_DISCOVERY]: 'areas',  // FIXED: was 'group', now 'areas'
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

