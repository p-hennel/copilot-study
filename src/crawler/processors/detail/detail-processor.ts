import { getLogger } from "@logtape/logtape";
import { EventType, type JobCompletedEvent } from "../../events/event-types";
import type { AuthConfig } from "../../types/config-types";
import { JobType, type Job, type JobResult } from "../../types/job-types";
import { createGitLabClient } from "../../utils/auth";
import { getPipelineTestReport } from "../../utils/gitlab-api";
import { BaseProcessor } from "../base-processor";

// Initialize logger
const logger = getLogger(["crawlib", "processors", "detail"]);

/**
 * Processor for detail-related jobs like discussions, pipeline details, etc.
 */
export class DetailProcessor extends BaseProcessor {
  /**
   * Process fetching discussions for a specific merge request
   */
  async processMergeRequestDiscussions(job: Job, authConfig: AuthConfig): Promise<JobResult> {
    const startTime = Date.now();
    const projectId = job.data?.projectId;
    const mergeRequestIid = job.data?.mergeRequestIid;
    if (!projectId || !mergeRequestIid)
      throw new Error(`Missing projectId or mergeRequestIid in job data for job ${job.id}`);
    logger.info(`Processing discussions for MR !${mergeRequestIid} in project ${projectId}...`);
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || "");
    type GitLabDiscussion = { id: string; notes: any[]; [key: string]: any };
    try {
      const discussions = await this.fetchPaginatedData<GitLabDiscussion>(
        JobType.MERGE_REQUEST_DISCUSSIONS,
        `${projectId}-mr-${mergeRequestIid}`,
        (client, options) =>
          this.getThrottledRequest(JobType.MERGE_REQUEST_DISCUSSIONS)(
            async () =>
              (await client.MergeRequestDiscussions.all(
                projectId,
                mergeRequestIid,
                options as any
              )) as unknown as GitLabDiscussion[]
          ),
        jobApi
      );
      await this.saveData(
        `projects/${projectId}/merge_requests/${mergeRequestIid}/discussions.jsonl`,
        discussions
      );
      const discoveredJobs: Job[] = [];
      this.eventEmitter.emit({
        type: EventType.JOB_COMPLETED,
        timestamp: new Date(),
        job,
        result: { discussionCount: discussions.length },
        duration: Date.now() - startTime,
        discoveredJobs
      } as JobCompletedEvent);
      return { job, success: true, discoveredJobs, data: { discussionCount: discussions.length } };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        `Failed to process discussions for MR !${mergeRequestIid} in project ${projectId}: ${errorMessage}`
      );
      throw error;
    }
  }

  /**
   * Process fetching discussions for a specific issue
   */
  async processIssueDiscussions(job: Job, authConfig: AuthConfig): Promise<JobResult> {
    const startTime = Date.now();
    const projectId = job.data?.projectId;
    const issueIid = job.data?.issueIid;

    if (!projectId || !issueIid) {
      throw new Error(`Missing projectId or issueIid in job data for job ${job.id}`);
    }

    logger.info(`Processing discussions for issue #${issueIid} in project ${projectId}...`);

    // Create temporary API client
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || "");

    // Define type for discussion details
    type GitLabDiscussion = { id: string; notes: any[]; [key: string]: any };

    try {
      const discussions = await this.fetchPaginatedData<GitLabDiscussion>(
        JobType.ISSUE_DISCUSSIONS,
        `${projectId}-issue-${issueIid}`, // Composite resource ID for cursor tracking
        // Pass the temporary client to the fetch function
        (client, options) =>
          this.getThrottledRequest(JobType.ISSUE_DISCUSSIONS)(
            async () =>
              (await client.IssueDiscussions.all(
                projectId,
                issueIid,
                options as any
              )) as unknown as GitLabDiscussion[]
          ), // Double cast result
        jobApi // Pass the created client
      );

      // Save discussions data
      await this.saveData(
        `projects/${projectId}/issues/${issueIid}/discussions.jsonl`,
        discussions
      );

      // No new jobs discovered
      const discoveredJobs: Job[] = [];

      // Emit job completed event
      this.eventEmitter.emit({
        type: EventType.JOB_COMPLETED,
        timestamp: new Date(),
        job,
        result: { discussionCount: discussions.length },
        duration: Date.now() - startTime,
        discoveredJobs
      } as JobCompletedEvent);

      return {
        job,
        success: true,
        discoveredJobs,
        data: { discussionCount: discussions.length }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        `Failed to process discussions for issue #${issueIid} in project ${projectId}: ${errorMessage}`
      );
      throw error;
    }
  }

  /**
   * Process fetching details for a specific pipeline
   */
  async processPipelineDetails(job: Job, authConfig: AuthConfig): Promise<JobResult> {
    const startTime = Date.now();
    const pipelineId = job.resourceId;
    const projectId = job.data?.projectId;

    if (!projectId) {
      throw new Error(`Missing projectId in job data for pipeline details job ${job.id}`);
    }

    logger.info(`Processing details for pipeline ${pipelineId} in project ${projectId}...`);

    // Create GitLab API client for this job
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || "");

    try {
      // Fetch pipeline details
      const pipelineDetails = await this.getThrottledRequest(JobType.PIPELINE_DETAILS)(
        async () => await jobApi.Pipelines.show(Number(projectId), Number(pipelineId))
      );

      // Save pipeline details to JSON file
      await this.saveSingleObject(
        `projects/${projectId}/pipelines/${pipelineId}/details.json`,
        pipelineDetails
      );

      // Additional data we might want to fetch for this pipeline
      const discoveredJobs: Job[] = [];

      // We could add more related jobs here based on the pipeline details
      // For example: pipeline jobs, pipeline variables, etc.

      // Emit job completed event
      this.eventEmitter.emit({
        type: EventType.JOB_COMPLETED,
        timestamp: new Date(),
        job,
        result: { pipelineDetails },
        duration: Date.now() - startTime,
        discoveredJobs
      } as JobCompletedEvent);

      return {
        job,
        success: true,
        discoveredJobs,
        data: { pipelineDetails }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("not found") || errorMessage.includes("404")) {
        logger.info(`Pipeline ${pipelineId} in project ${projectId} not found`);

        this.eventEmitter.emit({
          type: EventType.JOB_COMPLETED,
          timestamp: new Date(),
          job,
          result: { noPipelineDetails: true, reason: "Pipeline not found" },
          duration: Date.now() - startTime
        } as JobCompletedEvent);

        return {
          job,
          success: true,
          data: { noPipelineDetails: true, reason: "Pipeline not found" }
        };
      }

      logger.error(
        `Failed to process pipeline details for ${pipelineId} in project ${projectId}: ${errorMessage}`
      );
      throw error;
    }
  }

  /**
   * Process pipeline test reports
   */
  async processPipelineTestReports(job: Job, authConfig: AuthConfig): Promise<JobResult> {
    const startTime = Date.now();
    const pipelineId = job.resourceId;
    const projectId = job.data?.projectId;
    if (!projectId) throw new Error("Project ID is required for processing pipeline test reports");
    logger.info(`Processing test reports for pipeline ${pipelineId} in project ${projectId}...`);
    try {
      const testReport = await this.getThrottledRequest(JobType.PIPELINE_TEST_REPORTS)(() =>
        getPipelineTestReport(projectId, pipelineId, {
          gitlabUrl: this.gitlabUrl,
          oauthToken: authConfig.oauthToken || ""
        })
      );
      await this.saveSingleObject(
        `projects/${projectId}/pipelines/${pipelineId}/test-report.json`,
        testReport
      );
      this.eventEmitter.emit({
        type: EventType.JOB_COMPLETED,
        timestamp: new Date(),
        job,
        result: { testReport },
        duration: Date.now() - startTime
      } as JobCompletedEvent);
      return { job, success: true, data: { testReport } };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("not found") || errorMessage.includes("404")) {
        logger.info(`No test report available for pipeline ${pipelineId} in project ${projectId}`);
        this.eventEmitter.emit({
          type: EventType.JOB_COMPLETED,
          timestamp: new Date(),
          job,
          result: { noTestReport: true },
          duration: Date.now() - startTime
        } as JobCompletedEvent);
        return { job, success: true, data: { noTestReport: true } };
      }
      throw error;
    }
  }
}
