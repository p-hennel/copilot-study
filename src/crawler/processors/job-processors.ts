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

    // Create temporary API client for this job
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');

    // Define type for group (replace 'any' with specific type if known)
    type GitLabGroupBasic = { id: number | string; path_with_namespace: string; [key: string]: any };

    const groups = await this.fetchPaginatedData<GitLabGroupBasic>(
      JobType.DISCOVER_GROUPS,
      'all',
      // Pass the temporary client to the fetch function
      (client, options) => this.getThrottledRequest(JobType.DISCOVER_GROUPS)(async () => (await client.Groups.all(options as any)) as unknown as GitLabGroupBasic[]), // Double cast result
      jobApi // Pass the created client
    );

    await this.saveData('groups.jsonl', groups);

    // Create jobs for group details
    const discoveredJobs: Job[] = groups.map((group: GitLabGroupBasic) => ({
        id: `${JobType.GROUP_DETAILS}-${group.id}-${Date.now()}`,
        type: JobType.GROUP_DETAILS,
        resourceId: group.id,
        resourcePath: group.path_with_namespace,
        createdAt: new Date(),
        priority: 700, // Priority for GROUP_DETAILS
        retryCount: 0,
        parentJobId: job.id,
        // auth: authConfig // Optionally inherit auth
    }));

    // Emit job completed event
    this.eventEmitter.emit({
      type: EventType.JOB_COMPLETED,
      timestamp: new Date(),
      job,
      result: { groupCount: groups.length },
      duration: Date.now() - startTime,
      discoveredJobs
    } as JobCompletedEvent);

    return {
      job,
      success: true,
      discoveredJobs,
      data: { groupCount: groups.length }
    };
  }

  /**
   * Process pipeline test reports
   */
  async processPipelineTestReports(job: Job, authConfig: AuthConfig): Promise<JobResult> {
    const startTime = Date.now();
    const pipelineId = job.resourceId;
    const projectId = job.data?.projectId;

    if (!projectId) {
      throw new Error('Project ID is required for processing pipeline test reports');
    }

    logger.info(`Processing test reports for pipeline ${pipelineId} in project ${projectId}...`);

    try {
      // Use direct GitLab API call utility, passing the specific token
      const testReport = await this.getThrottledRequest(JobType.PIPELINE_TEST_REPORTS)(() =>
        getPipelineTestReport(projectId, pipelineId, {
          gitlabUrl: this.gitlabUrl,
          oauthToken: authConfig.oauthToken || '' // Use token from authConfig
        })
      );

      // Save to nested directory
      await this.saveSingleObject(`projects/${projectId}/pipelines/${pipelineId}/test-report.json`, testReport);

      // Emit job completed event
      this.eventEmitter.emit({
        type: EventType.JOB_COMPLETED,
        timestamp: new Date(),
        job,
        result: { testReport },
        duration: Date.now() - startTime
      } as JobCompletedEvent);

      return {
        job,
        success: true,
        data: { testReport }
      };
    } catch (error) {
      // Test report might not be available, which is fine
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes('not found') || errorMessage.includes('404')) {
        logger.info(`No test report available for pipeline ${pipelineId} in project ${projectId}`);

        // Emit job completed event
        this.eventEmitter.emit({
          type: EventType.JOB_COMPLETED,
          timestamp: new Date(),
          job,
          result: { noTestReport: true },
          duration: Date.now() - startTime
        } as JobCompletedEvent);

        return {
          job,
          success: true,
          data: { noTestReport: true }
        };
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

    // Create temporary API client for this job using the provided authConfig
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');

    // Define a type for the project object returned by the API
    type GitLabProject = { id: number | string; path_with_namespace: string; [key: string]: any };

    const projects = await this.fetchPaginatedData<GitLabProject>(
      JobType.DISCOVER_PROJECTS,
      'all',
      // Pass the temporary client to the fetch function
      (client, options) => this.getThrottledRequest(JobType.DISCOVER_PROJECTS)(async () => (await client.Projects.all(options as any)) as unknown as GitLabProject[]), // Double cast result
      jobApi // Pass the created client
    );

    await this.saveData('projects.jsonl', projects);

    // Create jobs for project details
    const discoveredJobs: Job[] = projects.map((project: GitLabProject) => ({
      id: `${JobType.PROJECT_DETAILS}-${project.id}-${Date.now()}`, // Simple unique ID
      type: JobType.PROJECT_DETAILS,
      resourceId: project.id,
      resourcePath: project.path_with_namespace,
      createdAt: new Date(),
      priority: 700, // Priority for PROJECT_DETAILS
      retryCount: 0,
      parentJobId: job.id,
      // auth: authConfig // Optionally inherit auth
    }));

    // Emit job completed event
    this.eventEmitter.emit({
      type: EventType.JOB_COMPLETED,
      timestamp: new Date(),
      job,
      result: { projectCount: projects.length },
      duration: Date.now() - startTime,
      discoveredJobs
    } as JobCompletedEvent);

    return {
      job,
      success: true,
      discoveredJobs,
      data: { projectCount: projects.length }
    };
  }

  /**
   * Process discovering subgroups for a given group
   */
  async processDiscoverSubgroups(job: Job, authConfig: AuthConfig): Promise<JobResult> {
    const startTime = Date.now();
    const parentGroupId = job.resourceId;
    logger.info(`Discovering subgroups for group ${parentGroupId}...`);

    // Create temporary API client for this job using the provided authConfig
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');

    // Define type for subgroup (similar to group)
    type GitLabGroup = { id: number | string; path_with_namespace: string; [key: string]: any };

    const subgroups = await this.fetchPaginatedData<GitLabGroup>(
      JobType.DISCOVER_SUBGROUPS,
      parentGroupId,
      // Pass the temporary client to the fetch function
      (client, options) => this.getThrottledRequest(JobType.DISCOVER_SUBGROUPS)(async () => (await client.Groups.subgroups(parentGroupId, options as any)) as unknown as GitLabGroup[]), // Double cast result
      jobApi // Pass the created client
    );

    // Save subgroups data
    await this.saveData(`groups/${parentGroupId}/subgroups.jsonl`, subgroups);

    // Create jobs for group details for each discovered subgroup
    const discoveredJobs: Job[] = subgroups.map((subgroup: GitLabGroup) => ({
      id: `${JobType.GROUP_DETAILS}-${subgroup.id}-${Date.now()}`,
      type: JobType.GROUP_DETAILS,
      resourceId: subgroup.id,
      resourcePath: subgroup.path_with_namespace,
      createdAt: new Date(),
      priority: 700, // Priority for GROUP_DETAILS
      retryCount: 0,
      parentJobId: job.id,
      // auth: authConfig // Optionally inherit auth
    }));

    // Emit job completed event
    this.eventEmitter.emit({
      type: EventType.JOB_COMPLETED,
      timestamp: new Date(),
      job,
      result: { subgroupCount: subgroups.length },
      duration: Date.now() - startTime,
      discoveredJobs
    } as JobCompletedEvent);

    return {
      job,
      success: true,
      discoveredJobs,
      data: { subgroupCount: subgroups.length }
    };
  }

  /**
   * Process fetching details for a specific group
   */
  async processGroupDetails(job: Job, authConfig: AuthConfig): Promise<JobResult> {
    const startTime = Date.now();
    const groupId = job.resourceId;
    logger.info(`Processing details for group ${groupId}...`);

    // Create temporary API client
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');

    // Define type for group details
    type GitLabGroupDetails = { id: number | string; path_with_namespace: string; web_url: string; [key: string]: any };

    try {
      // Fetch group details
      const groupDetails = await this.getThrottledRequest(JobType.GROUP_DETAILS)(
        async () => (await jobApi.Groups.show(groupId)) as unknown as GitLabGroupDetails // Double cast result
      );

      // Save group details
      await this.saveSingleObject(`groups/${groupId}/details.json`, groupDetails);

      // Create follow-up jobs for this group
      const discoveredJobs: Job[] = [
        // Discover subgroups
        {
          id: `${JobType.DISCOVER_SUBGROUPS}-${groupId}-${Date.now()}`,
          type: JobType.DISCOVER_SUBGROUPS,
          resourceId: groupId,
          resourcePath: groupDetails.path_with_namespace,
          createdAt: new Date(),
          priority: 800, // Priority for DISCOVER_SUBGROUPS
          retryCount: 0,
          parentJobId: job.id,
          // auth: authConfig // Optionally inherit auth
        },
        // Discover members
        {
          id: `${JobType.GROUP_MEMBERS}-${groupId}-${Date.now()}`,
          type: JobType.GROUP_MEMBERS,
          resourceId: groupId,
          resourcePath: groupDetails.path_with_namespace,
          createdAt: new Date(),
          priority: 600, // Priority for GROUP_MEMBERS
          retryCount: 0,
          parentJobId: job.id,
          // auth: authConfig
        },
        // Discover projects within the group
        {
          id: `${JobType.GROUP_PROJECTS}-${groupId}-${Date.now()}`,
          type: JobType.GROUP_PROJECTS,
          resourceId: groupId,
          resourcePath: groupDetails.path_with_namespace,
          createdAt: new Date(),
          priority: 600, // Priority for GROUP_PROJECTS
          retryCount: 0,
          parentJobId: job.id,
          // auth: authConfig
        },
        // Discover issues within the group
        {
          id: `${JobType.GROUP_ISSUES}-${groupId}-${Date.now()}`,
          type: JobType.GROUP_ISSUES,
          resourceId: groupId,
          resourcePath: groupDetails.path_with_namespace,
          createdAt: new Date(),
          priority: 500, // Priority for GROUP_ISSUES
          retryCount: 0,
          parentJobId: job.id,
          // auth: authConfig
        }
      ];

      // Emit job completed event
      this.eventEmitter.emit({
        type: EventType.JOB_COMPLETED,
        timestamp: new Date(),
        job,
        result: { groupDetails },
        duration: Date.now() - startTime,
        discoveredJobs
      } as JobCompletedEvent);

      return {
        job,
        success: true,
        discoveredJobs,
        data: { groupDetails }
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to process details for group ${groupId}: ${errorMessage}`);
      // Re-throw to let the main crawler handle failure/retry
      throw error;
    }
  }

  // --- Placeholder Processor Methods ---
  // TODO: Implement the remaining processor methods following the pattern above

  async processGroupMembers(job: Job, authConfig: AuthConfig): Promise<JobResult> { // Renamed _authConfig back to authConfig as it's now used
    const startTime = Date.now();
    const groupId = job.resourceId;
    logger.info(`Processing members for group ${groupId}...`);

    // Create temporary API client
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');

    // Define type for member details
    type GitLabMember = { id: number | string; username: string; [key: string]: any };

    try {
      const members = await this.fetchPaginatedData<GitLabMember>(
        JobType.GROUP_MEMBERS,
        groupId,
        // Pass the temporary client to the fetch function
        (client, options) => this.getThrottledRequest(JobType.GROUP_MEMBERS)(async () => (await client.GroupMembers.all(groupId, options as any)) as unknown as GitLabMember[]), // Double cast result
        jobApi // Pass the created client
      );

      // Save members data
      await this.saveData(`groups/${groupId}/members.jsonl`, members);

      // No new jobs discovered from members typically
      const discoveredJobs: Job[] = [];

      // Emit job completed event
      this.eventEmitter.emit({
        type: EventType.JOB_COMPLETED,
        timestamp: new Date(),
        job,
        result: { memberCount: members.length },
        duration: Date.now() - startTime,
        discoveredJobs
      } as JobCompletedEvent);

      return {
        job,
        success: true,
        discoveredJobs,
        data: { memberCount: members.length }
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to process members for group ${groupId}: ${errorMessage}`);
      throw error;
    }
  }

  async processGroupProjects(job: Job, authConfig: AuthConfig): Promise<JobResult> { // Renamed _authConfig
    const startTime = Date.now();
    const groupId = job.resourceId;
    logger.info(`Processing projects for group ${groupId}...`);

    // Create temporary API client
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');

    // Define type for project details (basic)
    type GitLabProjectBasic = { id: number | string; path_with_namespace: string; [key: string]: any };

    try {
      const projects = await this.fetchPaginatedData<GitLabProjectBasic>(
        JobType.GROUP_PROJECTS,
        groupId,
        // Pass the temporary client to the fetch function
        (client, options) => this.getThrottledRequest(JobType.GROUP_PROJECTS)(async () => (await client.Groups.projects(groupId, options as any)) as unknown as GitLabProjectBasic[]), // Double cast result
        jobApi // Pass the created client
      );

      // Save projects data
      await this.saveData(`groups/${groupId}/projects.jsonl`, projects);

      // Create jobs for project details for each discovered project
      const discoveredJobs: Job[] = projects.map((project: GitLabProjectBasic) => ({
        id: `${JobType.PROJECT_DETAILS}-${project.id}-${Date.now()}`,
        type: JobType.PROJECT_DETAILS,
        resourceId: project.id,
        resourcePath: project.path_with_namespace,
        createdAt: new Date(),
        priority: 700, // Priority for PROJECT_DETAILS
        retryCount: 0,
        parentJobId: job.id,
        // auth: authConfig // Optionally inherit auth
      }));

      // Emit job completed event
      this.eventEmitter.emit({
        type: EventType.JOB_COMPLETED,
        timestamp: new Date(),
        job,
        result: { projectCount: projects.length },
        duration: Date.now() - startTime,
        discoveredJobs
      } as JobCompletedEvent);

      return {
        job,
        success: true,
        discoveredJobs,
        data: { projectCount: projects.length }
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to process projects for group ${groupId}: ${errorMessage}`);
      throw error;
    }
  }

  async processGroupIssues(job: Job, authConfig: AuthConfig): Promise<JobResult> { // Renamed _authConfig
    const startTime = Date.now();
    const groupId = job.resourceId;
    logger.info(`Processing issues for group ${groupId}...`);

    // Create temporary API client
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');

    // Define type for issue details (basic)
    type GitLabIssueBasic = { id: number | string; iid: number; project_id: number; [key: string]: any };

    try {
      const issues = await this.fetchPaginatedData<GitLabIssueBasic>(
        JobType.GROUP_ISSUES,
        groupId,
        // Pass the temporary client to the fetch function
        // Note: Issues.all takes an object for filtering
        (client, options) => this.getThrottledRequest(JobType.GROUP_ISSUES)(async () => (await client.Issues.all({ groupId: groupId, ...options })) as unknown as GitLabIssueBasic[]), // Double cast result
        jobApi // Pass the created client
      );

      // Save issues data
      await this.saveData(`groups/${groupId}/issues.jsonl`, issues);

      // Create jobs for issue discussions for each discovered issue
      const discoveredJobs: Job[] = issues.map((issue: GitLabIssueBasic) => ({
        id: `${JobType.ISSUE_DISCUSSIONS}-${issue.project_id}-${issue.iid}-${Date.now()}`,
        type: JobType.ISSUE_DISCUSSIONS,
        resourceId: issue.id, // Use the global issue ID as resourceId
        resourcePath: `projects/${issue.project_id}/issues/${issue.iid}`, // Construct a path
        createdAt: new Date(),
        priority: 200, // Priority for ISSUE_DISCUSSIONS
        retryCount: 0,
        parentJobId: job.id,
        data: { // Pass necessary IDs for the processor
            projectId: issue.project_id,
            issueIid: issue.iid
        }
        // auth: authConfig // Optionally inherit auth
      }));

      // Emit job completed event
      this.eventEmitter.emit({
        type: EventType.JOB_COMPLETED,
        timestamp: new Date(),
        job,
        result: { issueCount: issues.length },
        duration: Date.now() - startTime,
        discoveredJobs
      } as JobCompletedEvent);

      return {
        job,
        success: true,
        discoveredJobs,
        data: { issueCount: issues.length }
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to process issues for group ${groupId}: ${errorMessage}`);
      throw error;
    }
  }

  async processProjectDetails(job: Job, authConfig: AuthConfig): Promise<JobResult> { // Renamed _authConfig
    const startTime = Date.now();
    const projectId = job.resourceId;
    logger.info(`Processing details for project ${projectId}...`);

    // Create temporary API client
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');

    // Define type for project details
    type GitLabProjectDetails = { id: number | string; path_with_namespace: string; web_url: string; [key: string]: any };

    try {
      // Fetch project details
      const projectDetails = await this.getThrottledRequest(JobType.PROJECT_DETAILS)(
        async () => (await jobApi.Projects.show(projectId)) as unknown as GitLabProjectDetails // Double cast result
      );

      // Save project details
      await this.saveSingleObject(`projects/${projectId}/details.json`, projectDetails);

      // Create follow-up jobs for this project
      const discoveredJobs: Job[] = [
        {
          id: `${JobType.PROJECT_BRANCHES}-${projectId}-${Date.now()}`,
          type: JobType.PROJECT_BRANCHES,
          resourceId: projectId,
          resourcePath: projectDetails.path_with_namespace,
          createdAt: new Date(), priority: 500, retryCount: 0, parentJobId: job.id,
          // auth: authConfig
        },
        {
          id: `${JobType.PROJECT_MERGE_REQUESTS}-${projectId}-${Date.now()}`,
          type: JobType.PROJECT_MERGE_REQUESTS,
          resourceId: projectId,
          resourcePath: projectDetails.path_with_namespace,
          createdAt: new Date(), priority: 500, retryCount: 0, parentJobId: job.id,
          // auth: authConfig
        },
        {
          id: `${JobType.PROJECT_ISSUES}-${projectId}-${Date.now()}`,
          type: JobType.PROJECT_ISSUES,
          resourceId: projectId,
          resourcePath: projectDetails.path_with_namespace,
          createdAt: new Date(), priority: 500, retryCount: 0, parentJobId: job.id,
          // auth: authConfig
        },
        {
          id: `${JobType.PROJECT_MILESTONES}-${projectId}-${Date.now()}`,
          type: JobType.PROJECT_MILESTONES,
          resourceId: projectId,
          resourcePath: projectDetails.path_with_namespace,
          createdAt: new Date(), priority: 400, retryCount: 0, parentJobId: job.id,
          // auth: authConfig
        },
        {
          id: `${JobType.PROJECT_RELEASES}-${projectId}-${Date.now()}`,
          type: JobType.PROJECT_RELEASES,
          resourceId: projectId,
          resourcePath: projectDetails.path_with_namespace,
          createdAt: new Date(), priority: 400, retryCount: 0, parentJobId: job.id,
          // auth: authConfig
        },
        {
          id: `${JobType.PROJECT_PIPELINES}-${projectId}-${Date.now()}`,
          type: JobType.PROJECT_PIPELINES,
          resourceId: projectId,
          resourcePath: projectDetails.path_with_namespace,
          createdAt: new Date(), priority: 400, retryCount: 0, parentJobId: job.id,
          // auth: authConfig
        },
        {
          id: `${JobType.PROJECT_VULNERABILITIES}-${projectId}-${Date.now()}`,
          type: JobType.PROJECT_VULNERABILITIES,
          resourceId: projectId,
          resourcePath: projectDetails.path_with_namespace,
          createdAt: new Date(), priority: 300, retryCount: 0, parentJobId: job.id,
          // auth: authConfig
        }
      ];

      // Emit job completed event
      this.eventEmitter.emit({
        type: EventType.JOB_COMPLETED,
        timestamp: new Date(),
        job,
        result: { projectDetails },
        duration: Date.now() - startTime,
        discoveredJobs
      } as JobCompletedEvent);

      return {
        job,
        success: true,
        discoveredJobs,
        data: { projectDetails }
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to process details for project ${projectId}: ${errorMessage}`);
      throw error;
    }
  }

  async processProjectBranches(job: Job, authConfig: AuthConfig): Promise<JobResult> { // Renamed _authConfig
    const startTime = Date.now();
    const projectId = job.resourceId;
    logger.info(`Processing branches for project ${projectId}...`);

    // Create temporary API client
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');

    // Define type for branch details
    type GitLabBranch = { name: string; commit: { id: string }; [key: string]: any };

    try {
      const branches = await this.fetchPaginatedData<GitLabBranch>(
        JobType.PROJECT_BRANCHES,
        projectId,
        // Pass the temporary client to the fetch function
        (client, options) => this.getThrottledRequest(JobType.PROJECT_BRANCHES)(async () => (await client.Branches.all(projectId, options as any)) as unknown as GitLabBranch[]), // Double cast result
        jobApi // Pass the created client
      );

      // Save branches data
      await this.saveData(`projects/${projectId}/branches.jsonl`, branches);

      // No new jobs discovered from branches
      const discoveredJobs: Job[] = [];

      // Emit job completed event
      this.eventEmitter.emit({
        type: EventType.JOB_COMPLETED,
        timestamp: new Date(),
        job,
        result: { branchCount: branches.length },
        duration: Date.now() - startTime,
        discoveredJobs
      } as JobCompletedEvent);

      return {
        job,
        success: true,
        discoveredJobs,
        data: { branchCount: branches.length }
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to process branches for project ${projectId}: ${errorMessage}`);
      throw error;
    }
  }

  async processProjectMergeRequests(job: Job, authConfig: AuthConfig): Promise<JobResult> { // Renamed _authConfig
    const startTime = Date.now();
    const projectId = job.resourceId;
    logger.info(`Processing merge requests for project ${projectId}...`);

    // Create temporary API client
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');

    // Define type for merge request details (basic)
    type GitLabMergeRequestBasic = { id: number | string; iid: number; [key: string]: any };

    try {
      const mergeRequests = await this.fetchPaginatedData<GitLabMergeRequestBasic>(
        JobType.PROJECT_MERGE_REQUESTS,
        projectId,
        // Pass the temporary client to the fetch function
        (client, options) => this.getThrottledRequest(JobType.PROJECT_MERGE_REQUESTS)(async () => (await client.MergeRequests.all({ projectId: projectId, ...options })) as unknown as GitLabMergeRequestBasic[]), // Double cast result
        jobApi // Pass the created client
      );

      // Save merge requests data
      await this.saveData(`projects/${projectId}/merge_requests.jsonl`, mergeRequests);

      // Create jobs for merge request discussions for each discovered MR
      const discoveredJobs: Job[] = mergeRequests.map((mr: GitLabMergeRequestBasic) => ({
        id: `${JobType.MERGE_REQUEST_DISCUSSIONS}-${projectId}-${mr.iid}-${Date.now()}`,
        type: JobType.MERGE_REQUEST_DISCUSSIONS,
        resourceId: mr.id, // Use the global MR ID as resourceId
        resourcePath: `projects/${projectId}/merge_requests/${mr.iid}`, // Construct a path
        createdAt: new Date(),
        priority: 200, // Priority for MERGE_REQUEST_DISCUSSIONS
        retryCount: 0,
        parentJobId: job.id,
        data: { // Pass necessary IDs for the processor
            projectId: projectId,
            mergeRequestIid: mr.iid
        }
        // auth: authConfig // Optionally inherit auth
      }));

      // Emit job completed event
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

  async processProjectIssues(job: Job, authConfig: AuthConfig): Promise<JobResult> { // Renamed _authConfig
    const startTime = Date.now();
    const projectId = job.resourceId;
    logger.info(`Processing issues for project ${projectId}...`);

    // Create temporary API client
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');

    // Define type for issue details (basic)
    type GitLabIssueBasic = { id: number | string; iid: number; project_id: number; [key: string]: any };

    try {
      const issues = await this.fetchPaginatedData<GitLabIssueBasic>(
        JobType.PROJECT_ISSUES,
        projectId,
        // Pass the temporary client to the fetch function
        (client, options) => this.getThrottledRequest(JobType.PROJECT_ISSUES)(async () => (await client.Issues.all({ projectId: projectId, ...options })) as unknown as GitLabIssueBasic[]), // Double cast result
        jobApi // Pass the created client
      );

      // Save issues data
      await this.saveData(`projects/${projectId}/issues.jsonl`, issues);

      // Create jobs for issue discussions for each discovered issue
      const discoveredJobs: Job[] = issues.map((issue: GitLabIssueBasic) => ({
        id: `${JobType.ISSUE_DISCUSSIONS}-${projectId}-${issue.iid}-${Date.now()}`,
        type: JobType.ISSUE_DISCUSSIONS,
        resourceId: issue.id, // Use the global issue ID as resourceId
        resourcePath: `projects/${projectId}/issues/${issue.iid}`, // Construct a path
        createdAt: new Date(),
        priority: 200, // Priority for ISSUE_DISCUSSIONS
        retryCount: 0,
        parentJobId: job.id,
        data: { // Pass necessary IDs for the processor
            projectId: projectId,
            issueIid: issue.iid
        }
        // auth: authConfig // Optionally inherit auth
      }));

      // Emit job completed event
      this.eventEmitter.emit({
        type: EventType.JOB_COMPLETED,
        timestamp: new Date(),
        job,
        result: { issueCount: issues.length },
        duration: Date.now() - startTime,
        discoveredJobs
      } as JobCompletedEvent);

      return {
        job,
        success: true,
        discoveredJobs,
        data: { issueCount: issues.length }
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to process issues for project ${projectId}: ${errorMessage}`);
      throw error;
    }
  }

  async processProjectMilestones(job: Job, authConfig: AuthConfig): Promise<JobResult> { // Renamed _authConfig
    const startTime = Date.now();
    const projectId = job.resourceId;
    logger.info(`Processing milestones for project ${projectId}...`);

    // Create temporary API client
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');

    // Define type for milestone details
    type GitLabMilestone = { id: number | string; iid: number; title: string; [key: string]: any };

    try {
      const milestones = await this.fetchPaginatedData<GitLabMilestone>(
        JobType.PROJECT_MILESTONES,
        projectId,
        // Pass the temporary client to the fetch function
        (client, options) => this.getThrottledRequest(JobType.PROJECT_MILESTONES)(async () => (await client.ProjectMilestones.all(projectId, options as any)) as unknown as GitLabMilestone[]), // Double cast result
        jobApi // Pass the created client
      );

      // Save milestones data
      await this.saveData(`projects/${projectId}/milestones.jsonl`, milestones);

      // No new jobs discovered from milestones
      const discoveredJobs: Job[] = [];

      // Emit job completed event
      this.eventEmitter.emit({
        type: EventType.JOB_COMPLETED,
        timestamp: new Date(),
        job,
        result: { milestoneCount: milestones.length },
        duration: Date.now() - startTime,
        discoveredJobs
      } as JobCompletedEvent);

      return {
        job,
        success: true,
        discoveredJobs,
        data: { milestoneCount: milestones.length }
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to process milestones for project ${projectId}: ${errorMessage}`);
      throw error;
    }
  }

  async processProjectReleases(job: Job, authConfig: AuthConfig): Promise<JobResult> { // Renamed _authConfig
    const startTime = Date.now();
    const projectId = job.resourceId;
    logger.info(`Processing releases for project ${projectId}...`);

    // Create temporary API client
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');

    // Define type for release details
    type GitLabRelease = { tag_name: string; name: string; [key: string]: any };

    try {
      const releases = await this.fetchPaginatedData<GitLabRelease>(
        JobType.PROJECT_RELEASES,
        projectId,
        // Pass the temporary client to the fetch function
        (client, options) => this.getThrottledRequest(JobType.PROJECT_RELEASES)(async () => (await client.Releases.all(projectId, options as any)) as unknown as GitLabRelease[]), // Double cast result
        jobApi // Pass the created client
      );

      // Save releases data
      await this.saveData(`projects/${projectId}/releases.jsonl`, releases);

      // No new jobs discovered from releases
      const discoveredJobs: Job[] = [];

      // Emit job completed event
      this.eventEmitter.emit({
        type: EventType.JOB_COMPLETED,
        timestamp: new Date(),
        job,
        result: { releaseCount: releases.length },
        duration: Date.now() - startTime,
        discoveredJobs
      } as JobCompletedEvent);

      return {
        job,
        success: true,
        discoveredJobs,
        data: { releaseCount: releases.length }
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to process releases for project ${projectId}: ${errorMessage}`);
      throw error;
    }
  }

  async processProjectPipelines(job: Job, authConfig: AuthConfig): Promise<JobResult> { // Renamed _authConfig
    const startTime = Date.now();
    const projectId = job.resourceId;
    logger.info(`Processing pipelines for project ${projectId}...`);

    // Create temporary API client
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');

    // Define type for pipeline details (basic)
    type GitLabPipelineBasic = { id: number | string; status: string; ref: string; [key: string]: any };

    try {
      const pipelines = await this.fetchPaginatedData<GitLabPipelineBasic>(
        JobType.PROJECT_PIPELINES,
        projectId,
        // Pass the temporary client to the fetch function
        (client, options) => this.getThrottledRequest(JobType.PROJECT_PIPELINES)(async () => (await client.Pipelines.all(projectId, options as any)) as unknown as GitLabPipelineBasic[]), // Double cast result
        jobApi // Pass the created client
      );

      // Save pipelines data
      await this.saveData(`projects/${projectId}/pipelines.jsonl`, pipelines);

      // Create jobs for pipeline details and test reports for each discovered pipeline
      const discoveredJobs: Job[] = pipelines.flatMap((pipeline: GitLabPipelineBasic) => [
        {
          id: `${JobType.PIPELINE_DETAILS}-${projectId}-${pipeline.id}-${Date.now()}`,
          type: JobType.PIPELINE_DETAILS,
          resourceId: pipeline.id,
          resourcePath: `projects/${projectId}/pipelines/${pipeline.id}`,
          createdAt: new Date(),
          priority: 200, // Priority for PIPELINE_DETAILS
          retryCount: 0,
          parentJobId: job.id,
          data: { projectId: projectId }
          // auth: authConfig
        },
        {
          id: `${JobType.PIPELINE_TEST_REPORTS}-${projectId}-${pipeline.id}-${Date.now()}`,
          type: JobType.PIPELINE_TEST_REPORTS,
          resourceId: pipeline.id,
          resourcePath: `projects/${projectId}/pipelines/${pipeline.id}/test_report`,
          createdAt: new Date(),
          priority: 100, // Priority for PIPELINE_TEST_REPORTS
          retryCount: 0,
          parentJobId: job.id,
          data: { projectId: projectId }
          // auth: authConfig
        }
      ]);

      // Emit job completed event
      this.eventEmitter.emit({
        type: EventType.JOB_COMPLETED,
        timestamp: new Date(),
        job,
        result: { pipelineCount: pipelines.length },
        duration: Date.now() - startTime,
        discoveredJobs
      } as JobCompletedEvent);

      return {
        job,
        success: true,
        discoveredJobs,
        data: { pipelineCount: pipelines.length }
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to process pipelines for project ${projectId}: ${errorMessage}`);
      throw error;
    }
  }

   async processProjectVulnerabilities(job: Job, authConfig: AuthConfig): Promise<JobResult> { // Renamed _authConfig
    const startTime = Date.now();
    const projectId = job.resourceId;
    logger.info(`Processing vulnerabilities for project ${projectId}...`);

    // Create temporary API client
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');

    // Define type for vulnerability finding details
    type GitLabVulnerabilityFinding = { id: number | string; name: string; severity: string; [key: string]: any };

    try {
      // Note: VulnerabilityFindings API might require specific permissions/features enabled on GitLab
      const vulnerabilities = await this.fetchPaginatedData<GitLabVulnerabilityFinding>(
        JobType.PROJECT_VULNERABILITIES,
        projectId,
        // Pass the temporary client to the fetch function
        (client, options) => this.getThrottledRequest(JobType.PROJECT_VULNERABILITIES)(async () => (await client.VulnerabilityFindings.all(projectId, options as any)) as unknown as GitLabVulnerabilityFinding[]), // Pass projectId as first arg, double cast result
        jobApi // Pass the created client
      );

      // Save vulnerabilities data
      await this.saveData(`projects/${projectId}/vulnerabilities.jsonl`, vulnerabilities);

      // No new jobs discovered from vulnerabilities
      const discoveredJobs: Job[] = [];

      // Emit job completed event
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
      // Handle cases where vulnerability scanning might not be enabled/available
      if (errorMessage.includes('403') || errorMessage.includes('forbidden') || errorMessage.includes('not found') || errorMessage.includes('404')) {
         logger.warn(`Could not fetch vulnerabilities for project ${projectId} (status: ${errorMessage}). Feature might be disabled or permissions missing.`);
         this.eventEmitter.emit({
            type: EventType.JOB_COMPLETED,
            timestamp: new Date(),
            job,
            result: { vulnerabilityCount: 0, skipped: true, reason: errorMessage },
            duration: Date.now() - startTime,
            discoveredJobs: []
         } as JobCompletedEvent);
         return { job, success: true, data: { vulnerabilityCount: 0, skipped: true, reason: errorMessage } };
      }
      logger.error(`Failed to process vulnerabilities for project ${projectId}: ${errorMessage}`);
      throw error;
    }
  }

  async processMergeRequestDiscussions(job: Job, authConfig: AuthConfig): Promise<JobResult> { // Renamed _authConfig
    const startTime = Date.now();
    const projectId = job.data?.projectId;
    const mergeRequestIid = job.data?.mergeRequestIid;

    if (!projectId || !mergeRequestIid) {
      throw new Error(`Missing projectId or mergeRequestIid in job data for job ${job.id}`);
    }

    logger.info(`Processing discussions for MR !${mergeRequestIid} in project ${projectId}...`);

    // Create temporary API client
    const jobApi = createGitLabClient(this.gitlabUrl, authConfig.oauthToken || '');

    // Define type for discussion details
    type GitLabDiscussion = { id: string; notes: any[]; [key: string]: any };

    try {
      const discussions = await this.fetchPaginatedData<GitLabDiscussion>(
        JobType.MERGE_REQUEST_DISCUSSIONS,
        `${projectId}-mr-${mergeRequestIid}`, // Composite resource ID for cursor tracking
        // Pass the temporary client to the fetch function
        (client, options) => this.getThrottledRequest(JobType.MERGE_REQUEST_DISCUSSIONS)(async () => (await client.MergeRequestDiscussions.all(projectId, mergeRequestIid, options as any)) as unknown as GitLabDiscussion[]), // Double cast result
        jobApi // Pass the created client
      );

      // Save discussions data
      await this.saveData(`projects/${projectId}/merge_requests/${mergeRequestIid}/discussions.jsonl`, discussions);

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
      logger.error(`Failed to process discussions for MR !${mergeRequestIid} in project ${projectId}: ${errorMessage}`);
      throw error;
    }
  }

  async processIssueDiscussions(job: Job, _authConfig: AuthConfig): Promise<JobResult> {
    logger.warn(`Processor for ${job.type} not fully implemented.`);
    // Requires projectId and issueIid from job.data
    // Use jobApi.IssueDiscussions.all(projectId, issueIid, options)
    // Save to projects/${projectId}/issues/${issueIid}/discussions.jsonl
    return { job, success: true, data: { note: 'Not implemented' } };
  }

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

      // Bind placeholder implementations
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