import type { JobsDiscoveredMessage, DiscoveredJob } from '../types/messages.js';
import { DiscoveredJobSchema } from '../types/messages.js';
import type { SocketConnection } from '../types/connection.js';
import type { DatabaseManager } from '../persistence/database-manager.js';
import { JobRepository } from '../persistence/job-repository.js';
import { AreaRepository } from '../persistence/area-repository.js';
import { JobStatus, CrawlCommand, TokenProvider, AreaType } from '../../../types.js';
import type { WebAppJobAssignmentData } from '../types/messages.js';
import { createJobId, formatTimestamp } from '../utils/index.js';
import { getLogger } from '$lib/logging';
import { crawlCommandToTaskType } from '@copima/lib-common';

const logger = getLogger(['socket-discovery-handler']);

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

  private mapJobTypeToCrawlCommand(jobType: string): CrawlCommand {
      switch (jobType) {
        case 'crawl_group':
          return CrawlCommand.group;
        case 'crawl_project':
          return CrawlCommand.project;
        case 'discover_areas':
          return CrawlCommand.GROUP_PROJECT_DISCOVERY;
        case 'crawl_user':
          return CrawlCommand.users;
        case 'groupMilestones':
          return CrawlCommand.groupMilestones;
        case 'epics':
          return CrawlCommand.epics;
        case 'jobs':
          return CrawlCommand.jobs;
        case 'mergeRequestNotes':
          return CrawlCommand.mergeRequestNotes;
        // Add other mappings as needed
        default:
          logger.warn(`Unknown job type received: ${jobType}. Defaulting to GROUP_PROJECT_DISCOVERY.`);
          return CrawlCommand.GROUP_PROJECT_DISCOVERY;
      }
    }

  /**
   * Handle jobs discovered message from crawler
   */
  async handleJobsDiscovered(
    connection: SocketConnection,
    message: JobsDiscoveredMessage
  ): Promise<void> {
    logger.info(`[DEBUG] handleJobsDiscovered called. Raw message:`, { message });
    logger.debug(`handleJobsDiscovered: Raw message received:`, message);
    try {
      logger.info(`Processing jobs discovered from ${message.jobId}:`, {
        discoveredJobs: message.data.discovered_jobs.length,
        summary: message.data.discovery_summary
      });
    logger.debug(`DiscoveryHandler: Raw discoveredJobs received: ${JSON.stringify(message.data.discovered_jobs)}`);

      // Strict Zod validation for discovered jobs
      const validatedDiscoveredJobs = message.data.discovered_jobs
        .map((job, idx) => {
          const result = DiscoveredJobSchema.safeParse(job);
          if (!result.success) {
            logger.warn(
              `Dropped invalid discovered job at index ${idx}: ${JSON.stringify(job)}. Reason: ${result.error.message}`
            );
            return undefined;
          }
          return result.data;
        })
        .filter(Boolean);

      if (validatedDiscoveredJobs.length !== message.data.discovered_jobs.length) {
        logger.warn(
          `Filtered out ${message.data.discovered_jobs.length - validatedDiscoveredJobs.length} invalid discovered jobs from ${message.jobId}`
        );
      }

      // Process discovered areas first
      await this.processDiscoveredAreas(validatedDiscoveredJobs, message.jobId);

      // Create jobs for discovered entities
      const createdJobs = await this.createDiscoveredJobs(
        validatedDiscoveredJobs,
        message.jobId
      );

      // Automatically create jobs for all required data types for each discovered area
      const areaJobs = await this.createAreaDataTypeJobs(
        validatedDiscoveredJobs,
        message.jobId
      );

      // Combine all created jobs
      const allCreatedJobs = [...createdJobs, ...areaJobs];

      // Update discovery job with results
      await this.updateDiscoveryJobResults(message.jobId, message.data, allCreatedJobs);

      // Queue high-priority jobs for immediate assignment
      await this.queueHighPriorityJobs(allCreatedJobs);

      logger.info(`Successfully processed ${createdJobs.length} discovered jobs from ${message.jobId}`);

    } catch (error) {
      logger.error(`Error handling jobs_discovered for ${message.jobId}: ${error instanceof Error ? error.message : String(error)}`, { error });
      
      // Log error to job progress if possible
      try {
        await this.jobRepository.markJobFailed(
          message.jobId,
          `Failed to process discovered jobs: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      } catch (failError) {
        logger.error(`Failed to mark discovery job as failed: ${failError instanceof Error ? failError.message : String(failError)}`, { failError });
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
    logger.info(`Raw discoveredJobs received: ${JSON.stringify(discoveredJobs)}`);
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
      logger.info(`Attempting to bulk upsert ${areasToProcess.length} areas for discovery job ${parentJobId}. Data: ${JSON.stringify(areasToProcess)}`);
      const createdAreas = await this.areaRepository.bulkUpsertAreas(areasToProcess);
      logger.info(`Processed ${createdAreas.length} areas from discovery job ${parentJobId}`);
      
      // Create area authorizations for the account
      const parentJob = await this.jobRepository.getJob(parentJobId);
      if (parentJob?.accountId) {
        for (const area of createdAreas) {
          await this.areaRepository.createAreaAuthorization(parentJob.accountId, area.full_path);
        }
      }
    } catch (error) {
      logger.error(`Error processing discovered areas: ${error instanceof Error ? error.message : String(error)}`, { error });
      throw error;
    }
  }

  /**
   * Create new Job records in database for discovered entities
   */
  private async createDiscoveredJobs(
    discoveredJobs: DiscoveredJob[],
    parentJobId: string
  ): Promise<import('../types/database.js').Job[]> {
    const createdJobs: import('../types/database.js').Job[] = [];
    const parentJob = await this.jobRepository.getJob(parentJobId);

    if (!parentJob) {
      logger.error(`Parent job ${parentJobId} not found. Cannot create discovered jobs.`);
      return [];
    }

    for (const discoveredJob of discoveredJobs) {
      logger.info(`[DEBUG] Processing discovered job:`, { job_type: discoveredJob.job_type, entity_id: discoveredJob.entity_id, namespace_path: discoveredJob.namespace_path });
      try {
        const command = this.mapJobTypeToCrawlCommand(discoveredJob.job_type);
        logger.info(`[DEBUG] Mapped job_type "${discoveredJob.job_type}" to command "${command}"`);
        const newJob = await this.jobRepository.createJob({
          id: createJobId(),
          command: command,
          status: JobStatus.queued,
          accountId: parentJob.accountId,
          userId: parentJob.userId,
          provider: parentJob.provider,
          gitlabGraphQLUrl: parentJob.gitlabGraphQLUrl,
          full_path: discoveredJob.namespace_path,
          progress: {
            discovered_from: parentJobId,
            entity_name: discoveredJob.entity_name,
            estimated_size: discoveredJob.estimated_size,
            discovery_timestamp: formatTimestamp(),
          },
        });
        createdJobs.push(newJob);
      } catch (error) {
        logger.error(`Error creating job for discovered entity ${discoveredJob.entity_id}: ${error instanceof Error ? error.message : String(error)}`, { error });
      }
    }
    return createdJobs;
  }

  /**
   * For each discovered area, create jobs for all required data types (branches, commits, issues, etc.)
   */
  private async createAreaDataTypeJobs(
    discoveredJobs: DiscoveredJob[],
    parentJobId: string
  ): Promise<import('../types/database.js').Job[]> {
    const createdJobs: import('../types/database.js').Job[] = [];
    const parentJob = await this.jobRepository.getJob(parentJobId);

    if (!parentJob) {
      logger.error(`Parent job ${parentJobId} not found. Cannot create area data type jobs.`);
      return [];
    }

    // Only include commands supported by both the backend (CrawlCommand) and the crawler (GitLabTaskType).
    // See: copilot-study/src/lib/types.ts and crawlz/src/types/gitlab-task-unified.ts
    // This avoids spawning jobs that will be skipped as "Unknown command" by the backend or not handled by the crawler.
    const dataTypesToCrawl: CrawlCommand[] = [
      CrawlCommand.issues,            // FETCH_ISSUES
      CrawlCommand.mergeRequests,     // FETCH_MERGE_REQUESTS
      CrawlCommand.commits,           // FETCH_COMMITS
      CrawlCommand.branches,          // FETCH_BRANCHES
      CrawlCommand.pipelines,         // FETCH_PIPELINES
      // Only include commands supported by both enums and implemented in backend/crawler logic.
      CrawlCommand.groupMilestones,   // FETCH_MILESTONES (for groups)
      CrawlCommand.epics,             // FETCH_EPICS (for groups)
      CrawlCommand.jobs,              // FETCH_JOBS (for projects/pipelines)
      CrawlCommand.mergeRequestNotes, // FETCH_ISSUE_NOTES (closest match)
      CrawlCommand.issues,            // FETCH_ISSUES
      CrawlCommand.mergeRequests,     // FETCH_MERGE_REQUESTS
      CrawlCommand.commits,           // FETCH_COMMITS
      CrawlCommand.branches,          // FETCH_BRANCHES
      CrawlCommand.pipelines,         // FETCH_PIPELINES
      // CrawlCommand.releases,       // Not in CrawlCommand, skip for now
      // CrawlCommand.events,         // Not in CrawlCommand, skip for now
      // Add more only if both enums and backend/crawler logic support them.
    ];

    for (const discoveredJob of discoveredJobs) {
      // Only create data type jobs for projects and groups
      if (discoveredJob.job_type === 'crawl_project' || discoveredJob.job_type === 'crawl_group') {
        for (const command of dataTypesToCrawl) {
          const newJob = await this.jobRepository.createJob({
            id: createJobId(),
            command: command,
            status: JobStatus.queued,
            accountId: parentJob.accountId,
            userId: parentJob.userId,
            provider: parentJob.provider,
            gitlabGraphQLUrl: parentJob.gitlabGraphQLUrl,
            full_path: discoveredJob.namespace_path,
            progress: {
              discovered_from: parentJobId,
              entity_name: discoveredJob.entity_name,
              estimated_size: discoveredJob.estimated_size,
              discovery_timestamp: formatTimestamp(),
            },
          });
          createdJobs.push(newJob);
        }
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
      logger.error(`Error updating discovery job results: ${error instanceof Error ? error.message : String(error)}`, { error });
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
        
        logger.info(`Queued high-priority job: ${job.id} (${job.command})`);
      } catch (error) {
        logger.error(`Error queueing high-priority job ${job.id}: ${error instanceof Error ? error.message : String(error)}`, { error });
      }
    }

    logger.info(`Queued ${highPriorityJobs.length} high-priority jobs for assignment`);
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
      logger.error(`Error getting discovery statistics: ${error instanceof Error ? error.message : String(error)}`, { error });
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