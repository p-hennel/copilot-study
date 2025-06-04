// Error severity levels
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

// Error categories
export enum ErrorCategory {
  CONNECTION = 'connection',
  MESSAGE_PARSING = 'message_parsing',
  MESSAGE_VALIDATION = 'message_validation',
  DATABASE = 'database',
  JOB_PROCESSING = 'job_processing',
  AUTHENTICATION = 'authentication',
  RATE_LIMITING = 'rate_limiting',
  NETWORK = 'network',
  TIMEOUT = 'timeout',
  RESOURCE = 'resource',
  CONFIGURATION = 'configuration',
  INTERNAL = 'internal',
}

// Base error interface
export interface BaseSocketError {
  id: string;
  timestamp: Date;
  category: ErrorCategory;
  severity: ErrorSeverity;
  message: string;
  code?: string;
  details?: Record<string, any>;
  stack?: string;
  connectionId?: string;
  jobId?: string;
  crawlerId?: string;
  accountId?: string;
  userId?: string;
}

// Specific error types
export interface ConnectionError extends BaseSocketError {
  category: ErrorCategory.CONNECTION;
  connectionId: string;
  remoteAddress?: string;
  connectionAttempt?: number;
  lastSuccessfulConnection?: Date;
}

export interface MessageError extends BaseSocketError {
  category: ErrorCategory.MESSAGE_PARSING | ErrorCategory.MESSAGE_VALIDATION;
  messageType?: string;
  messageSize?: number;
  validationErrors?: string[];
  rawMessage?: string;
}

export interface DatabaseError extends BaseSocketError {
  category: ErrorCategory.DATABASE;
  query?: string;
  table?: string;
  operation?: 'select' | 'insert' | 'update' | 'delete' | 'transaction';
  transactionId?: string;
}

export interface JobProcessingError extends BaseSocketError {
  category: ErrorCategory.JOB_PROCESSING;
  jobId: string;
  jobType?: string;
  processingStage?: string;
  retryCount?: number;
  maxRetries?: number;
  isRecoverable?: boolean;
}

export interface AuthenticationError extends BaseSocketError {
  category: ErrorCategory.AUTHENTICATION;
  authType?: string;
  credentials?: Record<string, any>;
  expectedPermissions?: string[];
}

export interface RateLimitError extends BaseSocketError {
  category: ErrorCategory.RATE_LIMITING;
  action: string;
  currentUsage: number;
  limit: number;
  resetTime: Date;
  windowSize: number;
}

export interface TimeoutError extends BaseSocketError {
  category: ErrorCategory.TIMEOUT;
  operation: string;
  timeoutValue: number;
  actualDuration: number;
}

export interface ResourceError extends BaseSocketError {
  category: ErrorCategory.RESOURCE;
  resourceType: 'memory' | 'cpu' | 'disk' | 'network' | 'connections';
  currentUsage: number;
  limit: number;
  threshold?: number;
}

// Union type for all socket errors
export type SocketError = 
  | ConnectionError
  | MessageError
  | DatabaseError
  | JobProcessingError
  | AuthenticationError
  | RateLimitError
  | TimeoutError
  | ResourceError
  | BaseSocketError;

// Error context for enriching errors
export interface ErrorContext {
  requestId?: string;
  sessionId?: string;
  operation?: string;
  userAgent?: string;
  apiVersion?: string;
  environment?: string;
  metadata?: Record<string, any>;
}

// Error handling configuration
export interface ErrorHandlingConfig {
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  enableStackTraces: boolean;
  enableDetailedLogging: boolean;
  retryConfig: {
    maxRetries: number;
    retryDelay: number;
    backoffMultiplier: number;
    maxRetryDelay: number;
  };
  notificationConfig: {
    emailNotifications: boolean;
    slackNotifications: boolean;
    criticalErrorThreshold: number;
    notificationCooldown: number;
  };
  persistenceConfig: {
    storeErrors: boolean;
    maxErrorAge: number;
    maxErrorCount: number;
  };
}

// Error handler interface
export interface ErrorHandler {
  handle(error: SocketError, context?: ErrorContext): Promise<ErrorHandlingResult>;
  canHandle(error: SocketError): boolean;
  getPriority(): number;
}

// Error handling result
export interface ErrorHandlingResult {
  handled: boolean;
  shouldRetry: boolean;
  retryAfter?: number;
  shouldNotify: boolean;
  shouldTerminate: boolean;
  resolution?: string;
  metadata?: Record<string, any>;
}

// Error recovery strategies
export interface ErrorRecoveryStrategy {
  name: string;
  canRecover(error: SocketError): boolean;
  recover(error: SocketError, context?: ErrorContext): Promise<RecoveryResult>;
}

export interface RecoveryResult {
  success: boolean;
  message: string;
  newState?: any;
  followUpActions?: string[];
}

// Error aggregation and reporting
export interface ErrorAggregator {
  addError(error: SocketError): void;
  getErrorStats(timeWindow?: number): ErrorStats;
  getErrorsByCategory(category: ErrorCategory, limit?: number): SocketError[];
  getErrorsByJob(jobId: string, limit?: number): SocketError[];
  getRecentErrors(limit?: number): SocketError[];
  clearOldErrors(olderThan: Date): number;
}

export interface ErrorStats {
  totalErrors: number;
  errorsByCategory: Record<ErrorCategory, number>;
  errorsBySeverity: Record<ErrorSeverity, number>;
  errorRate: number; // errors per minute
  topErrors: Array<{
    message: string;
    count: number;
    lastOccurrence: Date;
  }>;
  trends: {
    increasing: boolean;
    changePercentage: number;
    timeWindow: number;
  };
}

// Error notification system
export interface ErrorNotification {
  id: string;
  error: SocketError;
  recipients: string[];
  channels: ('email' | 'slack' | 'webhook')[];
  urgency: 'low' | 'medium' | 'high' | 'critical';
  sent: boolean;
  sentAt?: Date;
  retryCount: number;
}

export interface ErrorNotifier {
  shouldNotify(error: SocketError): boolean;
  createNotification(error: SocketError): ErrorNotification;
  sendNotification(notification: ErrorNotification): Promise<boolean>;
  getNotificationHistory(limit?: number): ErrorNotification[];
}

// Error middleware
export interface ErrorMiddleware {
  name: string;
  priority: number;
  beforeHandle?(error: SocketError, context?: ErrorContext): Promise<SocketError>;
  afterHandle?(result: ErrorHandlingResult, error: SocketError): Promise<void>;
}

// Centralized error manager
export interface ErrorManager {
  // Error handling
  handleError(error: Error | SocketError, context?: ErrorContext): Promise<ErrorHandlingResult>;
  registerHandler(handler: ErrorHandler): void;
  unregisterHandler(handler: ErrorHandler): void;
  
  // Recovery strategies
  registerRecoveryStrategy(strategy: ErrorRecoveryStrategy): void;
  attemptRecovery(error: SocketError, context?: ErrorContext): Promise<RecoveryResult>;
  
  // Middleware
  addMiddleware(middleware: ErrorMiddleware): void;
  removeMiddleware(name: string): void;
  
  // Aggregation and reporting
  getAggregator(): ErrorAggregator;
  getNotifier(): ErrorNotifier;
  
  // Configuration
  updateConfig(config: Partial<ErrorHandlingConfig>): void;
  getConfig(): ErrorHandlingConfig;
}

// Error event types
export type ErrorEvent = 
  | { type: 'error_occurred'; error: SocketError; context?: ErrorContext }
  | { type: 'error_handled'; error: SocketError; result: ErrorHandlingResult }
  | { type: 'error_recovered'; error: SocketError; result: RecoveryResult }
  | { type: 'notification_sent'; notification: ErrorNotification }
  | { type: 'error_threshold_exceeded'; category: ErrorCategory; count: number; timeWindow: number };

export type ErrorEventHandler = (event: ErrorEvent) => void;

// Error factory functions
export const createConnectionError = (
  message: string,
  connectionId: string,
  details?: Record<string, any>
): ConnectionError => ({
  id: crypto.randomUUID(),
  timestamp: new Date(),
  category: ErrorCategory.CONNECTION,
  severity: ErrorSeverity.HIGH,
  message,
  connectionId,
  details,
  stack: new Error().stack,
});

export const createMessageError = (
  message: string,
  messageType?: string,
  validationErrors?: string[]
): MessageError => ({
  id: crypto.randomUUID(),
  timestamp: new Date(),
  category: ErrorCategory.MESSAGE_VALIDATION,
  severity: ErrorSeverity.MEDIUM,
  message,
  messageType,
  validationErrors,
  stack: new Error().stack,
});

export const createJobProcessingError = (
  message: string,
  jobId: string,
  isRecoverable: boolean = true,
  details?: Record<string, any>
): JobProcessingError => ({
  id: crypto.randomUUID(),
  timestamp: new Date(),
  category: ErrorCategory.JOB_PROCESSING,
  severity: isRecoverable ? ErrorSeverity.MEDIUM : ErrorSeverity.HIGH,
  message,
  jobId,
  isRecoverable,
  details,
  stack: new Error().stack,
});

// Error utilities
export const isRetryableError = (error: SocketError): boolean => {
  switch (error.category) {
    case ErrorCategory.NETWORK:
    case ErrorCategory.TIMEOUT:
    case ErrorCategory.RESOURCE:
      return true;
    case ErrorCategory.DATABASE:
      return error.severity !== ErrorSeverity.CRITICAL;
    case ErrorCategory.JOB_PROCESSING:
      return (error as JobProcessingError).isRecoverable !== false;
    default:
      return false;
  }
};

export const shouldEscalate = (error: SocketError): boolean => {
  return error.severity === ErrorSeverity.CRITICAL ||
         (error.category === ErrorCategory.AUTHENTICATION && error.severity === ErrorSeverity.HIGH);
};

export const formatErrorForLogging = (error: SocketError, includeStack: boolean = false): string => {
  const parts = [
    `[${error.category.toUpperCase()}]`,
    `[${error.severity.toUpperCase()}]`,
    error.message,
  ];
  
  if (error.jobId) parts.push(`Job: ${error.jobId}`);
  if (error.connectionId) parts.push(`Connection: ${error.connectionId}`);
  if (includeStack && error.stack) parts.push(`\nStack: ${error.stack}`);
  
  return parts.join(' ');
};