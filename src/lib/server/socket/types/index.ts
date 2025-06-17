export * from './messages';
export * from './database';
export * from './config';
export * from './connection';

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

export type EntityType = 
  | 'areas'      // Special type for GROUP_PROJECT_DISCOVERY (discovers both groups and projects)
  | 'project'
  | 'group'
  | 'user'
  | 'issue'
  | 'merge_request'
  | 'commit'
  | 'branch'
  | 'pipeline'
  | 'release';
