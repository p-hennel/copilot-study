// src/processors/job-processors.ts
import { Gitlab } from '@gitbeaker/node';
import { getLogger } from '@logtape/logtape';
import { throttle } from 'lodash';
import { type CrawlerEventEmitter, EventType, type JobCompletedEvent } from '../events/event-types';
import { CursorRegistry } from '../registry/cursor-registry';
import type { AuthConfig } from '../types/config-types'; // Added AuthConfig
import { type Job, type JobResult, JobType, type ProcessorMap } from '../types/job-types'; // Added JobProcessor, ProcessorMap
import { createGitLabClient } from '../utils/auth'; // Added createGitLabClient
import { saveJsonFile, saveJsonlFile } from '../utils/filesystem';
import { getPipelineTestReport } from '../utils/gitlab-api';

// Initialize logger
const logger = getLogger(["crawlib", 'job-processors']);

/**
 * Configuration for the JobProcessors
 */
export interface JobProcessorConfig {
  // Removed api: InstanceType<typeof Gitlab>;

  /**
   * GitLab instance URL
   */
  gitlabUrl: string;

  // Removed oauthToken: string;

  /**
   * Output directory for data
   */
  outputDir: string;

  /**
   * Event emitter for progress events
   */
  eventEmitter: CrawlerEventEmitter;

  /**
   * Cursor registry for tracking pagination
   */
  cursorRegistry: CursorRegistry;

  /**
   * Resource-specific throttled request functions
   */
  resourceThrottles?: Map<string, <T>(fn: () => Promise<T>) => Promise<T>>;
}

/**
 * Processor class for handling different job types
 */
export class JobProcessors {
  // Removed api member

  /**
   * GitLab instance URL
   */
  private gitlabUrl: string;

  // Removed oauthToken member

  /**
   * Output directory for data
   */
  private outputDir: string;

  /**
   * Event emitter for progress events
   */
  private eventEmitter: CrawlerEventEmitter;

  /**
   * Cursor registry for tracking pagination
   */
  private cursorRegistry: CursorRegistry;

  /**
   * Resource-specific throttled request functions
   */
  private resourceThrottles: Map<string, <T>(fn: () => Promise<T>) => Promise<T>>;

  /**
   * Constructor
   *
   * @param config - Processor configuration
   */
  constructor(config: Omit<JobProcessorConfig, 'api' | 'oauthToken'>) { // Updated config type
    // Removed this.api assignment
    this.gitlabUrl = config.gitlabUrl;
    // Removed this.oauthToken assignment
    this.outputDir = config.outputDir;
    this.eventEmitter = config.eventEmitter;
    this.cursorRegistry = config.cursorRegistry;
    this.resourceThrottles = config.resourceThrottles || new Map();
  }

  // Removed updateApiClient method

  /**
   * Get a throttled request function for a resource type
   *
   * @param resourceType - Resource type
   * @returns Throttled request function
   */
  private getThrottledRequest(resourceType: string): <T>(fn: () => Promise<T>) => Promise<T> {
    // Use resource-specific throttle if available
    if (this.resourceThrottles.has(resourceType)) {
      return this.resourceThrottles.get(resourceType)!;
    }

    // Otherwise use a default throttle
    return throttle(
      async <T>(fn: () => Promise<T>): Promise<T> => {
        try {
          return await fn();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);

          // Handle rate limiting errors
          if (errorMessage.includes('429') || errorMessage.toLowerCase().includes('rate limit')) {
            logger.warn(`Rate limit hit, pausing for 60 seconds...`);
            await Bun.sleep(60000); // Consider making sleep duration configurable
            return fn();
          }

          throw error;
        }
      },
      1000 // Default: 1 request per second
    );
  }

  /**
   * Save data to a JSONL file
   *
   * @param fileName - File path relative to output directory
   * @param data - Data to save
   */
  private async saveData(fileName: string, data: any[]): Promise<void> {
    const filePath = `${this.outputDir}/${fileName}`;
    await saveJsonlFile(filePath, data);
  }

  /**
   * Save a single object to a JSON file
   *
   * @param fileName - File path relative to output directory
   * @param data - Data to save
   */
  private async saveSingleObject(fileName: string, data: any): Promise<void> {
    const filePath = `${this.outputDir}/${fileName}`;
    await saveJsonFile(filePath, data);
  }

  /**
   * Helper to fetch paginated data with cursor tracking
   *
   * @param resourceType - Resource type identifier
   * @param resourceId - Resource ID
   * @param fetchFn - Function to fetch data
   * @param apiClient - The API client instance to use
   * @param options - Pagination options
   * @returns Fetched items
   */
  private async fetchPaginatedData<T>(
    resourceType: string,
    resourceId: string | number,
    fetchFn: (apiClient: InstanceType<typeof Gitlab>, options: { page: number; per_page: number }) => Promise<T[]>,
    apiClient: InstanceType<typeof Gitlab>, // Added apiClient parameter
    options: {
      itemsPerPage?: number;
    } = {}
  ): Promise<T[]> {
    const { itemsPerPage = 100 } = options;

    // Get next page from cursor registry
    const nextPage = this.cursorRegistry.getNextPage(resourceType, resourceId);

    logger.debug(`Fetching ${resourceType} for ${resourceId}, page ${nextPage}...`);

    // Get throttled request function for this resource type
    const throttledRequest = this.getThrottledRequest(resourceType);

    const items = await throttledRequest(() =>
      fetchFn(apiClient, { page: nextPage, per_page: itemsPerPage }) // Pass apiClient to fetchFn
    );

    // Update cursor in registry
    const hasNextPage = items.length === itemsPerPage;
    this.cursorRegistry.registerCursor(
      resourceType,
      resourceId,
      nextPage,
      hasNextPage
    );

    // Emit page completed event with item count
    this.eventEmitter.emit({
      type: EventType.PAGE_COMPLETED,
      timestamp: new Date(),
      resourceType,
      resourceId,
      page: nextPage,
      hasNextPage,
      itemCount: items.length
    });

    return items;
  }

  // --- Implemented Job Processor Methods ---

  /**
   * Process discovering groups
   */
  async processDiscoverGroups(job: Job, authConfig: AuthConfig): Promise<JobResult> {
    const startTime = Date.now();
    logger.info('Discovering groups...');
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');
    type GitLabGroupBasic = { id: number | string; path_with_namespace: string; [key: string]: any };
    const groups = await this.fetchPaginatedData<GitLabGroupBasic>(
      JobType.DISCOVER_GROUPS, 'all',
      (client, options) => this.getThrottledRequest(JobType.DISCOVER_GROUPS)(async () => (await client.Groups.all(options as any)) as unknown as GitLabGroupBasic[]),
      jobApi
    );
    await this.saveData('groups.jsonl', groups);
    const discoveredJobs: Job[] = groups.map((group: GitLabGroupBasic) => ({
        id: `${JobType.GROUP_DETAILS}-${group.id}-${Date.now()}`, type: JobType.GROUP_DETAILS, resourceId: group.id, resourcePath: group.path_with_namespace,
        createdAt: new Date(), priority: 700, retryCount: 0, parentJobId: job.id,
    }));
    this.eventEmitter.emit({ type: EventType.JOB_COMPLETED, timestamp: new Date(), job, result: { groupCount: groups.length }, duration: Date.now() - startTime, discoveredJobs } as JobCompletedEvent);
    return { job, success: true, discoveredJobs, data: { groupCount: groups.length } };
  }

  /**
   * Process pipeline test reports
   */
  async processPipelineTestReports(job: Job, authConfig: AuthConfig): Promise<JobResult> {
    const startTime = Date.now();
    const pipelineId = job.resourceId;
    const projectId = job.data?.projectId;
    if (!projectId) throw new Error('Project ID is required for processing pipeline test reports');
    logger.info(`Processing test reports for pipeline ${pipelineId} in project ${projectId}...`);
    try {
      const testReport = await this.getThrottledRequest(JobType.PIPELINE_TEST_REPORTS)(() =>
        getPipelineTestReport(projectId, pipelineId, { gitlabUrl: this.gitlabUrl, oauthToken: authConfig.oauthToken || '' })
      );
      await this.saveSingleObject(`projects/${projectId}/pipelines/${pipelineId}/test-report.json`, testReport);
      this.eventEmitter.emit({ type: EventType.JOB_COMPLETED, timestamp: new Date(), job, result: { testReport }, duration: Date.now() - startTime } as JobCompletedEvent);
      return { job, success: true, data: { testReport } };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('not found') || errorMessage.includes('404')) {
        logger.info(`No test report available for pipeline ${pipelineId} in project ${projectId}`);
        this.eventEmitter.emit({ type: EventType.JOB_COMPLETED, timestamp: new Date(), job, result: { noTestReport: true }, duration: Date.now() - startTime } as JobCompletedEvent);
        return { job, success: true, data: { noTestReport: true } };
      }
      throw error;
    }
  }

  /**
   * Process discovering projects
   */
  async processDiscoverProjects(job: Job, authConfig: AuthConfig): Promise<JobResult> {
    const startTime = Date.now();
    logger.info('Discovering projects...');
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');
    type GitLabProject = { id: number | string; path_with_namespace: string; [key: string]: any };
    const projects = await this.fetchPaginatedData<GitLabProject>(
      JobType.DISCOVER_PROJECTS, 'all',
      (client, options) => this.getThrottledRequest(JobType.DISCOVER_PROJECTS)(async () => (await client.Projects.all(options as any)) as unknown as GitLabProject[]),
      jobApi
    );
    await this.saveData('projects.jsonl', projects);
    const discoveredJobs: Job[] = projects.map((project: GitLabProject) => ({
      id: `${JobType.PROJECT_DETAILS}-${project.id}-${Date.now()}`, type: JobType.PROJECT_DETAILS, resourceId: project.id, resourcePath: project.path_with_namespace,
      createdAt: new Date(), priority: 700, retryCount: 0, parentJobId: job.id,
    }));
    this.eventEmitter.emit({ type: EventType.JOB_COMPLETED, timestamp: new Date(), job, result: { projectCount: projects.length }, duration: Date.now() - startTime, discoveredJobs } as JobCompletedEvent);
    return { job, success: true, discoveredJobs, data: { projectCount: projects.length } };
  }

  /**
   * Process discovering subgroups for a given group
   */
  async processDiscoverSubgroups(job: Job, authConfig: AuthConfig): Promise<JobResult> {
    const startTime = Date.now();
    const parentGroupId = job.resourceId;
    logger.info(`Discovering subgroups for group ${parentGroupId}...`);
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');
    type GitLabGroup = { id: number | string; path_with_namespace: string; [key: string]: any };
    const subgroups = await this.fetchPaginatedData<GitLabGroup>(
      JobType.DISCOVER_SUBGROUPS, parentGroupId,
      (client, options) => this.getThrottledRequest(JobType.DISCOVER_SUBGROUPS)(async () => (await client.Groups.subgroups(parentGroupId, options as any)) as unknown as GitLabGroup[]),
      jobApi
    );
    await this.saveData(`groups/${parentGroupId}/subgroups.jsonl`, subgroups);
    const discoveredJobs: Job[] = subgroups.map((subgroup: GitLabGroup) => ({
      id: `${JobType.GROUP_DETAILS}-${subgroup.id}-${Date.now()}`, type: JobType.GROUP_DETAILS, resourceId: subgroup.id, resourcePath: subgroup.path_with_namespace,
      createdAt: new Date(), priority: 700, retryCount: 0, parentJobId: job.id,
    }));
    this.eventEmitter.emit({ type: EventType.JOB_COMPLETED, timestamp: new Date(), job, result: { subgroupCount: subgroups.length }, duration: Date.now() - startTime, discoveredJobs } as JobCompletedEvent);
    return { job, success: true, discoveredJobs, data: { subgroupCount: subgroups.length } };
  }

  /**
   * Process fetching details for a specific group
   */
  async processGroupDetails(job: Job, authConfig: AuthConfig): Promise<JobResult> {
    const startTime = Date.now();
    const groupId = job.resourceId;
    logger.info(`Processing details for group ${groupId}...`);
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');
    type GitLabGroupDetails = { id: number | string; path_with_namespace: string; web_url: string; [key: string]: any };
    try {
      const groupDetails = await this.getThrottledRequest(JobType.GROUP_DETAILS)(
        async () => (await jobApi.Groups.show(groupId)) as unknown as GitLabGroupDetails
      );
      await this.saveSingleObject(`groups/${groupId}/details.json`, groupDetails);
      const discoveredJobs: Job[] = [
        { id: `${JobType.DISCOVER_SUBGROUPS}-${groupId}-${Date.now()}`, type: JobType.DISCOVER_SUBGROUPS, resourceId: groupId, resourcePath: groupDetails.path_with_namespace, createdAt: new Date(), priority: 800, retryCount: 0, parentJobId: job.id },
        { id: `${JobType.GROUP_MEMBERS}-${groupId}-${Date.now()}`, type: JobType.GROUP_MEMBERS, resourceId: groupId, resourcePath: groupDetails.path_with_namespace, createdAt: new Date(), priority: 600, retryCount: 0, parentJobId: job.id },
        { id: `${JobType.GROUP_PROJECTS}-${groupId}-${Date.now()}`, type: JobType.GROUP_PROJECTS, resourceId: groupId, resourcePath: groupDetails.path_with_namespace, createdAt: new Date(), priority: 600, retryCount: 0, parentJobId: job.id },
        { id: `${JobType.GROUP_ISSUES}-${groupId}-${Date.now()}`, type: JobType.GROUP_ISSUES, resourceId: groupId, resourcePath: groupDetails.path_with_namespace, createdAt: new Date(), priority: 500, retryCount: 0, parentJobId: job.id }
      ];
      this.eventEmitter.emit({ type: EventType.JOB_COMPLETED, timestamp: new Date(), job, result: { groupDetails }, duration: Date.now() - startTime, discoveredJobs } as JobCompletedEvent);
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
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');
    type GitLabMember = { id: number | string; username: string; [key: string]: any };
    try {
      const members = await this.fetchPaginatedData<GitLabMember>(
        JobType.GROUP_MEMBERS, groupId,
        (client, options) => this.getThrottledRequest(JobType.GROUP_MEMBERS)(async () => (await client.GroupMembers.all(groupId, options as any)) as unknown as GitLabMember[]),
        jobApi
      );
      await this.saveData(`groups/${groupId}/members.jsonl`, members);
      const discoveredJobs: Job[] = [];
      this.eventEmitter.emit({ type: EventType.JOB_COMPLETED, timestamp: new Date(), job, result: { memberCount: members.length }, duration: Date.now() - startTime, discoveredJobs } as JobCompletedEvent);
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
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');
    type GitLabProjectBasic = { id: number | string; path_with_namespace: string; [key: string]: any };
    try {
      const projects = await this.fetchPaginatedData<GitLabProjectBasic>(
        JobType.GROUP_PROJECTS, groupId,
        (client, options) => this.getThrottledRequest(JobType.GROUP_PROJECTS)(async () => (await client.Groups.projects(groupId, options as any)) as unknown as GitLabProjectBasic[]),
        jobApi
      );
      await this.saveData(`groups/${groupId}/projects.jsonl`, projects);
      const discoveredJobs: Job[] = projects.map((project: GitLabProjectBasic) => ({
        id: `${JobType.PROJECT_DETAILS}-${project.id}-${Date.now()}`, type: JobType.PROJECT_DETAILS, resourceId: project.id, resourcePath: project.path_with_namespace,
        createdAt: new Date(), priority: 700, retryCount: 0, parentJobId: job.id,
      }));
      this.eventEmitter.emit({ type: EventType.JOB_COMPLETED, timestamp: new Date(), job, result: { projectCount: projects.length }, duration: Date.now() - startTime, discoveredJobs } as JobCompletedEvent);
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
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');
    type GitLabIssueBasic = { id: number | string; iid: number; project_id: number; [key: string]: any };
    try {
      const issues = await this.fetchPaginatedData<GitLabIssueBasic>(
        JobType.GROUP_ISSUES, groupId,
        (client, options) => this.getThrottledRequest(JobType.GROUP_ISSUES)(async () => (await client.Issues.all({ groupId: groupId, ...options })) as unknown as GitLabIssueBasic[]),
        jobApi
      );
      await this.saveData(`groups/${groupId}/issues.jsonl`, issues);
      const discoveredJobs: Job[] = issues.map((issue: GitLabIssueBasic) => ({
        id: `${JobType.ISSUE_DISCUSSIONS}-${issue.project_id}-${issue.iid}-${Date.now()}`, type: JobType.ISSUE_DISCUSSIONS, resourceId: issue.id,
        resourcePath: `projects/${issue.project_id}/issues/${issue.iid}`, createdAt: new Date(), priority: 200, retryCount: 0, parentJobId: job.id,
        data: { projectId: issue.project_id, issueIid: issue.iid }
      }));
      this.eventEmitter.emit({ type: EventType.JOB_COMPLETED, timestamp: new Date(), job, result: { issueCount: issues.length }, duration: Date.now() - startTime, discoveredJobs } as JobCompletedEvent);
      return { job, success: true, discoveredJobs, data: { issueCount: issues.length } };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to process issues for group ${groupId}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Process fetching details for a specific project
   */
  async processProjectDetails(job: Job, authConfig: AuthConfig): Promise<JobResult> {
    const startTime = Date.now();
    const projectId = job.resourceId;
    logger.info(`Processing details for project ${projectId}...`);
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');
    type GitLabProjectDetails = { id: number | string; path_with_namespace: string; web_url: string; [key: string]: any };
    try {
      const projectDetails = await this.getThrottledRequest(JobType.PROJECT_DETAILS)(
        async () => (await jobApi.Projects.show(projectId)) as unknown as GitLabProjectDetails
      );
      await this.saveSingleObject(`projects/${projectId}/details.json`, projectDetails);
      const discoveredJobs: Job[] = [
        { id: `${JobType.PROJECT_BRANCHES}-${projectId}-${Date.now()}`, type: JobType.PROJECT_BRANCHES, resourceId: projectId, resourcePath: projectDetails.path_with_namespace, createdAt: new Date(), priority: 500, retryCount: 0, parentJobId: job.id },
        { id: `${JobType.PROJECT_MERGE_REQUESTS}-${projectId}-${Date.now()}`, type: JobType.PROJECT_MERGE_REQUESTS, resourceId: projectId, resourcePath: projectDetails.path_with_namespace, createdAt: new Date(), priority: 500, retryCount: 0, parentJobId: job.id },
        { id: `${JobType.PROJECT_ISSUES}-${projectId}-${Date.now()}`, type: JobType.PROJECT_ISSUES, resourceId: projectId, resourcePath: projectDetails.path_with_namespace, createdAt: new Date(), priority: 500, retryCount: 0, parentJobId: job.id },
        { id: `${JobType.PROJECT_MILESTONES}-${projectId}-${Date.now()}`, type: JobType.PROJECT_MILESTONES, resourceId: projectId, resourcePath: projectDetails.path_with_namespace, createdAt: new Date(), priority: 400, retryCount: 0, parentJobId: job.id },
        { id: `${JobType.PROJECT_RELEASES}-${projectId}-${Date.now()}`, type: JobType.PROJECT_RELEASES, resourceId: projectId, resourcePath: projectDetails.path_with_namespace, createdAt: new Date(), priority: 400, retryCount: 0, parentJobId: job.id },
        { id: `${JobType.PROJECT_PIPELINES}-${projectId}-${Date.now()}`, type: JobType.PROJECT_PIPELINES, resourceId: projectId, resourcePath: projectDetails.path_with_namespace, createdAt: new Date(), priority: 400, retryCount: 0, parentJobId: job.id },
        { id: `${JobType.PROJECT_VULNERABILITIES}-${projectId}-${Date.now()}`, type: JobType.PROJECT_VULNERABILITIES, resourceId: projectId, resourcePath: projectDetails.path_with_namespace, createdAt: new Date(), priority: 300, retryCount: 0, parentJobId: job.id }
      ];
      this.eventEmitter.emit({ type: EventType.JOB_COMPLETED, timestamp: new Date(), job, result: { projectDetails }, duration: Date.now() - startTime, discoveredJobs } as JobCompletedEvent);
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
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');
    type GitLabBranch = { name: string; commit: { id: string }; [key: string]: any };
    try {
      const branches = await this.fetchPaginatedData<GitLabBranch>(
        JobType.PROJECT_BRANCHES, projectId,
        (client, options) => this.getThrottledRequest(JobType.PROJECT_BRANCHES)(async () => (await client.Branches.all(projectId, options as any)) as unknown as GitLabBranch[]),
        jobApi
      );
      await this.saveData(`projects/${projectId}/branches.jsonl`, branches);
      const discoveredJobs: Job[] = [];
      this.eventEmitter.emit({ type: EventType.JOB_COMPLETED, timestamp: new Date(), job, result: { branchCount: branches.length }, duration: Date.now() - startTime, discoveredJobs } as JobCompletedEvent);
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
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');
    type GitLabMergeRequestBasic = { id: number | string; iid: number; [key: string]: any };
    try {
      const mergeRequests = await this.fetchPaginatedData<GitLabMergeRequestBasic>(
        JobType.PROJECT_MERGE_REQUESTS, projectId,
        (client, options) => this.getThrottledRequest(JobType.PROJECT_MERGE_REQUESTS)(async () => (await client.MergeRequests.all({ projectId: projectId, ...options })) as unknown as GitLabMergeRequestBasic[]),
        jobApi
      );
      await this.saveData(`projects/${projectId}/merge_requests.jsonl`, mergeRequests);
      const discoveredJobs: Job[] = mergeRequests.map((mr: GitLabMergeRequestBasic) => ({
        id: `${JobType.MERGE_REQUEST_DISCUSSIONS}-${projectId}-${mr.iid}-${Date.now()}`, type: JobType.MERGE_REQUEST_DISCUSSIONS, resourceId: mr.id,
        resourcePath: `projects/${projectId}/merge_requests/${mr.iid}`, createdAt: new Date(), priority: 200, retryCount: 0, parentJobId: job.id,
        data: { projectId: projectId, mergeRequestIid: mr.iid }
      }));
      this.eventEmitter.emit({ type: EventType.JOB_COMPLETED, timestamp: new Date(), job, result: { mergeRequestCount: mergeRequests.length }, duration: Date.now() - startTime, discoveredJobs } as JobCompletedEvent);
      return { job, success: true, discoveredJobs, data: { mergeRequestCount: mergeRequests.length } };
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
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');
    type GitLabIssueBasic = { id: number | string; iid: number; project_id: number; [key: string]: any };
    try {
      const issues = await this.fetchPaginatedData<GitLabIssueBasic>(
        JobType.PROJECT_ISSUES, projectId,
        (client, options) => this.getThrottledRequest(JobType.PROJECT_ISSUES)(async () => (await client.Issues.all({ projectId: projectId, ...options })) as unknown as GitLabIssueBasic[]),
        jobApi
      );
      await this.saveData(`projects/${projectId}/issues.jsonl`, issues);
      const discoveredJobs: Job[] = issues.map((issue: GitLabIssueBasic) => ({
        id: `${JobType.ISSUE_DISCUSSIONS}-${projectId}-${issue.iid}-${Date.now()}`, type: JobType.ISSUE_DISCUSSIONS, resourceId: issue.id,
        resourcePath: `projects/${projectId}/issues/${issue.iid}`, createdAt: new Date(), priority: 200, retryCount: 0, parentJobId: job.id,
        data: { projectId: projectId, issueIid: issue.iid }
      }));
      this.eventEmitter.emit({ type: EventType.JOB_COMPLETED, timestamp: new Date(), job, result: { issueCount: issues.length }, duration: Date.now() - startTime, discoveredJobs } as JobCompletedEvent);
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
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');
    type GitLabMilestone = { id: number | string; iid: number; title: string; [key: string]: any };
    try {
      const milestones = await this.fetchPaginatedData<GitLabMilestone>(
        JobType.PROJECT_MILESTONES, projectId,
        (client, options) => this.getThrottledRequest(JobType.PROJECT_MILESTONES)(async () => (await client.ProjectMilestones.all(projectId, options as any)) as unknown as GitLabMilestone[]),
        jobApi
      );
      await this.saveData(`projects/${projectId}/milestones.jsonl`, milestones);
      const discoveredJobs: Job[] = [];
      this.eventEmitter.emit({ type: EventType.JOB_COMPLETED, timestamp: new Date(), job, result: { milestoneCount: milestones.length }, duration: Date.now() - startTime, discoveredJobs } as JobCompletedEvent);
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
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');
    type GitLabRelease = { tag_name: string; name: string; [key: string]: any };
    try {
      const releases = await this.fetchPaginatedData<GitLabRelease>(
        JobType.PROJECT_RELEASES, projectId,
        (client, options) => this.getThrottledRequest(JobType.PROJECT_RELEASES)(async () => (await client.Releases.all(projectId, options as any)) as unknown as GitLabRelease[]),
        jobApi
      );
      await this.saveData(`projects/${projectId}/releases.jsonl`, releases);
      const discoveredJobs: Job[] = [];
      this.eventEmitter.emit({ type: EventType.JOB_COMPLETED, timestamp: new Date(), job, result: { releaseCount: releases.length }, duration: Date.now() - startTime, discoveredJobs } as JobCompletedEvent);
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
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');
    type GitLabPipelineBasic = { id: number | string; status: string; ref: string; [key: string]: any };
    try {
      const pipelines = await this.fetchPaginatedData<GitLabPipelineBasic>(
        JobType.PROJECT_PIPELINES, projectId,
        (client, options) => this.getThrottledRequest(JobType.PROJECT_PIPELINES)(async () => (await client.Pipelines.all(projectId, options as any)) as unknown as GitLabPipelineBasic[]),
        jobApi
      );
      await this.saveData(`projects/${projectId}/pipelines.jsonl`, pipelines);
      const discoveredJobs: Job[] = pipelines.flatMap((pipeline: GitLabPipelineBasic) => [
        { id: `${JobType.PIPELINE_DETAILS}-${projectId}-${pipeline.id}-${Date.now()}`, type: JobType.PIPELINE_DETAILS, resourceId: pipeline.id, resourcePath: `projects/${projectId}/pipelines/${pipeline.id}`, createdAt: new Date(), priority: 200, retryCount: 0, parentJobId: job.id, data: { projectId: projectId } },
        { id: `${JobType.PIPELINE_TEST_REPORTS}-${projectId}-${pipeline.id}-${Date.now()}`, type: JobType.PIPELINE_TEST_REPORTS, resourceId: pipeline.id, resourcePath: `projects/${projectId}/pipelines/${pipeline.id}/test_report`, createdAt: new Date(), priority: 100, retryCount: 0, parentJobId: job.id, data: { projectId: projectId } }
      ]);
      this.eventEmitter.emit({ type: EventType.JOB_COMPLETED, timestamp: new Date(), job, result: { pipelineCount: pipelines.length }, duration: Date.now() - startTime, discoveredJobs } as JobCompletedEvent);
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
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');
    type GitLabVulnerabilityFinding = { id: number | string; name: string; severity: string; [key: string]: any };
    try {
      const vulnerabilities = await this.fetchPaginatedData<GitLabVulnerabilityFinding>(
        JobType.PROJECT_VULNERABILITIES, projectId,
        (client, options) => this.getThrottledRequest(JobType.PROJECT_VULNERABILITIES)(async () => (await client.VulnerabilityFindings.all(projectId, options as any)) as unknown as GitLabVulnerabilityFinding[]),
        jobApi
      );
      await this.saveData(`projects/${projectId}/vulnerabilities.jsonl`, vulnerabilities);
      const discoveredJobs: Job[] = [];
      this.eventEmitter.emit({ type: EventType.JOB_COMPLETED, timestamp: new Date(), job, result: { vulnerabilityCount: vulnerabilities.length }, duration: Date.now() - startTime, discoveredJobs } as JobCompletedEvent);
      return { job, success: true, discoveredJobs, data: { vulnerabilityCount: vulnerabilities.length } };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('403') || errorMessage.includes('forbidden') || errorMessage.includes('not found') || errorMessage.includes('404')) {
         logger.warn(`Could not fetch vulnerabilities for project ${projectId} (status: ${errorMessage}). Feature might be disabled or permissions missing.`);
         this.eventEmitter.emit({ type: EventType.JOB_COMPLETED, timestamp: new Date(), job, result: { vulnerabilityCount: 0, skipped: true, reason: errorMessage }, duration: Date.now() - startTime, discoveredJobs: [] } as JobCompletedEvent);
         return { job, success: true, data: { vulnerabilityCount: 0, skipped: true, reason: errorMessage } };
      }
      logger.error(`Failed to process vulnerabilities for project ${projectId}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Process fetching discussions for a specific merge request
   */
  async processMergeRequestDiscussions(job: Job, authConfig: AuthConfig): Promise<JobResult> {
    const startTime = Date.now();
    const projectId = job.data?.projectId;
    const mergeRequestIid = job.data?.mergeRequestIid;
    if (!projectId || !mergeRequestIid) throw new Error(`Missing projectId or mergeRequestIid in job data for job ${job.id}`);
    logger.info(`Processing discussions for MR !${mergeRequestIid} in project ${projectId}...`);
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');
    type GitLabDiscussion = { id: string; notes: any[]; [key: string]: any };
    try {
      const discussions = await this.fetchPaginatedData<GitLabDiscussion>(
        JobType.MERGE_REQUEST_DISCUSSIONS, `${projectId}-mr-${mergeRequestIid}`,
        (client, options) => this.getThrottledRequest(JobType.MERGE_REQUEST_DISCUSSIONS)(async () => (await client.MergeRequestDiscussions.all(projectId, mergeRequestIid, options as any)) as unknown as GitLabDiscussion[]),
        jobApi
      );
      await this.saveData(`projects/${projectId}/merge_requests/${mergeRequestIid}/discussions.jsonl`, discussions);
      const discoveredJobs: Job[] = [];
      this.eventEmitter.emit({ type: EventType.JOB_COMPLETED, timestamp: new Date(), job, result: { discussionCount: discussions.length }, duration: Date.now() - startTime, discoveredJobs } as JobCompletedEvent);
      return { job, success: true, discoveredJobs, data: { discussionCount: discussions.length } };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to process discussions for MR !${mergeRequestIid} in project ${projectId}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Process fetching discussions for a specific issue
   */
  async processIssueDiscussions(job: Job, authConfig: AuthConfig): Promise<JobResult> { // Renamed _authConfig as it's now used
    const startTime = Date.now();
    const projectId = job.data?.projectId;
    const issueIid = job.data?.issueIid;

    if (!projectId || !issueIid) {
      throw new Error(`Missing projectId or issueIid in job data for job ${job.id}`);
    }

    logger.info(`Processing discussions for issue #${issueIid} in project ${projectId}...`);

    // Create temporary API client
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');

    // Define type for discussion details
    type GitLabDiscussion = { id: string; notes: any[]; [key: string]: any };

    try {
      const discussions = await this.fetchPaginatedData<GitLabDiscussion>(
        JobType.ISSUE_DISCUSSIONS,
        `${projectId}-issue-${issueIid}`, // Composite resource ID for cursor tracking
        // Pass the temporary client to the fetch function
        (client, options) => this.getThrottledRequest(JobType.ISSUE_DISCUSSIONS)(async () => (await client.IssueDiscussions.all(projectId, issueIid, options as any)) as unknown as GitLabDiscussion[]), // Double cast result
        jobApi // Pass the created client
      );

      // Save discussions data
      await this.saveData(`projects/${projectId}/issues/${issueIid}/discussions.jsonl`, discussions);

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
      logger.error(`Failed to process discussions for issue #${issueIid} in project ${projectId}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Process fetching details for a specific pipeline
   */
  async processPipelineDetails(job: Job, _authConfig: AuthConfig): Promise<JobResult> {
    logger.warn(`Processor for ${job.type} not fully implemented.`);
    // Requires projectId from job.data
    // Use jobApi.Pipelines.show(projectId, job.resourceId)
    // Save to projects/${projectId}/pipelines/${job.resourceId}/details.json
    return { job, success: true, data: { note: 'Not implemented' } };
  }


  /**
   * Get all job processors as a map
   */
  getProcessors(): ProcessorMap { // Use ProcessorMap type which includes AuthConfig
    return {
      [JobType.DISCOVER_GROUPS]: this.processDiscoverGroups.bind(this),
      [JobType.DISCOVER_PROJECTS]: this.processDiscoverProjects.bind(this),
      [JobType.DISCOVER_SUBGROUPS]: this.processDiscoverSubgroups.bind(this),
      [JobType.GROUP_DETAILS]: this.processGroupDetails.bind(this),
      [JobType.PIPELINE_TEST_REPORTS]: this.processPipelineTestReports.bind(this),

      // Bind implemented/placeholder implementations
      [JobType.GROUP_MEMBERS]: this.processGroupMembers.bind(this),
      [JobType.GROUP_PROJECTS]: this.processGroupProjects.bind(this),
      [JobType.GROUP_ISSUES]: this.processGroupIssues.bind(this),
      [JobType.PROJECT_DETAILS]: this.processProjectDetails.bind(this),
      [JobType.PROJECT_BRANCHES]: this.processProjectBranches.bind(this),
      [JobType.PROJECT_MERGE_REQUESTS]: this.processProjectMergeRequests.bind(this),
      [JobType.PROJECT_ISSUES]: this.processProjectIssues.bind(this),
      [JobType.PROJECT_MILESTONES]: this.processProjectMilestones.bind(this),
      [JobType.PROJECT_RELEASES]: this.processProjectReleases.bind(this),
      [JobType.PROJECT_PIPELINES]: this.processProjectPipelines.bind(this),
      [JobType.PROJECT_VULNERABILITIES]: this.processProjectVulnerabilities.bind(this),
      [JobType.MERGE_REQUEST_DISCUSSIONS]: this.processMergeRequestDiscussions.bind(this),
      [JobType.ISSUE_DISCUSSIONS]: this.processIssueDiscussions.bind(this),
      [JobType.PIPELINE_DETAILS]: this.processPipelineDetails.bind(this),
    };
  }
}