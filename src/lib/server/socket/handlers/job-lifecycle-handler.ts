import type { 
  JobStartedMessage, 
  JobProgressMessage, 
  JobCompletedMessage, 
  JobFailedMessage 
} from '../types/messages.js';
import type { SocketConnection } from '../types/connection.js';
import type { DatabaseManager } from '../persistence/database-manager.js';
import { JobRepository } from '../persistence/job-repository.js';
import { ProgressRepository } from '../persistence/progress-repository.js';
import { JobStatus } from '../../../types.js';
import type { SocketJobProgress } from '../types/database.js';

/**
 * Handle job lifecycle messages
 * 
 * Handles:
 * - job_started, job_progress, job_completed, and job_failed messages
 * - Update job status in database using the existing Job schema
 * - Process progress data and update job progress field
 * - Handle error conditions and failure scenarios with proper logging
 */
export class JobLifecycleHandler {
  private jobRepository: JobRepository;
  private progressRepository: ProgressRepository;

  constructor(private dbManager: DatabaseManager) {
    this.jobRepository = new JobRepository(dbManager);
    this.progressRepository = new ProgressRepository(dbManager);
  }

  /**
   * Handle job started message
   */
  async handleJobStarted(
    connection: SocketConnection,
    message: JobStartedMessage
  ): Promise<void> {
    if (!message.job_id) {
      throw new Error('Job ID is required for job_started message');
    }

    try {
      console.log(`Job started: ${message.job_id}`, message.data);

      // Update job status to running
      await this.jobRepository.updateJobStatus(
        message.job_id,
        JobStatus.running,
        {
          startedAt: new Date(message.timestamp)
        }
      );

      // Initialize progress tracking
      const initialProgress: SocketJobProgress = {
        overall_completion: 0,
        time_elapsed: 0,
        entities: [],
        last_update: message.timestamp,
        status: 'running'
      };

      if (message.data.estimated_duration) {
        initialProgress.estimated_time_remaining = message.data.estimated_duration;
      }

      await this.progressRepository.saveProgressUpdate(message.job_id, initialProgress);

      // Add milestone for job start
      await this.progressRepository.addProgressMilestone(message.job_id, {
        name: 'Job Started',
        timestamp: new Date(message.timestamp),
        metadata: {
          description: `Started ${message.data.job_type} for ${message.data.namespace_path || 'unknown'}`,
          job_type: message.data.job_type,
          entity_type: message.data.entity_type,
          namespace_path: message.data.namespace_path
        }
      });

      // Update connection active jobs
      const metadata = connection.metadata as any;
      metadata.activeJobs = (metadata.activeJobs || 0) + 1;

      console.log(`Job ${message.job_id} started successfully`);

    } catch (error) {
      console.error(`Error handling job_started for ${message.job_id}:`, error);
      
      // Try to mark job as failed if we can't process the start
      try {
        await this.jobRepository.markJobFailed(
          message.job_id,
          `Failed to process job start: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      } catch (failError) {
        console.error(`Failed to mark job as failed:`, failError);
      }
      
      throw error;
    }
  }

  /**
   * Handle job progress message
   */
  async handleJobProgress(
    connection: SocketConnection,
    message: JobProgressMessage
  ): Promise<void> {
    if (!message.job_id) {
      throw new Error('Job ID is required for job_progress message');
    }

    try {
      console.log(`Job progress update: ${message.job_id}`, {
        completion: message.data.overall_completion,
        timeElapsed: message.data.time_elapsed,
        entities: message.data.progress.length
      });

      // Convert message progress data to our format
      const progressData: SocketJobProgress = {
        overall_completion: message.data.overall_completion,
        time_elapsed: message.data.time_elapsed,
        estimated_time_remaining: message.data.estimated_time_remaining,
        entities: message.data.progress.map((entity, index) => ({
          id: `entity-${index}`,
          entity_type: entity.entity_type,
          total_discovered: entity.total_discovered,
          total_processed: entity.total_processed,
          current_page: entity.current_page,
          items_per_page: entity.items_per_page,
          sub_collection: entity.sub_collection,
          estimated_remaining: entity.estimated_remaining,
          completion_percentage: entity.total_discovered > 0 
            ? (entity.total_processed / entity.total_discovered) * 100 
            : 0,
          status: entity.total_processed === entity.total_discovered ? 'completed' : 'active',
          processing_rate: entity.total_processed / (message.data.time_elapsed / 1000) || 0
        })),
        last_update: message.timestamp,
        status: 'running'
      };

      // Save progress update
      await this.progressRepository.saveProgressUpdate(message.job_id, progressData);

      // Update job record with progress
      await this.jobRepository.updateJobProgress(message.job_id, progressData);

      // Check for significant progress milestones
      await this.checkProgressMilestones(message.job_id, message.data.overall_completion, message.timestamp);

      console.log(`Progress updated for job ${message.job_id}: ${(message.data.overall_completion * 100).toFixed(1)}%`);

    } catch (error) {
      console.error(`Error handling job_progress for ${message.job_id}:`, error);
      throw error;
    }
  }

  /**
   * Handle job completed message
   */
  async handleJobCompleted(
    connection: SocketConnection,
    message: JobCompletedMessage
  ): Promise<void> {
    if (!message.job_id) {
      throw new Error('Job ID is required for job_completed message');
    }

    try {
      console.log(`Job completed: ${message.job_id}`, {
        duration: message.data.total_duration,
        outputFiles: message.data.output_files.length,
        summary: message.data.summary
      });

      // Mark job as completed
      await this.jobRepository.markJobCompleted(
        message.job_id,
        message.data.output_files,
        message.data.summary
      );

      // Update final progress
      const finalProgress: SocketJobProgress = {
        overall_completion: 1.0,
        time_elapsed: message.data.total_duration,
        entities: message.data.final_counts.map((entity, index) => ({
          id: `entity-${index}`,
          entity_type: entity.entity_type,
          total_discovered: entity.total_discovered,
          total_processed: entity.total_processed,
          current_page: entity.current_page,
          items_per_page: entity.items_per_page,
          sub_collection: entity.sub_collection,
          estimated_remaining: 0,
          completion_percentage: 100,
          status: 'completed' as const,
          processing_rate: entity.total_processed / (message.data.total_duration / 1000) || 0
        })),
        last_update: message.timestamp,
        status: 'completed'
      };

      await this.progressRepository.saveProgressUpdate(message.job_id, finalProgress);

      // Add completion milestone
      await this.progressRepository.addProgressMilestone(message.job_id, {
        name: 'Job Completed',
        timestamp: new Date(message.timestamp),
        metadata: {
          job_type: message.data.job_type,
          description: message.data.summary || 'Job completed successfully',
          total_duration: message.data.total_duration,
          output_files: message.data.output_files,
          final_counts: message.data.final_counts
        }
      });

      // Update connection active jobs count
      const metadata = connection.metadata as any;
      metadata.activeJobs = Math.max(0, (metadata.activeJobs || 1) - 1);

      console.log(`Job ${message.job_id} completed successfully in ${message.data.total_duration}ms`);

    } catch (error) {
      console.error(`Error handling job_completed for ${message.job_id}:`, error);
      throw error;
    }
  }

  /**
   * Handle job failed message
   */
  async handleJobFailed(
    connection: SocketConnection,
    message: JobFailedMessage
  ): Promise<void> {
    if (!message.job_id) {
      throw new Error('Job ID is required for job_failed message');
    }

    try {
      console.log(`Job failed: ${message.job_id}`, {
        errorType: message.data.error_context.error_type,
        errorMessage: message.data.error_context.error_message,
        isRecoverable: message.data.error_context.is_recoverable
      });

      // Mark job as failed
      await this.jobRepository.markJobFailed(
        message.job_id,
        `${message.data.error_context.error_type}: ${message.data.error_context.error_message}`
      );

      // Save partial progress if available
      if (message.data.partial_results) {
        const partialProgress: SocketJobProgress = {
          overall_completion: 0, // Will be calculated from partial results
          time_elapsed: 0, // Not provided in error context
          entities: message.data.partial_results.map((entity, index) => ({
            id: `entity-${index}`,
            entity_type: entity.entity_type,
            total_discovered: entity.total_discovered,
            total_processed: entity.total_processed,
            current_page: entity.current_page,
            items_per_page: entity.items_per_page,
            sub_collection: entity.sub_collection,
            estimated_remaining: entity.estimated_remaining,
            completion_percentage: entity.total_discovered > 0 
              ? (entity.total_processed / entity.total_discovered) * 100 
              : 0,
            status: 'failed' as const,
            error_count: 1
          })),
          last_update: message.timestamp,
          status: 'failed'
        };

        // Calculate overall completion from partial results
        const totalDiscovered = partialProgress.entities.reduce((sum, e) => sum + e.total_discovered, 0);
        const totalProcessed = partialProgress.entities.reduce((sum, e) => sum + e.total_processed, 0);
        partialProgress.overall_completion = totalDiscovered > 0 ? totalProcessed / totalDiscovered : 0;

        await this.progressRepository.saveProgressUpdate(message.job_id, partialProgress);
      }

      // Add failure milestone
      await this.progressRepository.addProgressMilestone(message.job_id, {
        name: 'Job Failed',
        timestamp: new Date(message.timestamp),
        metadata: {
          job_type: message.data.job_type,
          description: `${message.data.error_context.error_type}: ${message.data.error_context.error_message}`,
          error_context: message.data.error_context,
          recovery_suggestion: message.data.recovery_suggestion,
          is_recoverable: message.data.error_context.is_recoverable
        }
      });

      // Update connection active jobs count
      const metadata = connection.metadata as any;
      metadata.activeJobs = Math.max(0, (metadata.activeJobs || 1) - 1);

      // Log the failure for monitoring
      this.logJobFailure(message.job_id, message.data.error_context);

      console.log(`Job ${message.job_id} failed: ${message.data.error_context.error_message}`);

    } catch (error) {
      console.error(`Error handling job_failed for ${message.job_id}:`, error);
      throw error;
    }
  }

  /**
   * Check for significant progress milestones
   */
  private async checkProgressMilestones(
    jobId: string,
    completion: number,
    timestamp: string
  ): Promise<void> {
    const milestoneThresholds = [0.25, 0.5, 0.75, 0.9];
    
    // Get existing milestones to avoid duplicates
    const existingMilestones = await this.progressRepository.getProgressMilestones(jobId);
    const existingThresholds = existingMilestones
      .filter(m => m.name.startsWith('Progress:'))
      .map(() => 0); // Simplified for now, would need proper milestone tracking

    for (const threshold of milestoneThresholds) {
      if (completion >= threshold && !existingThresholds.includes(threshold)) {
        await this.progressRepository.addProgressMilestone(jobId, {
          name: `Progress: ${threshold * 100}%`,
          timestamp: new Date(timestamp),
          metadata: {
            description: `Reached ${threshold * 100}% completion`,
            completion_percentage: Math.round(threshold * 100),
            threshold: threshold
          }
        });
      }
    }
  }

  /**
   * Log job failure for monitoring and debugging
   */
  private logJobFailure(jobId: string, errorContext: any): void {
    const failureLog = {
      jobId,
      timestamp: new Date().toISOString(),
      errorType: errorContext.error_type,
      errorMessage: errorContext.error_message,
      isRecoverable: errorContext.is_recoverable,
      retryCount: errorContext.retry_count,
      stackTrace: errorContext.stack_trace,
      requestDetails: errorContext.request_details
    };

    // In production, this might go to a logging service
    console.error('Job failure logged:', failureLog);
  }

  /**
   * Get job lifecycle statistics
   */
  async getJobLifecycleStatistics(accountId?: string): Promise<JobLifecycleStatistics> {
    const stats = await this.jobRepository.getJobStatistics(accountId || '');
    
    return {
      total_jobs: stats.total,
      active_jobs: stats.queued + stats.running,
      completed_jobs: stats.completed,
      failed_jobs: stats.failed,
      paused_jobs: stats.paused,
      success_rate: stats.total > 0 ? (stats.completed / stats.total) * 100 : 0,
      failure_rate: stats.total > 0 ? (stats.failed / stats.total) * 100 : 0,
      by_command: stats.by_command
    };
  }
}

// Type definitions
interface JobLifecycleStatistics {
  total_jobs: number;
  active_jobs: number;
  completed_jobs: number;
  failed_jobs: number;
  paused_jobs: number;
  success_rate: number;
  failure_rate: number;
  by_command: Record<string, number>;
}