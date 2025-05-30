/**
 * GitLab Crawler API v2 Type Definitions
 * 
 * This file contains all TypeScript interfaces and types for the 
 * /api/internal2/ API system used for GitLab crawler communication.
 */

// ==================== GitLab Task Types ====================

export type GitLabTaskType = 
  | "DISCOVER_AREAS"
  | "FETCH_PROJECTS" 
  | "FETCH_GROUPS"
  | "FETCH_PROJECT_DETAILS"
  | "FETCH_GROUP_DETAILS"
  | "FETCH_PROJECT_MEMBERS"
  | "FETCH_GROUP_MEMBERS"
  | "FETCH_ISSUES"
  | "FETCH_MERGE_REQUESTS"
  | "FETCH_COMMITS"
  | "FETCH_BRANCHES"
  | "FETCH_TAGS"
  | "FETCH_PIPELINES"
  | "FETCH_JOBS"
  | "FETCH_DEPLOYMENTS"
  | "FETCH_ENVIRONMENTS"
  | "FETCH_VULNERABILITIES";

export type UpdateType = 
  | "progress"
  | "status" 
  | "error"
  | "completed"
  | "failed"
  | "started"
  | "paused"
  | "resumed";

// ==================== Incoming Messages (from GitLab Crawler) ====================

export interface CrawlerTaskRequest {
  type: "task";
  data: {
    id: string;
    type: GitLabTaskType;
    credentials: {
      accessToken: string;
      refreshToken?: string;
      tokenType?: "oauth2" | "pat";
      expiresAt?: string;
    };
    apiEndpoint: string;
    rateLimits?: {
      requestsPerMinute?: number;
      requestsPerHour?: number;
      burstLimit?: number;
      respectRetryAfter?: boolean;
    };
    options?: {
      resourceId?: string | number;
      resourceType?: "project" | "group" | "user" | "instance";
      branch?: string;
      fromDate?: string;
      toDate?: string;
      pagination?: {
        pageSize?: number;
        maxPages?: number;
        cursor?: string;
      };
      filters?: Record<string, any>;
      outputFormat?: "json" | "csv" | "xml";
      includeMetadata?: boolean;
    };
  };
}

export interface CrawlerProgressUpdate {
  type: "progress";
  data: {
    taskId: string;
    processed?: number;
    total?: number;
    currentStep?: string;
    percentage?: number;
    message?: string;
    metadata?: Record<string, any>;
    timestamp: string;
  };
}

export interface CrawlerStatusUpdate {
  type: "status";
  data: {
    taskId: string;
    status: "started" | "running" | "completed" | "failed" | "paused" | "resumed";
    timestamp: string;
    message?: string;
    error?: string;
    resumeState?: any;
  };
}

export interface CrawlerErrorReport {
  type: "error";
  data: {
    taskId: string;
    error: string | {
      code: string;
      message: string;
      details?: any;
      retryable?: boolean;
      severity?: "low" | "medium" | "high" | "critical";
    };
    timestamp: string;
    context?: Record<string, any>;
  };
}

export interface CrawlerHeartbeat {
  type: "heartbeat";
  data: {
    clientId: string;
    timestamp: string;
    activeTasks: string[];
    systemInfo?: {
      memoryUsage?: number;
      cpuUsage?: number;
      version?: string;
    };
  };
}

// Union type for all incoming crawler messages
export type CrawlerMessage = 
  | CrawlerTaskRequest
  | CrawlerProgressUpdate 
  | CrawlerStatusUpdate
  | CrawlerErrorReport
  | CrawlerHeartbeat;

// ==================== Outgoing Messages (to GitLab Crawler) ====================

export interface ServerTaskAssignment {
  type: "task_assignment";
  data: {
    taskId: string;
    type: GitLabTaskType;
    credentials: {
      accessToken: string;
      refreshToken?: string;
      tokenType: "oauth2" | "pat";
      clientId?: string;
      clientSecret?: string;
    };
    apiEndpoint: string;
    resourceId?: string | number;
    resourceType?: "project" | "group" | "user" | "instance";
    dataTypes: string[];
    outputConfig: {
      storageType: "filesystem" | "database" | "s3";
      basePath?: string;
      format: "json" | "csv" | "xml";
    };
    options?: {
      branch?: string;
      fromDate?: string;
      toDate?: string;
      pagination?: {
        pageSize?: number;
        maxPages?: number;
      };
      rateLimits?: {
        requestsPerMinute?: number;
        requestsPerHour?: number;
      };
      customParameters?: Record<string, any>;
    };
    resumeState?: any;
    priority?: "low" | "normal" | "high" | "urgent";
    timeout?: number;
    retryConfig?: {
      maxRetries?: number;
      backoffStrategy?: "linear" | "exponential";
      retryableErrors?: string[];
    };
  };
}

export interface ServerTaskUpdate {
  type: "task_update";
  data: {
    taskId: string;
    updateType: UpdateType;
    message?: string;
    timestamp: string;
    serverGenerated: boolean;
  };
}

export interface ServerTaskCancellation {
  type: "task_cancellation";
  data: {
    taskId: string;
    reason: string;
    timestamp: string;
    graceful: boolean;
  };
}

export interface ServerSystemMessage {
  type: "system";
  data: {
    messageType: "shutdown" | "maintenance" | "config_update" | "rate_limit_update";
    message: string;
    timestamp: string;
    metadata?: Record<string, any>;
    actionRequired?: boolean;
  };
}

export interface ServerHeartbeatResponse {
  type: "heartbeat_response";
  data: {
    serverTime: string;
    acknowledgement: string;
    tasksQueued: number;
    systemStatus: "healthy" | "degraded" | "maintenance";
  };
}

// Union type for all outgoing server messages
export type ServerMessage = 
  | ServerTaskAssignment
  | ServerTaskUpdate
  | ServerTaskCancellation
  | ServerSystemMessage
  | ServerHeartbeatResponse;

// ==================== API Response Types ====================

export interface TaskResponse {
  id: string;
  type: GitLabTaskType;
  status: "queued" | "running" | "completed" | "failed" | "paused";
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  progress?: {
    processed?: number;
    total?: number;
    percentage?: number;
    currentStep?: string;
    message?: string;
  };
  error?: string;
  metadata?: {
    resourceId?: string;
    resourceType?: string;
    apiEndpoint?: string;
    branch?: string;
    fromDate?: string;
    toDate?: string;
    priority?: string;
    estimatedDuration?: number;
    actualDuration?: number;
  };
}

export interface TaskListResponse {
  data: TaskResponse[];
  meta: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
    filters?: {
      status?: string;
      type?: string;
      fromDate?: string;
      toDate?: string;
    };
  };
}

export interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  version: string;
  uptime: number;
  responseTime?: number;
  services: {
    database: {
      status: "up" | "down" | "degraded";
      responseTime?: number;
      error?: string;
    };
    authentication: {
      status: "up" | "down" | "degraded";
      configured: boolean;
    };
    jobProcessor: {
      status: "up" | "down" | "degraded";
      activeJobs: number;
      queuedJobs: number;
      failedJobs: number;
      recentCompletions: number;
    };
    websockets: {
      status: "up" | "down" | "degraded";
      activeConnections: number;
      supportEnabled: boolean;
    };
  };
  system?: {
    nodeVersion: string;
    memoryUsage: {
      used: number;
      free: number;
      total: number;
    };
    diskSpace?: {
      used: number;
      free: number;
      total: number;
    };
  };
  configuration?: {
    crawlerApiTokenConfigured: boolean;
    databasePath: string;
    archivePath: string;
    environment: string;
  };
}

export interface ConnectionResponse {
  status: "connection_ready" | "connection_failed" | "ready";
  connectionId?: string;
  taskId?: string;
  message: string;
  timestamp?: string;
  serverCapabilities?: {
    messageQueuing: boolean;
    heartbeat: boolean;
    reconnection: boolean;
    protocolVersion: string;
  };
  taskInfo?: {
    status: string;
    command: string;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
  };
  capabilities?: {
    progressUpdates: boolean;
    statusUpdates: boolean;
    errorReporting: boolean;
    realTimeMessages: boolean;
  };
  endpoints?: {
    websocket: string;
    tasks: string;
    health: string;
  };
  connectionInfo?: {
    connectionId: string;
    serverTime: string;
    activeConnections: number;
    maxConnections: number;
    supportedProtocols: string[];
    heartbeatInterval: number;
  };
}

// ==================== Generic API Response Wrapper ====================

export interface APIResponse<T = any> {
  data?: T;
  error?: string;
  status?: number;
  message?: string;
  timestamp?: string;
  requestId?: string;
}

export interface APIErrorResponse {
  error: string;
  status: number;
  timestamp?: string;
  details?: any;
  code?: string;
  retryable?: boolean;
}

// ==================== WebSocket Protocol Types ====================

export interface WebSocketMessage {
  id?: string;
  type: string;
  data: any;
  timestamp: string;
  connectionId?: string;
  taskId?: string;
}

export interface WebSocketConnectionInfo {
  connectionId: string;
  taskId?: string;
  clientType: "gitlab-crawler" | "web-client" | "monitor";
  connectedAt: string;
  lastActivity: string;
  subscriptions: string[];
}

// ==================== Configuration Types ====================

export interface CrawlerAPIConfig {
  version: "2.0";
  endpoints: {
    connect: string;
    tasks: string;
    health: string;
  };
  authentication: {
    type: "bearer" | "query" | "header";
    tokenRequired: boolean;
  };
  rateLimits: {
    requestsPerMinute: number;
    burstLimit: number;
  };
  websocket: {
    enabled: boolean;
    heartbeatInterval: number;
    maxConnections: number;
  };
  features: {
    taskQueuing: boolean;
    progressTracking: boolean;
    errorReporting: boolean;
    healthMonitoring: boolean;
  };
}

// ==================== Utility Types ====================

export type RequestMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface RequestOptions {
  method: RequestMethod;
  headers?: Record<string, string>;
  body?: any;
  timeout?: number;
  retries?: number;
}

export interface PaginationOptions {
  limit?: number;
  offset?: number;
  cursor?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface FilterOptions {
  status?: string | string[];
  type?: string | string[];
  fromDate?: string;
  toDate?: string;
  resourceType?: string;
  priority?: string;
}
