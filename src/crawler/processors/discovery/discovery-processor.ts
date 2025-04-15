import { getLogger } from "@logtape/logtape";
import { EventType, type JobCompletedEvent } from "../../events/event-types";
import type { AuthConfig } from "../../types/config-types";
import { JobType, type Job, type JobResult } from "../../types/job-types";
import { createGitLabClient } from "../../utils/auth";
import { BaseProcessor } from "../base-processor";

// Initialize logger
const logger = getLogger(["crawlib", "processors", "discovery"]);

/**
 * Processor for discovery-related jobs
 */
export class DiscoveryProcessor extends BaseProcessor {
  /**
   * Process discovering groups
   */
  async processDiscoverGroups(job: Job, authConfig: AuthConfig): Promise<JobResult> {
    const startTime = Date.now();
    logger.info("Discovering groups...");
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || "");
    type GitLabGroupBasic = {
      id: number | string;
      path_with_namespace: string;
      [key: string]: any;
    };
    const groups = await this.fetchPaginatedData<GitLabGroupBasic>(
      JobType.DISCOVER_GROUPS,
      "all",
      (client, options) =>
        this.getThrottledRequest(JobType.DISCOVER_GROUPS)(
          async () => (await client.Groups.all(options as any)) as unknown as GitLabGroupBasic[]
        ),
      jobApi
    );
    await this.saveData("groups.jsonl", groups);
    const discoveredJobs: Job[] = groups.map((group: GitLabGroupBasic) => ({
      id: `${JobType.GROUP_DETAILS}-${group.id}-${Date.now()}`,
      type: JobType.GROUP_DETAILS,
      resourceId: group.id,
      resourcePath: group.path_with_namespace,
      createdAt: new Date(),
      priority: 700,
      retryCount: 0,
      parentJobId: job.id
    }));
    this.eventEmitter.emit({
      type: EventType.JOB_COMPLETED,
      timestamp: new Date(),
      job,
      result: { groupCount: groups.length },
      duration: Date.now() - startTime,
      discoveredJobs
    } as JobCompletedEvent);
    return { job, success: true, discoveredJobs, data: { groupCount: groups.length } };
  }

  /**
   * Process discovering projects
   */
  async processDiscoverProjects(job: Job, authConfig: AuthConfig): Promise<JobResult> {
    const startTime = Date.now();
    logger.info("Discovering projects...");
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || "");
    type GitLabProject = { id: number | string; path_with_namespace: string; [key: string]: any };
    const projects = await this.fetchPaginatedData<GitLabProject>(
      JobType.DISCOVER_PROJECTS,
      "all",
      (client, options) =>
        this.getThrottledRequest(JobType.DISCOVER_PROJECTS)(
          async () => (await client.Projects.all(options as any)) as unknown as GitLabProject[]
        ),
      jobApi
    );
    await this.saveData("projects.jsonl", projects);
    const discoveredJobs: Job[] = projects.map((project: GitLabProject) => ({
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
  }

  /**
   * Process discovering subgroups for a given group
   */
  async processDiscoverSubgroups(job: Job, authConfig: AuthConfig): Promise<JobResult> {
    const startTime = Date.now();
    const parentGroupId = job.resourceId;
    logger.info(`Discovering subgroups for group ${parentGroupId}...`);
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || "");
    type GitLabGroup = { id: number | string; path_with_namespace: string; [key: string]: any };
    const subgroups = await this.fetchPaginatedData<GitLabGroup>(
      JobType.DISCOVER_SUBGROUPS,
      parentGroupId,
      (client, options) =>
        this.getThrottledRequest(JobType.DISCOVER_SUBGROUPS)(
          async () =>
            (await client.Groups.subgroups(
              parentGroupId,
              options as any
            )) as unknown as GitLabGroup[]
        ),
      jobApi
    );
    await this.saveData(`groups/${parentGroupId}/subgroups.jsonl`, subgroups);
    const discoveredJobs: Job[] = subgroups.map((subgroup: GitLabGroup) => ({
      id: `${JobType.GROUP_DETAILS}-${subgroup.id}-${Date.now()}`,
      type: JobType.GROUP_DETAILS,
      resourceId: subgroup.id,
      resourcePath: subgroup.path_with_namespace,
      createdAt: new Date(),
      priority: 700,
      retryCount: 0,
      parentJobId: job.id
    }));
    this.eventEmitter.emit({
      type: EventType.JOB_COMPLETED,
      timestamp: new Date(),
      job,
      result: { subgroupCount: subgroups.length },
      duration: Date.now() - startTime,
      discoveredJobs
    } as JobCompletedEvent);
    return { job, success: true, discoveredJobs, data: { subgroupCount: subgroups.length } };
  }
}
