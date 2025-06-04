import { eq, desc, gte, lte, and } from 'drizzle-orm';
import type { DatabaseManager } from './database-manager.js';
import type { SocketJobProgress, ProgressMilestone } from '../types/database.js';
import type { ProgressSnapshot } from '../types/progress.js';
import { job } from '$lib/server/db/base-schema';
import { JobStatus } from '$lib/types';

/**
 * Progress data persistence and retrieval
 * 
 * Provides:
 * - Progress data persistence and retrieval
 * - Integration with job progress tracking
 * - Resume state management for interrupted jobs
 * - Progress statistics and reporting
 */
export class ProgressRepository {
  constructor(private dbManager: DatabaseManager) {}

  /**
   * Save progress update for a job
   */
  async saveProgressUpdate(jobId: string, progressData: SocketJobProgress): Promise<void> {
    await this.dbManager.withTransaction(async (db) => {
      await db
        .update(job)
        .set({
          progress: progressData as any,
          updated_at: new Date()
        })
        .where(eq(job.id, jobId));
    });
  }

  /**
   * Get current progress for a job
   */
  async getJobProgress(jobId: string): Promise<SocketJobProgress | null> {
    const db = this.dbManager.getDatabase();
    const [jobRecord] = await db
      .select({
        progress: job.progress
      })
      .from(job)
      .where(eq(job.id, jobId))
      .limit(1);

    if (!jobRecord || !jobRecord.progress) {
      return null;
    }

    return jobRecord.progress as SocketJobProgress;
  }

  /**
   * Save progress snapshot for historical tracking
   */
  async saveProgressSnapshot(jobId: string, snapshot: ProgressSnapshot): Promise<void> {
    // For now, we'll store snapshots in the job progress field
    // In a full implementation, you might want a separate progress_snapshots table
    await this.dbManager.withTransaction(async (db) => {
      const [currentJob] = await db
        .select({
          progress: job.progress
        })
        .from(job)
        .where(eq(job.id, jobId))
        .limit(1);

      const currentProgress = currentJob?.progress as any || {};
      
      // Add snapshot to snapshots array
      const snapshots = currentProgress.snapshots || [];
      snapshots.push(snapshot);

      // Keep only last 50 snapshots to prevent bloat
      if (snapshots.length > 50) {
        snapshots.splice(0, snapshots.length - 50);
      }

      await db
        .update(job)
        .set({
          progress: {
            ...currentProgress,
            snapshots
          },
          updated_at: new Date()
        })
        .where(eq(job.id, jobId));
    });
  }

  /**
   * Get progress snapshots for a job
   */
  async getProgressSnapshots(jobId: string, limit?: number): Promise<ProgressSnapshot[]> {
    const db = this.dbManager.getDatabase();
    const [jobRecord] = await db
      .select({
        progress: job.progress
      })
      .from(job)
      .where(eq(job.id, jobId))
      .limit(1);

    if (!jobRecord || !jobRecord.progress) {
      return [];
    }

    const progressData = jobRecord.progress as any;
    const snapshots = progressData.snapshots || [];

    if (limit && limit > 0) {
      return snapshots.slice(-limit);
    }

    return snapshots;
  }

  /**
   * Add progress milestone
   */
  async addProgressMilestone(jobId: string, milestone: ProgressMilestone): Promise<void> {
    await this.dbManager.withTransaction(async (db) => {
      const [currentJob] = await db
        .select({
          progress: job.progress
        })
        .from(job)
        .where(eq(job.id, jobId))
        .limit(1);

      const currentProgress = currentJob?.progress as any || {};
      const milestones = currentProgress.milestones || [];
      
      milestones.push(milestone);

      await db
        .update(job)
        .set({
          progress: {
            ...currentProgress,
            milestones
          },
          updated_at: new Date()
        })
        .where(eq(job.id, jobId));
    });
  }

  /**
   * Get progress milestones for a job
   */
  async getProgressMilestones(jobId: string): Promise<ProgressMilestone[]> {
    const db = this.dbManager.getDatabase();
    const [jobRecord] = await db
      .select({
        progress: job.progress
      })
      .from(job)
      .where(eq(job.id, jobId))
      .limit(1);

    if (!jobRecord || !jobRecord.progress) {
      return [];
    }

    const progressData = jobRecord.progress as any;
    return progressData.milestones || [];
  }

  /**
   * Update resume state for a job
   */
  async updateResumeState(jobId: string, resumeState: Record<string, any>): Promise<void> {
    await this.dbManager.withTransaction(async (db) => {
      await db
        .update(job)
        .set({
          resumeState: resumeState,
          updated_at: new Date()
        })
        .where(eq(job.id, jobId));
    });
  }

  /**
   * Get resume state for a job
   */
  async getResumeState(jobId: string): Promise<Record<string, any> | null> {
    const db = this.dbManager.getDatabase();
    const [jobRecord] = await db
      .select({
        resumeState: job.resumeState
      })
      .from(job)
      .where(eq(job.id, jobId))
      .limit(1);

    return jobRecord?.resumeState as Record<string, any> || null;
  }

  /**
   * Get progress statistics for multiple jobs
   */
  async getProgressStatistics(jobIds: string[]): Promise<ProgressStatistics> {
    const db = this.dbManager.getDatabase();
    const jobs = await db
      .select({
        id: job.id,
        progress: job.progress,
        status: job.status
      })
      .from(job)
      .where(eq(job.id, jobIds[0] ?? "")); // Simplified for now

    const stats: ProgressStatistics = {
      total_jobs: jobs.length,
      jobs_with_progress: 0,
      average_completion: 0,
      total_items_processed: 0,
      total_items_discovered: 0,
      active_jobs: 0
    };

    let totalCompletion = 0;
    let totalProcessed = 0;
    let totalDiscovered = 0;

    jobs.forEach(j => {
      if (j.progress) {
        stats.jobs_with_progress++;
        const progressData = j.progress as any;
        
        if (progressData.overall_completion) {
          totalCompletion += progressData.overall_completion;
        }

        if (progressData.entities) {
          progressData.entities.forEach((entity: any) => {
            totalProcessed += entity.total_processed || 0;
            totalDiscovered += entity.total_discovered || 0;
          });
        }
      }

      if (j.status === 'running' || j.status === 'queued') {
        stats.active_jobs++;
      }
    });

    stats.average_completion = stats.jobs_with_progress > 0
      ? totalCompletion / stats.jobs_with_progress
      : 0;
    stats.total_items_processed = totalProcessed;
    stats.total_items_discovered = totalDiscovered;

    return stats;
  }

  /**
   * Clean up old progress data
   */
  async cleanupOldProgress(olderThan: Date): Promise<number> {
    return await this.dbManager.withTransaction(async (db) => {
      // Clear progress data for completed jobs older than specified date
      const result = await db
        .update(job)
        .set({
          progress: null
        })
        .where(
          and(
            eq(job.status, JobStatus.finished),
            lte(job.finished_at, olderThan)
          )
        );

      return result.rowsAffected || 0;
    });
  }

  /**
   * Get jobs requiring progress updates (stale progress)
   */
  async getStaleProgressJobs(staleDuration: number): Promise<string[]> {
    const db = this.dbManager.getDatabase();
    const staleTime = new Date(Date.now() - staleDuration);
    
    const jobs = await db
      .select({
        id: job.id
      })
      .from(job)
      .where(
        and(
          eq(job.status, JobStatus.running),
          lte(job.updated_at, staleTime)
        )
      );

    return jobs.map(j => j.id);
  }

  /**
   * Bulk update progress for multiple jobs
   */
  async bulkUpdateProgress(updates: Array<{
    jobId: string;
    progress: SocketJobProgress;
  }>): Promise<void> {
    await this.dbManager.withTransaction(async (db) => {
      for (const update of updates) {
        await db
          .update(job)
          .set({
            progress: update.progress as any,
            updated_at: new Date()
          })
          .where(eq(job.id, update.jobId));
      }
    });
  }

  /**
   * Get recent progress updates
   */
  async getRecentProgressUpdates(since: Date, limit: number = 100): Promise<RecentProgressUpdate[]> {
    const db = this.dbManager.getDatabase();
    const jobs = await db
      .select({
        id: job.id,
        progress: job.progress,
        updated_at: job.updated_at,
        status: job.status
      })
      .from(job)
      .where(gte(job.updated_at, since))
      .orderBy(desc(job.updated_at))
      .limit(limit);

    return jobs
      .filter(j => j.progress)
      .map(j => ({
        jobId: j.id,
        progress: j.progress as SocketJobProgress,
        updatedAt: j.updated_at!,
        status: j.status
      }));
  }
}

// Type definitions
interface ProgressStatistics {
  total_jobs: number;
  jobs_with_progress: number;
  average_completion: number;
  total_items_processed: number;
  total_items_discovered: number;
  active_jobs: number;
}

interface RecentProgressUpdate {
  jobId: string;
  progress: SocketJobProgress;
  updatedAt: Date;
  status: string;
}