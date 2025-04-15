import { getLogger } from "@logtape/logtape";
import { EventType, type JobCompletedEvent } from "../../events/event-types";
import type { AuthConfig } from "../../types/config-types";
import { JobType, type Job, type JobResult } from "../../types/job-types";
import { createGitLabClient } from "../../utils/auth";
import { BaseProcessor } from "../base-processor";

// Initialize logger
const logger = getLogger(["crawlib", "processors", "group"]);

/**
 * Processor for group-related jobs
 */
export class GroupProcessor extends BaseProcessor {
  /**
   * Process fetching details for a specific group
   */
  async processGroupDetails(job: Job, authConfig: AuthConfig): Promise<JobResult> {
    const startTime = Date.now();
    const groupId = job.resourceId;
    logger.info(`Processing details for group ${groupId}...`);
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || "");
    type GitLabGroupDetails = {
      id: number | string;
      path_with_namespace: string;
      web_url: string;
      [key: string]: any;
    };
    try {
      const groupDetails = await this.getThrottledRequest(JobType.GROUP_DETAILS)(
        async () => (await jobApi.Groups.show(groupId)) as unknown as GitLabGroupDetails
      );
      await this.saveSingleObject(`groups/${groupId}/details.json`, groupDetails);
      const discoveredJobs: Job[] = [
        {
          id: `${JobType.DISCOVER_SUBGROUPS}-${groupId}-${Date.now()}`,
          type: JobType.DISCOVER_SUBGROUPS,
          resourceId: groupId,
          resourcePath: groupDetails.path_with_namespace,
          createdAt: new Date(),
          priority: 800,
          retryCount: 0,
          parentJobId: job.id
        },
        {
          id: `${JobType.GROUP_MEMBERS}-${groupId}-${Date.now()}`,
          type: JobType.GROUP_MEMBERS,
          resourceId: groupId,
          resourcePath: groupDetails.path_with_namespace,
          createdAt: new Date(),
          priority: 600,
          retryCount: 0,
          parentJobId: job.id
        },
        {
          id: `${JobType.GROUP_PROJECTS}-${groupId}-${Date.now()}`,
          type: JobType.GROUP_PROJECTS,
          resourceId: groupId,
          resourcePath: groupDetails.path_with_namespace,
          createdAt: new Date(),
          priority: 600,
          retryCount: 0,
          parentJobId: job.id
        },
        {
          id: `${JobType.GROUP_ISSUES}-${groupId}-${Date.now()}`,
          type: JobType.GROUP_ISSUES,
          resourceId: groupId,
          resourcePath: groupDetails.path_with_namespace,
          createdAt: new Date(),
          priority: 500,
          retryCount: 0,
          parentJobId: job.id
        }
      ];
      this.eventEmitter.emit({
        type: EventType.JOB_COMPLETED,
        timestamp: new Date(),
        job,
        result: { groupDetails },
        duration: Date.now() - startTime,
        discoveredJobs
      } as JobCompletedEvent);
      return { job, success: true, discoveredJobs, data: { groupDetails } };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to process details for group ${groupId}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Process fetching members for a specific group
   */
  async processGroupMembers(job: Job, authConfig: AuthConfig): Promise<JobResult> {
    const startTime = Date.now();
    const groupId = job.resourceId;
    logger.info(`Processing members for group ${groupId}...`);
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || "");
    type GitLabMember = { id: number | string; username: string; [key: string]: any };
    try {
      const members = await this.fetchPaginatedData<GitLabMember>(
        JobType.GROUP_MEMBERS,
        groupId,
        (client, options) =>
          this.getThrottledRequest(JobType.GROUP_MEMBERS)(
            async () =>
              (await client.GroupMembers.all(groupId, options as any)) as unknown as GitLabMember[]
          ),
        jobApi
      );
      await this.saveData(`groups/${groupId}/members.jsonl`, members);
      const discoveredJobs: Job[] = [];
      this.eventEmitter.emit({
        type: EventType.JOB_COMPLETED,
        timestamp: new Date(),
        job,
        result: { memberCount: members.length },
        duration: Date.now() - startTime,
        discoveredJobs
      } as JobCompletedEvent);
      return { job, success: true, discoveredJobs, data: { memberCount: members.length } };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to process members for group ${groupId}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Process fetching projects for a specific group
   */
  async processGroupProjects(job: Job, authConfig: AuthConfig): Promise<JobResult> {
    const startTime = Date.now();
    const groupId = job.resourceId;
    logger.info(`Processing projects for group ${groupId}...`);
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || "");
    type GitLabProjectBasic = {
      id: number | string;
      path_with_namespace: string;
      [key: string]: any;
    };
    try {
      const projects = await this.fetchPaginatedData<GitLabProjectBasic>(
        JobType.GROUP_PROJECTS,
        groupId,
        (client, options) =>
          this.getThrottledRequest(JobType.GROUP_PROJECTS)(
            async () =>
              (await client.Groups.projects(
                groupId,
                options as any
              )) as unknown as GitLabProjectBasic[]
          ),
        jobApi
      );
      await this.saveData(`groups/${groupId}/projects.jsonl`, projects);
      const discoveredJobs: Job[] = projects.map((project: GitLabProjectBasic) => ({
        id: `${JobType.PROJECT_DETAILS}-${project.id}-${Date.now()}`,
        type: JobType.PROJECT_DETAILS,
        resourceId: project.id,
        resourcePath: project.path_with_namespace,
        createdAt: new Date(),
        priority: 700,
        retryCount: 0,
        parentJobId: job.id
      }));
      this.eventEmitter.emit({
        type: EventType.JOB_COMPLETED,
        timestamp: new Date(),
        job,
        result: { projectCount: projects.length },
        duration: Date.now() - startTime,
        discoveredJobs
      } as JobCompletedEvent);
      return { job, success: true, discoveredJobs, data: { projectCount: projects.length } };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to process projects for group ${groupId}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Process fetching issues for a specific group
   */
  async processGroupIssues(job: Job, authConfig: AuthConfig): Promise<JobResult> {
    const startTime = Date.now();
    const groupId = job.resourceId;
    logger.info(`Processing issues for group ${groupId}...`);
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || "");
    type GitLabIssueBasic = {
      id: number | string;
      iid: number;
      project_id: number;
      [key: string]: any;
    };
    try {
      const issues = await this.fetchPaginatedData<GitLabIssueBasic>(
        JobType.GROUP_ISSUES,
        groupId,
        (client, options) =>
          this.getThrottledRequest(JobType.GROUP_ISSUES)(
            async () =>
              (await client.Issues.all({
                groupId: groupId,
                ...options
              })) as unknown as GitLabIssueBasic[]
          ),
        jobApi
      );
      await this.saveData(`groups/${groupId}/issues.jsonl`, issues);
      const discoveredJobs: Job[] = issues.map((issue: GitLabIssueBasic) => ({
        id: `${JobType.ISSUE_DISCUSSIONS}-${issue.project_id}-${issue.iid}-${Date.now()}`,
        type: JobType.ISSUE_DISCUSSIONS,
        resourceId: issue.id,
        resourcePath: `projects/${issue.project_id}/issues/${issue.iid}`,
        createdAt: new Date(),
        priority: 200,
        retryCount: 0,
        parentJobId: job.id,
        data: { projectId: issue.project_id, issueIid: issue.iid }
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
      logger.error(`Failed to process issues for group ${groupId}: ${errorMessage}`);
      throw error;
    }
  }
}
