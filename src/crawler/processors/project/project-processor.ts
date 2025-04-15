import { getLogger } from "@logtape/logtape";
import { EventType, type JobCompletedEvent } from "../../events/event-types";
import type { AuthConfig } from "../../types/config-types";
import { JobType, type Job, type JobResult } from "../../types/job-types";
import { createGitLabClient } from "../../utils/auth";
import { BaseProcessor } from "../base-processor";

// Initialize logger
const logger = getLogger(["crawlib", "processors", "project"]);

/**
 * Processor for project-related jobs
 */
export class ProjectProcessor extends BaseProcessor {
  /**
   * Process fetching details for a specific project
   */
  async processProjectDetails(job: Job, authConfig: AuthConfig): Promise<JobResult> {
    const startTime = Date.now();
    const projectId = job.resourceId;
    logger.info(`Processing details for project ${projectId}...`);
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || "");
    type GitLabProjectDetails = {
      id: number | string;
      path_with_namespace: string;
      web_url: string;
      [key: string]: any;
    };
    try {
      const projectDetails = await this.getThrottledRequest(JobType.PROJECT_DETAILS)(
        async () => (await jobApi.Projects.show(projectId)) as unknown as GitLabProjectDetails
      );
      await this.saveSingleObject(`projects/${projectId}/details.json`, projectDetails);
      const discoveredJobs: Job[] = [
        {
          id: `${JobType.PROJECT_BRANCHES}-${projectId}-${Date.now()}`,
          type: JobType.PROJECT_BRANCHES,
          resourceId: projectId,
          resourcePath: projectDetails.path_with_namespace,
          createdAt: new Date(),
          priority: 500,
          retryCount: 0,
          parentJobId: job.id
        },
        {
          id: `${JobType.PROJECT_MERGE_REQUESTS}-${projectId}-${Date.now()}`,
          type: JobType.PROJECT_MERGE_REQUESTS,
          resourceId: projectId,
          resourcePath: projectDetails.path_with_namespace,
          createdAt: new Date(),
          priority: 500,
          retryCount: 0,
          parentJobId: job.id
        },
        {
          id: `${JobType.PROJECT_ISSUES}-${projectId}-${Date.now()}`,
          type: JobType.PROJECT_ISSUES,
          resourceId: projectId,
          resourcePath: projectDetails.path_with_namespace,
          createdAt: new Date(),
          priority: 500,
          retryCount: 0,
          parentJobId: job.id
        },
        {
          id: `${JobType.PROJECT_MILESTONES}-${projectId}-${Date.now()}`,
          type: JobType.PROJECT_MILESTONES,
          resourceId: projectId,
          resourcePath: projectDetails.path_with_namespace,
          createdAt: new Date(),
          priority: 400,
          retryCount: 0,
          parentJobId: job.id
        },
        {
          id: `${JobType.PROJECT_RELEASES}-${projectId}-${Date.now()}`,
          type: JobType.PROJECT_RELEASES,
          resourceId: projectId,
          resourcePath: projectDetails.path_with_namespace,
          createdAt: new Date(),
          priority: 400,
          retryCount: 0,
          parentJobId: job.id
        },
        {
          id: `${JobType.PROJECT_PIPELINES}-${projectId}-${Date.now()}`,
          type: JobType.PROJECT_PIPELINES,
          resourceId: projectId,
          resourcePath: projectDetails.path_with_namespace,
          createdAt: new Date(),
          priority: 400,
          retryCount: 0,
          parentJobId: job.id
        },
        {
          id: `${JobType.PROJECT_VULNERABILITIES}-${projectId}-${Date.now()}`,
          type: JobType.PROJECT_VULNERABILITIES,
          resourceId: projectId,
          resourcePath: projectDetails.path_with_namespace,
          createdAt: new Date(),
          priority: 300,
          retryCount: 0,
          parentJobId: job.id
        }
      ];
      this.eventEmitter.emit({
        type: EventType.JOB_COMPLETED,
        timestamp: new Date(),
        job,
        result: { projectDetails },
        duration: Date.now() - startTime,
        discoveredJobs
      } as JobCompletedEvent);
      return { job, success: true, discoveredJobs, data: { projectDetails } };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to process details for project ${projectId}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Process fetching branches for a specific project
   */
  async processProjectBranches(job: Job, authConfig: AuthConfig): Promise<JobResult> {
    const startTime = Date.now();
    const projectId = job.resourceId;
    logger.info(`Processing branches for project ${projectId}...`);
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || "");
    type GitLabBranch = { name: string; commit: { id: string }; [key: string]: any };
    try {
      const branches = await this.fetchPaginatedData<GitLabBranch>(
        JobType.PROJECT_BRANCHES,
        projectId,
        (client, options) =>
          this.getThrottledRequest(JobType.PROJECT_BRANCHES)(
            async () =>
              (await client.Branches.all(projectId, options as any)) as unknown as GitLabBranch[]
          ),
        jobApi
      );
      await this.saveData(`projects/${projectId}/branches.jsonl`, branches);
      const discoveredJobs: Job[] = [];
      this.eventEmitter.emit({
        type: EventType.JOB_COMPLETED,
        timestamp: new Date(),
        job,
        result: { branchCount: branches.length },
        duration: Date.now() - startTime,
        discoveredJobs
      } as JobCompletedEvent);
      return { job, success: true, discoveredJobs, data: { branchCount: branches.length } };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to process branches for project ${projectId}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Process fetching merge requests for a specific project
   */
  async processProjectMergeRequests(job: Job, authConfig: AuthConfig): Promise<JobResult> {
    const startTime = Date.now();
    const projectId = job.resourceId;
    logger.info(`Processing merge requests for project ${projectId}...`);
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || "");
    type GitLabMergeRequestBasic = { id: number | string; iid: number; [key: string]: any };
    try {
      const mergeRequests = await this.fetchPaginatedData<GitLabMergeRequestBasic>(
        JobType.PROJECT_MERGE_REQUESTS,
        projectId,
        (client, options) =>
          this.getThrottledRequest(JobType.PROJECT_MERGE_REQUESTS)(
            async () =>
              (await client.MergeRequests.all({
                projectId: projectId,
                ...options
              })) as unknown as GitLabMergeRequestBasic[]
          ),
        jobApi
      );
      await this.saveData(`projects/${projectId}/merge_requests.jsonl`, mergeRequests);
      const discoveredJobs: Job[] = mergeRequests.map((mr: GitLabMergeRequestBasic) => ({
        id: `${JobType.MERGE_REQUEST_DISCUSSIONS}-${projectId}-${mr.iid}-${Date.now()}`,
        type: JobType.MERGE_REQUEST_DISCUSSIONS,
        resourceId: mr.id,
        resourcePath: `projects/${projectId}/merge_requests/${mr.iid}`,
        createdAt: new Date(),
        priority: 200,
        retryCount: 0,
        parentJobId: job.id,
        data: { projectId: projectId, mergeRequestIid: mr.iid }
      }));
      this.eventEmitter.emit({
        type: EventType.JOB_COMPLETED,
        timestamp: new Date(),
        job,
        result: { mergeRequestCount: mergeRequests.length },
        duration: Date.now() - startTime,
        discoveredJobs
      } as JobCompletedEvent);
      return {
        job,
        success: true,
        discoveredJobs,
        data: { mergeRequestCount: mergeRequests.length }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to process merge requests for project ${projectId}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Process fetching issues for a specific project
   */
  async processProjectIssues(job: Job, authConfig: AuthConfig): Promise<JobResult> {
    const startTime = Date.now();
    const projectId = job.resourceId;
    logger.info(`Processing issues for project ${projectId}...`);
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || "");
    type GitLabIssueBasic = {
      id: number | string;
      iid: number;
      project_id: number;
      [key: string]: any;
    };
    try {
      const issues = await this.fetchPaginatedData<GitLabIssueBasic>(
        JobType.PROJECT_ISSUES,
        projectId,
        (client, options) =>
          this.getThrottledRequest(JobType.PROJECT_ISSUES)(
            async () =>
              (await client.Issues.all({
                projectId: projectId,
                ...options
              })) as unknown as GitLabIssueBasic[]
          ),
        jobApi
      );
      await this.saveData(`projects/${projectId}/issues.jsonl`, issues);
      const discoveredJobs: Job[] = issues.map((issue: GitLabIssueBasic) => ({
        id: `${JobType.ISSUE_DISCUSSIONS}-${projectId}-${issue.iid}-${Date.now()}`,
        type: JobType.ISSUE_DISCUSSIONS,
        resourceId: issue.id,
        resourcePath: `projects/${projectId}/issues/${issue.iid}`,
        createdAt: new Date(),
        priority: 200,
        retryCount: 0,
        parentJobId: job.id,
        data: { projectId: projectId, issueIid: issue.iid }
      }));
      this.eventEmitter.emit({
        type: EventType.JOB_COMPLETED,
        timestamp: new Date(),
        job,
        result: { issueCount: issues.length },
        duration: Date.now() - startTime,
        discoveredJobs
      } as JobCompletedEvent);
      return { job, success: true, discoveredJobs, data: { issueCount: issues.length } };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to process issues for project ${projectId}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Process fetching milestones for a specific project
   */
  async processProjectMilestones(job: Job, authConfig: AuthConfig): Promise<JobResult> {
    const startTime = Date.now();
    const projectId = job.resourceId;
    logger.info(`Processing milestones for project ${projectId}...`);
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || "");
    type GitLabMilestone = { id: number | string; iid: number; title: string; [key: string]: any };
    try {
      const milestones = await this.fetchPaginatedData<GitLabMilestone>(
        JobType.PROJECT_MILESTONES,
        projectId,
        (client, options) =>
          this.getThrottledRequest(JobType.PROJECT_MILESTONES)(
            async () =>
              (await client.ProjectMilestones.all(
                projectId,
                options as any
              )) as unknown as GitLabMilestone[]
          ),
        jobApi
      );
      await this.saveData(`projects/${projectId}/milestones.jsonl`, milestones);
      const discoveredJobs: Job[] = [];
      this.eventEmitter.emit({
        type: EventType.JOB_COMPLETED,
        timestamp: new Date(),
        job,
        result: { milestoneCount: milestones.length },
        duration: Date.now() - startTime,
        discoveredJobs
      } as JobCompletedEvent);
      return { job, success: true, discoveredJobs, data: { milestoneCount: milestones.length } };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to process milestones for project ${projectId}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Process fetching releases for a specific project
   */
  async processProjectReleases(job: Job, authConfig: AuthConfig): Promise<JobResult> {
    const startTime = Date.now();
    const projectId = job.resourceId;
    logger.info(`Processing releases for project ${projectId}...`);
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || "");
    type GitLabRelease = { tag_name: string; name: string; [key: string]: any };
    try {
      const releases = await this.fetchPaginatedData<GitLabRelease>(
        JobType.PROJECT_RELEASES,
        projectId,
        (client, options) =>
          this.getThrottledRequest(JobType.PROJECT_RELEASES)(
            async () =>
              (await client.Releases.all(projectId, options as any)) as unknown as GitLabRelease[]
          ),
        jobApi
      );
      await this.saveData(`projects/${projectId}/releases.jsonl`, releases);
      const discoveredJobs: Job[] = [];
      this.eventEmitter.emit({
        type: EventType.JOB_COMPLETED,
        timestamp: new Date(),
        job,
        result: { releaseCount: releases.length },
        duration: Date.now() - startTime,
        discoveredJobs
      } as JobCompletedEvent);
      return { job, success: true, discoveredJobs, data: { releaseCount: releases.length } };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to process releases for project ${projectId}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Process fetching pipelines for a specific project
   */
  async processProjectPipelines(job: Job, authConfig: AuthConfig): Promise<JobResult> {
    const startTime = Date.now();
    const projectId = job.resourceId;
    logger.info(`Processing pipelines for project ${projectId}...`);
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || "");
    type GitLabPipelineBasic = {
      id: number | string;
      status: string;
      ref: string;
      [key: string]: any;
    };
    try {
      const pipelines = await this.fetchPaginatedData<GitLabPipelineBasic>(
        JobType.PROJECT_PIPELINES,
        projectId,
        (client, options) =>
          this.getThrottledRequest(JobType.PROJECT_PIPELINES)(
            async () =>
              (await client.Pipelines.all(
                projectId,
                options as any
              )) as unknown as GitLabPipelineBasic[]
          ),
        jobApi
      );
      await this.saveData(`projects/${projectId}/pipelines.jsonl`, pipelines);
      const discoveredJobs: Job[] = pipelines.flatMap((pipeline: GitLabPipelineBasic) => [
        {
          id: `${JobType.PIPELINE_DETAILS}-${projectId}-${pipeline.id}-${Date.now()}`,
          type: JobType.PIPELINE_DETAILS,
          resourceId: pipeline.id,
          resourcePath: `projects/${projectId}/pipelines/${pipeline.id}`,
          createdAt: new Date(),
          priority: 200,
          retryCount: 0,
          parentJobId: job.id,
          data: { projectId: projectId }
        },
        {
          id: `${JobType.PIPELINE_TEST_REPORTS}-${projectId}-${pipeline.id}-${Date.now()}`,
          type: JobType.PIPELINE_TEST_REPORTS,
          resourceId: pipeline.id,
          resourcePath: `projects/${projectId}/pipelines/${pipeline.id}/test_report`,
          createdAt: new Date(),
          priority: 100,
          retryCount: 0,
          parentJobId: job.id,
          data: { projectId: projectId }
        }
      ]);
      this.eventEmitter.emit({
        type: EventType.JOB_COMPLETED,
        timestamp: new Date(),
        job,
        result: { pipelineCount: pipelines.length },
        duration: Date.now() - startTime,
        discoveredJobs
      } as JobCompletedEvent);
      return { job, success: true, discoveredJobs, data: { pipelineCount: pipelines.length } };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to process pipelines for project ${projectId}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Process fetching vulnerabilities for a specific project
   */
  async processProjectVulnerabilities(job: Job, authConfig: AuthConfig): Promise<JobResult> {
    const startTime = Date.now();
    const projectId = job.resourceId;
    logger.info(`Processing vulnerabilities for project ${projectId}...`);
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || "");
    type GitLabVulnerabilityFinding = {
      id: number | string;
      name: string;
      severity: string;
      [key: string]: any;
    };
    try {
      const vulnerabilities = await this.fetchPaginatedData<GitLabVulnerabilityFinding>(
        JobType.PROJECT_VULNERABILITIES,
        projectId,
        (client, options) =>
          this.getThrottledRequest(JobType.PROJECT_VULNERABILITIES)(
            async () =>
              (await client.VulnerabilityFindings.all(
                projectId,
                options as any
              )) as unknown as GitLabVulnerabilityFinding[]
          ),
        jobApi
      );
      await this.saveData(`projects/${projectId}/vulnerabilities.jsonl`, vulnerabilities);
      const discoveredJobs: Job[] = [];
      this.eventEmitter.emit({
        type: EventType.JOB_COMPLETED,
        timestamp: new Date(),
        job,
        result: { vulnerabilityCount: vulnerabilities.length },
        duration: Date.now() - startTime,
        discoveredJobs
      } as JobCompletedEvent);
      return {
        job,
        success: true,
        discoveredJobs,
        data: { vulnerabilityCount: vulnerabilities.length }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes("403") ||
        errorMessage.includes("forbidden") ||
        errorMessage.includes("not found") ||
        errorMessage.includes("404")
      ) {
        logger.warn(
          `Could not fetch vulnerabilities for project ${projectId} (status: ${errorMessage}). Feature might be disabled or permissions missing.`
        );
        this.eventEmitter.emit({
          type: EventType.JOB_COMPLETED,
          timestamp: new Date(),
          job,
          result: { vulnerabilityCount: 0, skipped: true, reason: errorMessage },
          duration: Date.now() - startTime,
          discoveredJobs: []
        } as JobCompletedEvent);
        return {
          job,
          success: true,
          data: { vulnerabilityCount: 0, skipped: true, reason: errorMessage }
        };
      }
      logger.error(`Failed to process vulnerabilities for project ${projectId}: ${errorMessage}`);
      throw error;
    }
  }
}
