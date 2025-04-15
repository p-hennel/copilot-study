/**
 * Extension of GitLabCrawler that integrates with SupervisorClient for IPC job planning
 * 
 * This file extends the original GitLabCrawler to use the SupervisorClient
 * for inter-process communication to plan jobs instead of creating them directly.
 */

import { getLogger } from "@logtape/logtape";
import { SupervisorClient } from "../subvisor/client";
import { CrawlerSupervisorClient } from "./client/supervisor-client";
import { EventType, type JobCompletedEvent } from "./events/event-types";
import { GitLabCrawler } from "./gitlab-crawler";
import { type CrawlerConfig } from "./types/config-types";
import { type Job, JobType } from "./types/job-types";

// Initialize logger
const logger = getLogger(["crawlib-ipc"]);

/**
 * Extended GitLab crawler with IPC-based job planning
 */
export class GitLabCrawlerWithIPC extends GitLabCrawler {
  private supervisorClient: SupervisorClient;
  private crawlerSupervisorClient: CrawlerSupervisorClient;

  /**
   * Create a new GitLab crawler with IPC job planning
   *
   * @param config - Crawler configuration
   * @param supervisorClient - SupervisorClient instance for IPC
   */
  constructor(config: CrawlerConfig, supervisorClient: SupervisorClient) {
    // Initialize the base GitLabCrawler
    super(config);

    // Set supervisor client
    this.supervisorClient = supervisorClient;
    
    // Create crawler-specific wrapper
    this.crawlerSupervisorClient = new CrawlerSupervisorClient(this.supervisorClient);

    // Add event listeners to intercept job completed events and handle discovered jobs via IPC
    this.on(EventType.JOB_COMPLETED, (event) => {
      if (event.type === EventType.JOB_COMPLETED) {
        const completedEvent = event as JobCompletedEvent;
        
        // If the job discovered new resources, report them to the supervisor
        if (completedEvent.discoveredJobs && completedEvent.discoveredJobs.length > 0) {
          logger.info(`Reporting ${completedEvent.discoveredJobs.length} discovered jobs via IPC`);
          this.crawlerSupervisorClient.reportDiscoveredJobs(completedEvent.discoveredJobs);
        }
      }
    });
  }

  /**
   * Create and immediately report a job
   * 
   * @param type - The job type
   * @param resourceId - Resource identifier (e.g., group ID, project ID)
   * @param resourcePath - Resource path (e.g., full_path for groups/projects)
   * @param data - Additional data needed for job execution
   */
  reportJob(
    type: JobType,
    resourceId: string | number,
    resourcePath?: string,
    data?: Record<string, any>
  ): Job {
    // Create and report job via IPC
    return this.crawlerSupervisorClient.createAndReportJob(
      type,
      resourceId,
      resourcePath,
      undefined, // No parent job ID
      data
    );
  }
}
