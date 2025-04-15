/**
 * SupervisorClient wrapper for job creation via IPC
 * 
 * This file provides a thin wrapper around the SupervisorClient
 * to handle job discovery and creation using inter-process communication.
 */

import { getLogger } from "@logtape/logtape";
import { SupervisorClient } from "../../subvisor/client";
import type { Job, JobType } from "../types/job-types";

// Initialize logger
const logger = getLogger(["crawlib", "supervisorClient"]);

/**
 * Represents a wrapper around the SupervisorClient for job-related IPC
 */
export class CrawlerSupervisorClient {
  private client: SupervisorClient;

  /**
   * Create a new CrawlerSupervisorClient
   * 
   * @param client - The SupervisorClient instance to use
   */
  constructor(client: SupervisorClient) {
    this.client = client;
  }

  /**
   * Report newly discovered jobs to the supervisor
   * 
   * @param jobs - Array of discovered jobs
   */
  public reportDiscoveredJobs(jobs: Job[]): void {
    if (!jobs || jobs.length === 0) {
      return;
    }

    logger.info(`Reporting ${jobs.length} discovered jobs to supervisor`);
    
    // Send message to the supervisor
    // By convention, these messages go to processes with "web" in the ID
    // The web server will handle storing them in the database
    this.client.sendMessage("*", "discoveredJobs", {
      jobs,
      timestamp: Date.now()
    });
  }

  /**
   * Report a single discovered job to the supervisor
   * 
   * @param job - The discovered job
   */
  public reportDiscoveredJob(job: Job): void {
    this.reportDiscoveredJobs([job]);
  }

  /**
   * Helper to create a new job
   * 
   * @param type - The job type
   * @param resourceId - Resource identifier (e.g., group ID, project ID)
   * @param resourcePath - Resource path (e.g., full_path for groups/projects)
   * @param parentJobId - ID of the parent job that led to this discovery
   * @param data - Additional data needed for job execution
   * @returns The created job object
   */
  public createJob(
    type: JobType,
    resourceId: string | number,
    resourcePath?: string,
    parentJobId?: string,
    data?: Record<string, any>
  ): Job {
    const job: Job = {
      id: `${type}-${resourceId}-${Date.now()}`,
      type,
      resourceId,
      resourcePath,
      data,
      createdAt: new Date(),
      priority: 0, // Default priority
      retryCount: 0,
      parentJobId
    };

    return job;
  }

  /**
   * Create and immediately report a job
   * 
   * @param type - The job type
   * @param resourceId - Resource identifier (e.g., group ID, project ID)
   * @param resourcePath - Resource path (e.g., full_path for groups/projects)
   * @param parentJobId - ID of the parent job that led to this discovery
   * @param data - Additional data needed for job execution
   * @returns The created job object
   */
  public createAndReportJob(
    type: JobType,
    resourceId: string | number,
    resourcePath?: string,
    parentJobId?: string,
    data?: Record<string, any>
  ): Job {
    const job = this.createJob(type, resourceId, resourcePath, parentJobId, data);
    this.reportDiscoveredJob(job);
    return job;
  }
  
  /**
   * Forward a job completed event with discovered jobs to the supervisor
   */
  public emitJobCompleted(job: Job, result: any, discoveredJobs?: Job[]): void {
    // Report any discovered jobs
    if (discoveredJobs && discoveredJobs.length > 0) {
      this.reportDiscoveredJobs(discoveredJobs);
    }
    
    // Additionally send the job completed event
    this.client.sendMessage("*", "jobCompleted", {
      job,
      result,
      timestamp: Date.now()
    });
  }
  
  /**
   * Forward a job failed event to the supervisor
   */
  public emitJobFailed(job: Job, error: string): void {
    this.client.sendMessage("*", "jobFailed", {
      job,
      error,
      timestamp: Date.now()
    });
  }
}