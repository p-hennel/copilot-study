/**
 * Defines the payload structure received from the backend
 * when starting a new crawl job.
 */
export interface JobPayload {
  /** The unique identifier for the job (managed by the backend). */
  jobId: string;
  /** The GitLab path (e.g., 'group/project' or 'group') to crawl. */
  gitlabPath: string;
  /** The OAuth token for accessing the GitLab API. */
  gitlabToken: string;
  /** List of specific data types to fetch for this job. */
  dataTypes: string[]; // e.g., ['issues', 'members', 'mergeRequests']
  /** Base directory where data should be stored. */
  storageBasePath: string; // Example: '/app/data' or './crawler_data'
}

/**
 * Represents the state that needs to be saved/loaded for resuming
 * a specific data type fetcher (e.g., pagination cursor).
 */
export interface FetcherState {
  [key: string]: any; // Flexible structure, often just { cursor: string | null }
}

/**
 * Represents the overall state of a job, potentially containing
 * states for multiple data types.
 */
export interface JobState {
  [dataType: string]: FetcherState;
}
