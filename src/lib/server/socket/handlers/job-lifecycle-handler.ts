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
    if (!message.jobId) {
      throw new Error('Job ID is required for job_started message');
    }

    try {
      console.log(`Job started: ${message.jobId}`, message.data);

      // Update job status to running
      await this.jobRepository.updateJobStatus(
        message.jobId,
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

      await this.progressRepository.saveProgressUpdate(message.jobId, initialProgress);

      // Add milestone for job start
      await this.progressRepository.addProgressMilestone(message.jobId, {
        name: 'Job Started',
        timestamp: new Date(message.timestamp),
        metadata: {
          description: `Started job for ${message.data.entityType || 'unknown'} entity`,
          entity_type: message.data.entityType || 'unknown',
          namespace_path: message.data.entityId || 'unknown'
        }
      });

      // Update connection active jobs
      const metadata = connection.metadata as any;
      metadata.activeJobs = (metadata.activeJobs || 0) + 1;

      console.log(`Job ${message.jobId} started successfully`);

    } catch (error) {
      console.error(`Error handling job_started for ${message.jobId}:`, error);
      
      // Try to mark job as failed if we can't process the start
      try {
        await this.jobRepository.markJobFailed(
          message.jobId,
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
    if (!message.jobId) {
      throw new Error('Job ID is required for job_progress message');
    }

    try {
      console.log(`Job progress update: ${message.jobId}`, {
        stage: message.data.stage,
        entityType: message.data.entityType,
        processed: message.data.processed,
        total: message.data.total
      });

      // Calculate completion percentage from processed/total
      const completionPercentage = message.data.total ? message.data.processed / message.data.total : 0;

      // Convert message progress data to our format
      const progressData: SocketJobProgress = {
        overall_completion: completionPercentage,
        time_elapsed: 0, // Not provided in new schema
        entities: [{
          entity_type: message.data.entityType,
          total_discovered: message.data.total || 0,
          total_processed: message.data.processed,
          current_page: message.data.resumeState?.currentPage || 0,
          items_per_page: 100, // Default value since not provided
          sub_collection: undefined,
          estimated_remaining: (message.data.total || 0) - message.data.processed,
          processing_rate: 0 // Cannot calculate without time data
        }],
        last_update: message.timestamp,
        status: 'running'
      };

      // Save progress update
      await this.progressRepository.saveProgressUpdate(message.jobId, progressData);

      // Update job record with progress
      await this.jobRepository.updateJobProgress(message.jobId, progressData);

      // Check for significant progress milestones
      await this.checkProgressMilestones(message.jobId, completionPercentage, message.timestamp);

      console.log(`Progress updated for job ${message.jobId}: ${(completionPercentage * 100).toFixed(1)}%`);

    } catch (error) {
      console.error(`Error handling job_progress for ${message.jobId}:`, error);
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
    if (!message.jobId) {
      throw new Error('Job ID is required for job_completed message');
    }

    try {
      console.log(`Job completed: ${message.jobId}`, {
        success: message.data.success,
        outputFiles: message.data.outputFiles?.length || 0,
        message: message.data.message
      });

      // Mark job as completed
      await this.jobRepository.markJobCompleted(
        message.jobId,
        message.data.outputFiles || [],
        message.data.message || 'Job completed successfully'
      );

      // Update final progress - convert finalCounts object to entities array
      const entities = Object.entries(message.data.finalCounts).map(([entityType, count]) => ({
        entity_type: entityType,
        total_discovered: count,
        total_processed: count,
        current_page: 0,
        items_per_page: 100,
        sub_collection: undefined,
        estimated_remaining: 0,
        processing_rate: 0 // Cannot calculate without time data
      }));

      const finalProgress: SocketJobProgress = {
        overall_completion: 1.0,
        time_elapsed: 0, // Not provided in new schema
        entities: entities,
        last_update: message.timestamp,
        status: 'completed'
      };

      await this.progressRepository.saveProgressUpdate(message.jobId, finalProgress);

      // Add completion milestone
      await this.progressRepository.addProgressMilestone(message.jobId, {
        name: 'Job Completed',
        timestamp: new Date(message.timestamp),
        metadata: {
          description: message.data.message || 'Job completed successfully',
          output_files: message.data.outputFiles || [],
          final_counts: entities
        }
      });

      // Update connection active jobs count
      const metadata = connection.metadata as any;
      metadata.activeJobs = Math.max(0, (metadata.activeJobs || 1) - 1);

      console.log(`Job ${message.jobId} completed successfully with status: ${message.data.success ? 'success' : 'failure'}`);

    } catch (error) {
      console.error(`Error handling job_completed for ${message.jobId}:`, error);
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
    if (!message.jobId) {
      throw new Error('Job ID is required for job_failed message');
    }

    try {
      console.log(`Job failed: ${message.jobId}`, {
        errorType: message.data.errorType,
        error: message.data.error,
        isRecoverable: message.data.isRecoverable
      });

      // Mark job as failed
      await this.jobRepository.markJobFailed(
        message.jobId,
        `${message.data.errorType || 'Unknown'}: ${message.data.error}`
      );

      // Save partial progress if available
      if (message.data.partialCounts) {
        // Convert partialCounts object to entities array
        const entities = Object.entries(message.data.partialCounts).map(([entityType, count]) => ({
          entity_type: entityType,
          total_discovered: count,
          total_processed: count,
          current_page: message.data.resumeState?.currentPage || 0,
          items_per_page: 100,
          sub_collection: undefined,
          estimated_remaining: 0,
          processing_rate: 0
        }));

        const partialProgress: SocketJobProgress = {
          overall_completion: 0, // Will be calculated from partial results
          time_elapsed: 0, // Not provided in error context
          entities: entities,
          last_update: message.timestamp,
          status: 'failed'
        };

        // Calculate overall completion from partial results
        const totalDiscovered = partialProgress.entities.reduce((sum, e) => sum + e.total_discovered, 0);
        const totalProcessed = partialProgress.entities.reduce((sum, e) => sum + e.total_processed, 0);
        partialProgress.overall_completion = totalDiscovered > 0 ? totalProcessed / totalDiscovered : 0;

        await this.progressRepository.saveProgressUpdate(message.jobId, partialProgress);
      }

      // Add failure milestone
      await this.progressRepository.addProgressMilestone(message.jobId, {
        name: 'Job Failed',
        timestamp: new Date(message.timestamp),
        metadata: {
          description: `${message.data.errorType || 'Error'}: ${message.data.error}`
        }
      });

      // Update connection active jobs count
      const metadata = connection.metadata as any;
      metadata.activeJobs = Math.max(0, (metadata.activeJobs || 1) - 1);

      // Log the failure for monitoring
      this.logJobFailure(message.jobId, {
        error_type: message.data.errorType || 'Unknown',
        error_message: message.data.error,
        is_recoverable: message.data.isRecoverable,
        retry_count: 0,
        stack_trace: undefined,
        request_details: undefined
      });

      console.log(`Job ${message.jobId} failed: ${message.data.error}`);

    } catch (error) {
      console.error(`Error handling job_failed for ${message.jobId}:`, error);
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