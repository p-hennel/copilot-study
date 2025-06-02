import type { JobStatus, CrawlCommand } from "$lib/types";

// Enhanced query parameters for jobs API
export interface JobsQueryParams {
  // Pagination
  page?: number;
  limit?: number;
  
  // Sorting
  sortBy?: 'created' | 'updated' | 'started' | 'finished' | 'id' | 'parent' | 'status' | 'command';
  sortOrder?: 'asc' | 'desc';
  
  // Filtering
  command?: CrawlCommand | CrawlCommand[];
  status?: JobStatus | JobStatus[];
  hasStarted?: boolean;
  hasFinished?: boolean;
  hasParent?: boolean;
  
  // Searching
  search?: string;
  dateSearch?: string;
  dateField?: 'created' | 'updated' | 'started' | 'finished';
}

// Response types
export interface JobInformation {
  id: string;
  created_at: Date;
  updated_at?: Date;
  started_at?: Date;
  finished_at?: Date;
  status: JobStatus;
  command: CrawlCommand;
  full_path?: string;
  branch?: string;
  from?: Date;
  to?: Date;
  accountId: string;
  spawned_from?: string;
  resumeState?: any;
  progress?: any;
  userId?: string;
  provider?: string;
  gitlabGraphQLUrl?: string;
  
  // Relations
  forArea?: {
    full_path: string;
    gitlab_id: string;
    name?: string;
    type: string;
    created_at: Date;
  };
  fromJob?: {
    id: string;
    command: CrawlCommand;
    status: JobStatus;
    started_at?: Date;
    finished_at?: Date;
    created_at: Date;
    updated_at?: Date;
  };
  childrenCount: number;
}

export interface PaginationInfo {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface JobsApiResponse {
  data: JobInformation[];
  pagination: PaginationInfo;
}

// API error response
export interface JobsApiError {
  error: string;
  details?: any;
}

// Utility types for building API URLs
export type JobsSortField = NonNullable<JobsQueryParams['sortBy']>;
export type JobsSortOrder = NonNullable<JobsQueryParams['sortOrder']>;
export type JobsDateField = NonNullable<JobsQueryParams['dateField']>;

// Helper functions for URL building
export function buildJobsApiUrl(baseUrl: string, params: JobsQueryParams): string {
  const url = new URL(`${baseUrl}/api/admin/jobs`);
  
  // Add pagination
  if (params.page && params.page > 1) {
    url.searchParams.set('page', params.page.toString());
  }
  if (params.limit && params.limit !== 25) {
    url.searchParams.set('limit', params.limit.toString());
  }
  
  // Add sorting
  if (params.sortBy && params.sortBy !== 'created') {
    url.searchParams.set('sortBy', params.sortBy);
  }
  if (params.sortOrder && params.sortOrder !== 'desc') {
    url.searchParams.set('sortOrder', params.sortOrder);
  }
  
  // Add filters
  if (params.command) {
    const commands = Array.isArray(params.command) ? params.command : [params.command];
    url.searchParams.set('command', commands.join(','));
  }
  if (params.status) {
    const statuses = Array.isArray(params.status) ? params.status : [params.status];
    url.searchParams.set('status', statuses.join(','));
  }
  if (params.hasStarted !== undefined) {
    url.searchParams.set('hasStarted', params.hasStarted.toString());
  }
  if (params.hasFinished !== undefined) {
    url.searchParams.set('hasFinished', params.hasFinished.toString());
  }
  if (params.hasParent !== undefined) {
    url.searchParams.set('hasParent', params.hasParent.toString());
  }
  
  // Add search
  if (params.search) {
    url.searchParams.set('search', params.search);
  }
  if (params.dateSearch) {
    url.searchParams.set('dateSearch', params.dateSearch);
  }
  if (params.dateField && params.dateField !== 'created') {
    url.searchParams.set('dateField', params.dateField);
  }
  
  return url.toString();
}

// Helper for parsing URL parameters back to JobsQueryParams
export function parseJobsApiParams(searchParams: URLSearchParams): JobsQueryParams {
  const params: JobsQueryParams = {};
  
  // Parse pagination
  const page = searchParams.get('page');
  if (page) params.page = parseInt(page, 10);
  
  const limit = searchParams.get('limit');
  if (limit) params.limit = parseInt(limit, 10);
  
  // Parse sorting
  const sortBy = searchParams.get('sortBy') as JobsSortField;
  if (sortBy) params.sortBy = sortBy;
  
  const sortOrder = searchParams.get('sortOrder') as JobsSortOrder;
  if (sortOrder) params.sortOrder = sortOrder;
  
  // Parse filters
  const command = searchParams.get('command');
  if (command) {
    params.command = command.includes(',') 
      ? command.split(',').map(c => c.trim() as CrawlCommand)
      : command as CrawlCommand;
  }
  
  const status = searchParams.get('status');
  if (status) {
    params.status = status.includes(',')
      ? status.split(',').map(s => s.trim() as JobStatus)
      : status as JobStatus;
  }
  
  const hasStarted = searchParams.get('hasStarted');
  if (hasStarted) params.hasStarted = hasStarted === 'true';
  
  const hasFinished = searchParams.get('hasFinished');
  if (hasFinished) params.hasFinished = hasFinished === 'true';
  
  const hasParent = searchParams.get('hasParent');
  if (hasParent) params.hasParent = hasParent === 'true';
  
  // Parse search
  const search = searchParams.get('search');
  if (search) params.search = search;
  
  const dateSearch = searchParams.get('dateSearch');
  if (dateSearch) params.dateSearch = dateSearch;
  
  const dateField = searchParams.get('dateField') as JobsDateField;
  if (dateField) params.dateField = dateField;
  
  return params;
}