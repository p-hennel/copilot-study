/**
 * Job and resource type definitions for the GitLab crawler
 * 
 * @packageDocumentation
 */

import type { AuthConfig } from "./config-types";

/**
 * Enum defining all possible job types in the GitLab crawler
 */
export enum JobType {
  // Discovery jobs
  DISCOVER_GROUPS = 'DISCOVER_GROUPS',
  DISCOVER_PROJECTS = 'DISCOVER_PROJECTS',
  DISCOVER_SUBGROUPS = 'DISCOVER_SUBGROUPS',
  
  // Group jobs
  GROUP_DETAILS = 'GROUP_DETAILS',
  GROUP_MEMBERS = 'GROUP_MEMBERS',
  GROUP_PROJECTS = 'GROUP_PROJECTS',
  GROUP_ISSUES = 'GROUP_ISSUES',
  
  // Project jobs
  PROJECT_DETAILS = 'PROJECT_DETAILS',
  PROJECT_BRANCHES = 'PROJECT_BRANCHES',
  PROJECT_MERGE_REQUESTS = 'PROJECT_MERGE_REQUESTS',
  PROJECT_ISSUES = 'PROJECT_ISSUES',
  PROJECT_MILESTONES = 'PROJECT_MILESTONES',
  PROJECT_RELEASES = 'PROJECT_RELEASES',
  PROJECT_PIPELINES = 'PROJECT_PIPELINES',
  PROJECT_VULNERABILITIES = 'PROJECT_VULNERABILITIES',
  
  // Detail jobs
  MERGE_REQUEST_DISCUSSIONS = 'MERGE_REQUEST_DISCUSSIONS',
  ISSUE_DISCUSSIONS = 'ISSUE_DISCUSSIONS',
  PIPELINE_DETAILS = 'PIPELINE_DETAILS',
  PIPELINE_TEST_REPORTS = 'PIPELINE_TEST_REPORTS',
}

/**
 * Defines the structure of a crawling job
 */
export interface Job {
  /**
   * Unique identifier for the job
   */
  id: string;
  
  /**
   * The type of job to execute
   */
  type: JobType;
  
  /**
   * The resource identifier (groupId, projectId, etc.)
   */
  resourceId: string | number;
  
  /**
   * Optional resource path (e.g., full_path for groups/projects)
   */
  resourcePath?: string;
  
  /**
   * Additional data needed for job execution
   */
  data?: Record<string, any>;
  
  /**
   * Creation timestamp
   */
  createdAt: Date;
  
  /**
   * Priority (higher number = higher priority)
   */
  priority: number;
  
  /**
   * Retry count
   */
  retryCount: number;
  
  /**
   * Parent job ID (if this job was created as a result of another job)
   */
  parentJobId?: string;

  auth?: AuthConfig
}

/**
 * Defines job execution result
 */
export interface JobResult {
  /**
   * The job that was executed
   */
  job: Job;
  
  /**
   * Whether the job succeeded
   */
  success: boolean;
  
  /**
   * Any error message if the job failed
   */
  error?: string;
  
  /**
   * New jobs discovered during execution
   */
  discoveredJobs?: Job[];
  
  /**
   * Data produced by the job
   */
  data?: any;
}

/**
 * Job status in the registry
 */
export enum JobStatus {
  /**
   * Job is pending execution
   */
  PENDING = 'PENDING',
  
  /**
   * Job is currently running
   */
  RUNNING = 'RUNNING',
  
  /**
   * Job has completed successfully
   */
  COMPLETED = 'COMPLETED',
  
  /**
   * Job has failed
   */
  FAILED = 'FAILED',
}

/**
 * Registered job with status information
 */
export interface RegisteredJob extends Job {
  /**
   * Current status of the job
   */
  status: JobStatus;
  
  /**
   * Last update timestamp
   */
  lastUpdated: Date;
  
  /**
   * Number of execution attempts
   */
  attempts: number;
  
  /**
   * Job result (if completed or failed)
   */
  result?: JobResult;
}

/**
 * Defines job dependencies for each job type
 */
export const JOB_DEPENDENCIES: Record<JobType, JobType[]> = {
  // Discovery jobs have no dependencies
  [JobType.DISCOVER_GROUPS]: [],
  [JobType.DISCOVER_PROJECTS]: [],
  [JobType.DISCOVER_SUBGROUPS]: [JobType.GROUP_DETAILS],
  
  // Group jobs
  [JobType.GROUP_DETAILS]: [JobType.DISCOVER_GROUPS],
  [JobType.GROUP_MEMBERS]: [JobType.GROUP_DETAILS],
  [JobType.GROUP_PROJECTS]: [JobType.GROUP_DETAILS],
  [JobType.GROUP_ISSUES]: [JobType.GROUP_DETAILS],
  
  // Project jobs
  [JobType.PROJECT_DETAILS]: [JobType.DISCOVER_PROJECTS],
  [JobType.PROJECT_BRANCHES]: [JobType.PROJECT_DETAILS],
  [JobType.PROJECT_MERGE_REQUESTS]: [JobType.PROJECT_DETAILS],
  [JobType.PROJECT_ISSUES]: [JobType.PROJECT_DETAILS],
  [JobType.PROJECT_MILESTONES]: [JobType.PROJECT_DETAILS],
  [JobType.PROJECT_RELEASES]: [JobType.PROJECT_DETAILS],
  [JobType.PROJECT_PIPELINES]: [JobType.PROJECT_DETAILS],
  [JobType.PROJECT_VULNERABILITIES]: [JobType.PROJECT_DETAILS],
  
  // Detail jobs
  [JobType.MERGE_REQUEST_DISCUSSIONS]: [JobType.PROJECT_MERGE_REQUESTS],
  [JobType.ISSUE_DISCUSSIONS]: [JobType.PROJECT_ISSUES],
  [JobType.PIPELINE_DETAILS]: [JobType.PROJECT_PIPELINES],
  [JobType.PIPELINE_TEST_REPORTS]: [JobType.PIPELINE_DETAILS],
};

/**
 * Defines the priority level for each job type (higher = more important)
 */
export const JOB_PRIORITIES: Record<JobType, number> = {
  // Discovery jobs have highest priority
  [JobType.DISCOVER_GROUPS]: 1000,
  [JobType.DISCOVER_PROJECTS]: 900,
  [JobType.DISCOVER_SUBGROUPS]: 800,
  
  // Group jobs
  [JobType.GROUP_DETAILS]: 700,
  [JobType.GROUP_MEMBERS]: 600,
  [JobType.GROUP_PROJECTS]: 600,
  [JobType.GROUP_ISSUES]: 500,
  
  // Project jobs
  [JobType.PROJECT_DETAILS]: 700,
  [JobType.PROJECT_BRANCHES]: 500,
  [JobType.PROJECT_MERGE_REQUESTS]: 500,
  [JobType.PROJECT_ISSUES]: 500,
  [JobType.PROJECT_MILESTONES]: 400,
  [JobType.PROJECT_RELEASES]: 400,
  [JobType.PROJECT_PIPELINES]: 400,
  [JobType.PROJECT_VULNERABILITIES]: 300,
  
  // Detail jobs have lowest priority
  [JobType.MERGE_REQUEST_DISCUSSIONS]: 200,
  [JobType.ISSUE_DISCUSSIONS]: 200,
  [JobType.PIPELINE_DETAILS]: 200,
  [JobType.PIPELINE_TEST_REPORTS]: 100,
};

/**
 * Job categories for logical grouping
 */
export enum JobCategory {
  /**
   * Discovery jobs find resources to crawl
   */
  DISCOVERY = 'DISCOVERY',
  
  /**
   * Group jobs process group-related data
   */
  GROUP = 'GROUP',
  
  /**
   * Project jobs process project-related data
   */
  PROJECT = 'PROJECT',
  
  /**
   * Detail jobs process detailed resource data
   */
  DETAIL = 'DETAIL',
}

/**
 * Map job types to categories
 */
export const JOB_CATEGORIES: Record<JobType, JobCategory> = {
  // Discovery jobs
  [JobType.DISCOVER_GROUPS]: JobCategory.DISCOVERY,
  [JobType.DISCOVER_PROJECTS]: JobCategory.DISCOVERY,
  [JobType.DISCOVER_SUBGROUPS]: JobCategory.DISCOVERY,
  
  // Group jobs
  [JobType.GROUP_DETAILS]: JobCategory.GROUP,
  [JobType.GROUP_MEMBERS]: JobCategory.GROUP,
  [JobType.GROUP_PROJECTS]: JobCategory.GROUP,
  [JobType.GROUP_ISSUES]: JobCategory.GROUP,
  
  // Project jobs
  [JobType.PROJECT_DETAILS]: JobCategory.PROJECT,
  [JobType.PROJECT_BRANCHES]: JobCategory.PROJECT,
  [JobType.PROJECT_MERGE_REQUESTS]: JobCategory.PROJECT,
  [JobType.PROJECT_ISSUES]: JobCategory.PROJECT,
  [JobType.PROJECT_MILESTONES]: JobCategory.PROJECT,
  [JobType.PROJECT_RELEASES]: JobCategory.PROJECT,
  [JobType.PROJECT_PIPELINES]: JobCategory.PROJECT,
  [JobType.PROJECT_VULNERABILITIES]: JobCategory.PROJECT,
  
  // Detail jobs
  [JobType.MERGE_REQUEST_DISCUSSIONS]: JobCategory.DETAIL,
  [JobType.ISSUE_DISCUSSIONS]: JobCategory.DETAIL,
  [JobType.PIPELINE_DETAILS]: JobCategory.DETAIL,
  [JobType.PIPELINE_TEST_REPORTS]: JobCategory.DETAIL,
};

/**
 * Job queue options
 */
export interface JobQueueOptions {
  /**
   * Maximum number of concurrent jobs
   */
  concurrency: number;
  
  /**
   * Maximum retry attempts for failed jobs
   */
  maxRetries: number;
  
  /**
   * Delay between retry attempts in milliseconds
   */
  retryDelayMs: number;
}

/**
 * Resource type mapping to GitLab API endpoints
 */
export const RESOURCE_ENDPOINTS: Record<string, string> = {
  'group': 'groups',
  'project': 'projects',
  'user': 'users',
  'merge_request': 'merge_requests',
  'issue': 'issues',
  'pipeline': 'pipelines',
  'branch': 'repository/branches',
  'release': 'releases',
  'milestone': 'milestones',
  'group_member': 'members',
  'project_member': 'members',
  'vulnerability': 'vulnerability_findings',
};

/**
 * Job processor function type
 */
export type JobProcessor = (job: Job, authConfig: AuthConfig) => Promise<JobResult>;

/**
 * Map of job types to processor functions
 */
export type ProcessorMap = Record<JobType, JobProcessor>;