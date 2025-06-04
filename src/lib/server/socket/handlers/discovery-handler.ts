import type { JobsDiscoveredMessage, DiscoveredJob } from '../types/messages.js';
import type { SocketConnection } from '../types/connection.js';
import type { DatabaseManager } from '../persistence/database-manager.js';
import { JobRepository } from '../persistence/job-repository.js';
import { AreaRepository } from '../persistence/area-repository.js';
import { JobStatus, CrawlCommand, TokenProvider, AreaType } from '../../../types.js';
import type { WebAppJobAssignmentData } from '../types/messages.js';
import { createJobId, formatTimestamp } from '../utils/index.js';

/**
 * Process jobs_discovered messages from crawler
 * 
 * Handles:
 * - Process jobs_discovered messages from crawler
 * - Create new Job records in database for discovered entities
 * - Integrate with Area table for namespace management
 * - Handle job priority assignment and queue management
 * - Coordinate with existing job lifecycle for discovered jobs
 */
export class DiscoveryHandler {
  private jobRepository: JobRepository;
  private areaRepository: AreaRepository;

  constructor(private dbManager: DatabaseManager) {
    this.jobRepository = new JobRepository(dbManager);
    this.areaRepository = new AreaRepository(dbManager);
  }

  /**
   * Handle jobs discovered message from crawler
   */
  async handleJobsDiscovered(
    connection: SocketConnection,
    message: JobsDiscoveredMessage
  ): Promise<void> {
    try {
      console.log(`Processing jobs discovered from ${message.job_id}:`, {
        discoveredJobs: message.data.discovered_jobs.length,
        summary: message.data.discovery_summary
      });

      // Process discovered areas first
      await this.processDiscoveredAreas(message.data.discovered_jobs, message.job_id);

      // Create jobs for discovered entities
      const createdJobs = await this.createDiscoveredJobs(
        message.data.discovered_jobs,
        message.job_id
      );

      // Update discovery job with results
      await this.updateDiscoveryJobResults(message.job_id, message.data, createdJobs);

      // Queue high-priority jobs for immediate assignment
      await this.queueHighPriorityJobs(createdJobs);

      console.log(`Successfully processed ${createdJobs.length} discovered jobs from ${message.job_id}`);

    } catch (error) {
      console.error(`Error handling jobs_discovered for ${message.job_id}:`, error);
      
      // Log error to job progress if possible
      try {
        await this.jobRepository.markJobFailed(
          message.job_id,
          `Failed to process discovered jobs: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      } catch (failError) {
        console.error(`Failed to mark discovery job as failed:`, failError);
      }
      
      throw error;
    }
  }

  /**
   * Process discovered areas and create/update them in database
   */
  private async processDiscoveredAreas(
    discoveredJobs: DiscoveredJob[],
    parentJobId: string
  ): Promise<void> {
    const areasToProcess = discoveredJobs
      .filter(job => job.namespace_path && job.entity_id)
      .map(job => ({
        fullPath: job.namespace_path,
        gitlabId: job.entity_id,
        name: job.entity_name,
        type: this.determineAreaType(job.job_type)
      }));

    if (areasToProcess.length === 0) {
      return;
    }

    try {
      const createdAreas = await this.areaRepository.bulkUpsertAreas(areasToProcess);
      console.log(`Processed ${createdAreas.length} areas from discovery job ${parentJobId}`);
      
      // Create area authorizations for the account
      const parentJob = await this.jobRepository.getJob(parentJobId);
      if (parentJob?.accountId) {
        for (const area of createdAreas) {
          await this.areaRepository.createAreaAuthorization(parentJob.accountId, area.full_path);
        }
      }
    } catch (error) {
      console.error(`Error processing discovered areas:`, error);
      throw error;
    }
  }

  /**
   * Create job records for discovered entities
   */
  private async createDiscoveredJobs(
    discoveredJobs: DiscoveredJob[],
    parentJobId: string
  ): Promise<import('../types/database.js').Job[]> {
    const parentJob = await this.jobRepository.getJob(parentJobId);
    if (!parentJob) {
      throw new Error(`Parent discovery job not found: ${parentJobId}`);
    }

    const createdJobs: import('../types/database.js').Job[] = [];

    for (const discoveredJob of discoveredJobs) {
      try {
        const jobAssignment = this.createJobAssignment(discoveredJob, parentJob);
        const createdJob = await this.jobRepository.createJobFromAssignment(jobAssignment);
        createdJobs.push(createdJob);

        console.log(`Created job ${createdJob.id} for ${discoveredJob.namespace_path} (${discoveredJob.job_type})`);
      } catch (error) {
        console.error(`Error creating job for ${discoveredJob.namespace_path}:`, error);
        // Continue with other jobs even if one fails
      }
    }

    return createdJobs;
  }

  /**
   * Create job assignment data from discovered job
   */
  private createJobAssignment(
    discoveredJob: DiscoveredJob,
    parentJob: import('../types/database.js').Job
  ): WebAppJobAssignmentData {
    const webAppJobId = createJobId();
    
    return {
      job_id: `crawler_${discoveredJob.job_type}_${discoveredJob.entity_id}`,
      job_type: discoveredJob.job_type,
      entity_id: discoveredJob.entity_id,
      namespace_path: discoveredJob.namespace_path,
      gitlab_host: parentJob.gitlabGraphQLUrl || 'https://gitlab.com',
      access_token: 'placeholder_token', // Will be refreshed when assigned
      priority: discoveredJob.priority,
      resume: false,
      
      // Web app specific fields
      account_id: parentJob.accountId,
      user_id: parentJob.userId || undefined,
      provider: parentJob.provider === TokenProvider.gitlabCloud ? 'gitlab-cloud' : 'gitlab-onprem',
      web_app_job_id: webAppJobId,
      created_by_user_id: parentJob.userId || undefined,
      tags: [`discovered-from:${parentJob.id}`, `entity-type:${discoveredJob.job_type}`],
      metadata: {
        discovered_from: parentJob.id,
        entity_name: discoveredJob.entity_name,
        estimated_size: discoveredJob.estimated_size,
        discovery_timestamp: formatTimestamp()
      }
    };
  }

  /**
   * Update discovery job with results
   */
  private async updateDiscoveryJobResults(
    jobId: string,
    discoveryData: any,
    createdJobs: import('../types/database.js').Job[]
  ): Promise<void> {
    try {
      // Update job progress with discovery results
      const discoveryProgress = {
        overall_completion: 1.0,
        time_elapsed: 0, // Will be calculated from job timestamps
        entities: [
          {
            id: 'discovery-results',
            entity_type: 'discovery',
            total_discovered: createdJobs.length,
            total_processed: createdJobs.length,
            completion_percentage: 100,
            status: 'completed' as const,
            processing_rate: 0
          }
        ],
        last_update: formatTimestamp(),
        status: 'completed' as const,
        milestones: [
          {
            name: 'Discovery Completed',
            completed_at: formatTimestamp(),
            duration: 0,
            items_processed: createdJobs.length,
            timestamp: new Date(),
            metadata: {}
          }
        ]
      };

      await this.jobRepository.updateJobProgress(jobId, discoveryProgress);

      // Update job metadata with discovery summary
      const job = await this.jobRepository.getJob(jobId);
      if (job) {
        const updatedProgress = {
          ...discoveryProgress,
          discovery_summary: discoveryData.discovery_summary,
          created_jobs: createdJobs.map(j => ({
            id: j.id,
            command: j.command,
            full_path: j.full_path,
            priority: 1 // Default priority for now
          }))
        };

        await this.jobRepository.updateJobProgress(jobId, updatedProgress);
      }

    } catch (error) {
      console.error(`Error updating discovery job results:`, error);
      // Don't throw - discovery was successful even if metadata update failed
    }
  }

  /**
   * Queue high-priority jobs for immediate assignment
   */
  private async queueHighPriorityJobs(
    createdJobs: import('../types/database.js').Job[]
  ): Promise<void> {
    // Sort by priority and command type
    const sortedJobs = createdJobs
      .filter(job => job.status === JobStatus.queued)
      .sort((a, b) => {
        // Prioritize certain command types
        const priorityOrder: Record<string, number> = {
          [CrawlCommand.users]: 1,
          [CrawlCommand.group]: 2,
          [CrawlCommand.project]: 3,
          [CrawlCommand.authorizationScope]: 4
        };
        
        const aPriority = priorityOrder[a.command] || 5;
        const bPriority = priorityOrder[b.command] || 5;
        
        return aPriority - bPriority;
      });

    // Mark top priority jobs for immediate processing
    const highPriorityJobs = sortedJobs.slice(0, 3); // Top 3 jobs
    
    for (const job of highPriorityJobs) {
      try {
        // Update job metadata to indicate high priority
        await this.jobRepository.updateJobStatus(job.id, JobStatus.queued, {
          // Could add priority metadata here if we had that field
        });
        
        console.log(`Queued high-priority job: ${job.id} (${job.command})`);
      } catch (error) {
        console.error(`Error queueing high-priority job ${job.id}:`, error);
      }
    }

    console.log(`Queued ${highPriorityJobs.length} high-priority jobs for assignment`);
  }

  /**
   * Determine area type from job type
   */
  private determineAreaType(jobType: string): AreaType {
    switch (jobType) {
      case 'crawl_group':
      case 'discover_namespaces':
        return AreaType.group;
      case 'crawl_project':
        return AreaType.project;
      case 'crawl_user':
        return AreaType.group; // Users are typically at group level
      default:
        return AreaType.project; // Default to project
    }
  }

  /**
   * Get discovery statistics for monitoring
   */
  async getDiscoveryStatistics(accountId?: string): Promise<DiscoveryStatistics> {
    try {
      const discoveryJobs = await this.jobRepository.getJobsByAccountAndCommand(
        accountId || '',
        CrawlCommand.GROUP_PROJECT_DISCOVERY
      );

      const stats: DiscoveryStatistics = {
        total_discovery_jobs: discoveryJobs.length,
        completed_discoveries: discoveryJobs.filter(j => j.status === JobStatus.finished).length,
        failed_discoveries: discoveryJobs.filter(j => j.status === JobStatus.failed).length,
        running_discoveries: discoveryJobs.filter(j => j.status === JobStatus.running).length,
        total_jobs_discovered: 0,
        areas_created: 0
      };

      // Calculate jobs discovered from completed discovery jobs
      for (const job of discoveryJobs) {
        if (job.progress && job.progress.created_jobs) {
          stats.total_jobs_discovered += job.progress.created_jobs.length || 0;
        }
      }

      // Get area statistics
      if (accountId) {
        const areas = await this.areaRepository.getAreasByAccount(accountId);
        stats.areas_created = areas.length;
      } else {
        const areaStats = await this.areaRepository.getAreaStatistics();
        stats.areas_created = areaStats.total;
      }

      return stats;
    } catch (error) {
      console.error('Error getting discovery statistics:', error);
      return {
        total_discovery_jobs: 0,
        completed_discoveries: 0,
        failed_discoveries: 0,
        running_discoveries: 0,
        total_jobs_discovered: 0,
        areas_created: 0
      };
    }
  }
}

// Type definitions
interface DiscoveryStatistics {
  total_discovery_jobs: number;
  completed_discoveries: number;
  failed_discoveries: number;
  running_discoveries: number;
  total_jobs_discovered: number;
  areas_created: number;
}