export * from './messages';
export * from './database';
export * from './config';
export * from './connection';

// Import shared types from lib-common
export type { 
  EntityType,
  GitLabTaskType,
  SocketMessage,
  MessageType,
  JobStatus,
  TokenProvider,
  HeartbeatData,
  ProgressData as SharedProgressData,
  CompletionData,
  FailureData,
  DiscoveryData,
  TokenRefreshResponseData,
  JobAssignmentData,
  MessageProcessingResult as SharedMessageProcessingResult
} from '@copima/lib-common';

// Re-export commonly used types with better names
export type { 
  SocketServerConfig,
  ConfigValidationResult,
  EnvironmentConfig 
} from './config';

export type {
  CrawlerMessage,
  WebAppMessage,
  BaseMessage,
  ProgressData,
  MessageProcessingResult
} from './messages';

export type {
  SocketConnection,
  ConnectionPool,
  ConnectionState,
  ConnectionEvent,
  ConnectionEventHandler
} from './connection';

export type {
  ProgressTracker,
  ProgressAggregator,
  JobProgress,
  ProgressState
} from './progress';

export type {
  ErrorManager,
  SocketError,
  ErrorHandlingResult,
  ErrorCategory,
  ErrorSeverity
} from './errors';

export type {
  Job,
  Area,
  SocketDatabaseOperations,
  JobQueueOperations,
  ConnectionStateOperations
} from './database';

// EntityType is now imported from @copima/lib-common above
