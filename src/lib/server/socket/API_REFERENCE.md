# Socket Communication System - API Reference

This document provides comprehensive API documentation for the socket communication system, including all public classes, methods, configuration options, and usage examples.

## Table of Contents
- [Core Classes](#core-classes)
- [Configuration](#configuration)
- [Message Types](#message-types)
- [Error Handling](#error-handling)
- [Event System](#event-system)
- [Database Integration](#database-integration)
- [Performance Tuning](#performance-tuning)
- [Code Examples](#code-examples)

## Core Classes

### SocketServer

The main class for managing socket connections and message routing.

#### Constructor

```typescript
import { SocketServer } from '$lib/server/socket';

const server = new SocketServer(config?: Partial<SocketServerConfig>);
```

**Parameters:**
- `config` (optional): Partial configuration object overriding defaults

#### Methods

##### `start(): Promise<void>`

Starts the socket server and begins listening for connections.

```typescript
await server.start();
console.log('Socket server is running');
```

**Throws:**
- `Error` if server is already running
- Connection errors if socket path/port is unavailable

##### `stop(): Promise<void>`

Gracefully stops the server and closes all connections.

```typescript
await server.stop();
console.log('Socket server stopped');
```

##### `getStatus(): ServerStatus`

Returns current server status information.

```typescript
const status = server.getStatus();
console.log('Server running:', status.isRunning);
console.log('Active connections:', status.activeConnections);
console.log('Uptime:', status.uptime);
```

**Returns:**
```typescript
interface ServerStatus {
  isRunning: boolean;
  connections: number;
  activeConnections: number;
  uptime: number;
  config: SocketServerConfig;
}
```

##### `sendToCrawler(crawlerId: string, message: WebAppMessage): Promise<void>`

Sends a message to a specific crawler connection.

```typescript
await server.sendToCrawler('crawler-123', {
  type: 'job_assignment',
  timestamp: new Date().toISOString(),
  data: {
    job_id: 'job-456',
    job_type: 'crawl_project',
    gitlab_host: 'gitlab.example.com',
    access_token: 'token-here',
    priority: 1,
  }
});
```

**Parameters:**
- `crawlerId`: Unique identifier for the target crawler
- `message`: [`WebAppMessage`](#webappmessage) to send

**Throws:**
- `Error` if no connection found for crawler
- `Error` if no active connection available

##### `broadcast(message: WebAppMessage): Promise<void>`

Broadcasts a message to all active crawler connections.

```typescript
await server.broadcast({
  type: 'shutdown',
  timestamp: new Date().toISOString(),
  data: {
    graceful: true,
    timeout_seconds: 30,
    reason: 'Server maintenance'
  }
});
```

##### `getConnectionStats(): ConnectionStats`

Returns statistics about current connections.

```typescript
const stats = server.getConnectionStats();
console.log('Total connections:', stats.total);
console.log('Active connections:', stats.active);
console.log('Idle connections:', stats.idle);
console.log('Error connections:', stats.error);
```

**Returns:**
```typescript
interface ConnectionStats {
  total: number;
  active: number;
  idle: number;
  error: number;
}
```

##### `getAggregateProgress(): AggregateProgress | null`

Returns aggregated progress across all active jobs.

```typescript
const progress = server.getAggregateProgress();
if (progress) {
  console.log('Overall completion:', progress.overall_completion);
  console.log('Active jobs:', progress.active_jobs);
}
```

### MessageRouter

Handles message routing and processing with middleware support.

#### Constructor

```typescript
import { MessageRouter } from '$lib/server/socket/message-router';

const router = new MessageRouter();
```

#### Methods

##### `registerHandler(messageType: string, handler: MessageHandler): void`

Registers a message handler for a specific message type.

```typescript
import { MessageHandler } from '$lib/server/socket/message-router';

class CustomJobHandler implements MessageHandler {
  canHandle(message: CrawlerMessage): boolean {
    return message.type === 'job_started' && message.job_id?.startsWith('custom-');
  }

  async handle(message: CrawlerMessage, connection: SocketConnection): Promise<MessageProcessingResult> {
    // Custom processing logic
    console.log('Custom job started:', message.job_id);
    
    return {
      success: true,
      data: { processed: true }
    };
  }

  getPriority(): number {
    return 95; // Higher priority than default handlers
  }
}

router.registerHandler('job_started', new CustomJobHandler());
```

##### `addMiddleware(middleware: MessageMiddleware): void`

Adds middleware to the message processing pipeline.

```typescript
import { MessageMiddleware } from '$lib/server/socket/message-router';

class AuthenticationMiddleware implements MessageMiddleware {
  name = 'authentication';
  priority = 1000; // High priority - runs first

  async beforeProcess(message: CrawlerMessage, connection: SocketConnection): Promise<CrawlerMessage | null> {
    // Validate authentication
    if (!this.isAuthenticated(connection)) {
      throw new Error('Connection not authenticated');
    }
    return message; // Pass through unchanged
  }

  private isAuthenticated(connection: SocketConnection): boolean {
    return connection.metadata.crawlerId !== undefined;
  }
}

router.addMiddleware(new AuthenticationMiddleware());
```

##### `processMessage(message: CrawlerMessage, connection: SocketConnection): Promise<MessageProcessingResult>`

Processes an incoming message through the middleware pipeline and handlers.

```typescript
const result = await router.processMessage(message, connection);
if (!result.success) {
  console.error('Message processing failed:', result.error);
}
```

### Configuration Management

#### SOCKET_CONFIG

Main configuration object with environment-specific defaults.

```typescript
import { SOCKET_CONFIG } from '$lib/server/socket/config';

console.log('Socket path:', SOCKET_CONFIG.socketPath);
console.log('Max connections:', SOCKET_CONFIG.maxConnections);
console.log('Log level:', SOCKET_CONFIG.logLevel);
```

#### Configuration Getters

Access specific configuration sections:

```typescript
import { 
  getConnectionConfig,
  getMessageConfig,
  getHeartbeatConfig,
  getJobConfig,
  getLoggingConfig 
} from '$lib/server/socket/config';

const connectionConfig = getConnectionConfig();
const heartbeatConfig = getHeartbeatConfig();
```

#### ConfigurationManager

Runtime configuration management with change notifications:

```typescript
import { configManager } from '$lib/server/socket/config';

// Get current configuration
const currentConfig = configManager.getCurrentConfig();

// Update configuration
configManager.updateConfig({
  maxConnections: 15,
  logLevel: 'debug'
});

// Subscribe to configuration changes
const unsubscribe = configManager.onConfigUpdate((newConfig) => {
  console.log('Configuration updated:', newConfig);
});

// Reload from environment
configManager.reloadFromEnvironment();
```

## Configuration

### SocketServerConfig

Complete configuration interface with all available options:

```typescript
interface SocketServerConfig {
  // Connection settings
  socketPath?: string;           // Unix socket path (default: '/tmp/crawler-socket.sock')
  host?: string;                 // TCP host (default: 'localhost')
  port?: number;                 // TCP port (default: 8080)
  backlog?: number;              // Connection backlog (default: 511)
  
  // Security settings
  allowedOrigins?: string[];     // Allowed origins for connections
  maxConnections?: number;       // Maximum concurrent connections (default: 10)
  connectionTimeout?: number;    // Connection timeout in ms (default: 30000)
  
  // Message handling
  messageBufferSize?: number;    // Buffer size in bytes (default: 1MB)
  maxMessageSize?: number;       // Maximum message size in bytes (default: 1MB)
  messageDelimiter?: string;     // Message delimiter (default: '\n')
  
  // Heartbeat and health
  heartbeatInterval?: number;    // Heartbeat interval in ms (default: 30000)
  heartbeatTimeout?: number;     // Heartbeat timeout in ms (default: 90000)
  healthCheckInterval?: number;  // Health check interval in ms (default: 60000)
  
  // Job processing
  maxConcurrentJobs?: number;    // Max concurrent jobs (default: 5)
  jobQueueSize?: number;         // Job queue size (default: 100)
  jobTimeout?: number;           // Job timeout in ms (default: 3600000)
  retryAttempts?: number;        // Retry attempts (default: 3)
  retryDelay?: number;           // Retry delay in ms (default: 5000)
  
  // Logging and monitoring
  logLevel?: 'debug' | 'info' | 'warn' | 'error';  // Log level (default: 'info')
  enableMetrics?: boolean;       // Enable metrics collection (default: true)
  metricsInterval?: number;      // Metrics collection interval in ms (default: 60000)
  
  // Database settings
  databaseConnectionPool?: number;  // DB connection pool size (default: 10)
  queryTimeout?: number;         // DB query timeout in ms (default: 30000)
  transactionTimeout?: number;   // DB transaction timeout in ms (default: 60000)
  
  // Cleanup settings
  cleanupInterval?: number;      // Cleanup interval in ms (default: 3600000)
  maxJobAge?: number;           // Max job age in ms (default: 7 days)
  maxErrorLogAge?: number;      // Max error log age in ms (default: 30 days)
}
```

### Environment Variables

All configuration can be overridden using environment variables:

```bash
# Connection
SOCKET_PATH=/var/run/copilot-study/crawler.sock
SOCKET_HOST=localhost
SOCKET_PORT=8080
SOCKET_MAX_CONNECTIONS=10

# Logging
SOCKET_LOG_LEVEL=info
SOCKET_ENABLE_METRICS=true

# Performance
SOCKET_HEARTBEAT_INTERVAL=30000
SOCKET_MAX_CONCURRENT_JOBS=5

# Database
DATABASE_CONNECTION_POOL=20
SOCKET_QUERY_TIMEOUT=30000
```

## Message Types

### Crawler → Web App Messages

#### HeartbeatMessage

```typescript
interface HeartbeatMessage {
  type: 'heartbeat';
  timestamp: string;
  job_id?: string;
  data: {
    active_jobs: number;
    last_activity: string;
    system_status: 'idle' | 'discovering' | 'crawling' | 'error';
  };
}
```

**Example:**
```typescript
const heartbeat: HeartbeatMessage = {
  type: 'heartbeat',
  timestamp: '2024-01-15T10:30:00Z',
  data: {
    active_jobs: 2,
    last_activity: '2024-01-15T10:29:45Z',
    system_status: 'crawling'
  }
};
```

#### JobProgressMessage

```typescript
interface JobProgressMessage {
  type: 'job_progress';
  timestamp: string;
  job_id: string;
  data: {
    progress: ProgressData[];
    overall_completion: number;     // 0-1
    time_elapsed: number;          // milliseconds
    estimated_time_remaining?: number;  // milliseconds
  };
}

interface ProgressData {
  entity_type: string;
  total_discovered: number;
  total_processed: number;
  current_page?: number;
  items_per_page?: number;
  sub_collection?: string;
  estimated_remaining?: number;
}
```

**Example:**
```typescript
const progress: JobProgressMessage = {
  type: 'job_progress',
  timestamp: '2024-01-15T10:30:15Z',
  job_id: 'job-123',
  data: {
    progress: [
      {
        entity_type: 'projects',
        total_discovered: 150,
        total_processed: 45,
        current_page: 5,
        items_per_page: 10
      },
      {
        entity_type: 'issues',
        total_discovered: 1200,
        total_processed: 350
      }
    ],
    overall_completion: 0.35,
    time_elapsed: 45000,
    estimated_time_remaining: 90000
  }
};
```

#### JobsDiscoveredMessage

```typescript
interface JobsDiscoveredMessage {
  type: 'jobs_discovered';
  timestamp: string;
  job_id: string;  // Required for discovery messages
  data: {
    discovered_jobs: DiscoveredJob[];
    discovery_summary: DiscoverySummary;
  };
}

interface DiscoveredJob {
  job_type: 'discover_namespaces' | 'crawl_user' | 'crawl_group' | 'crawl_project';
  entity_id: string;
  namespace_path: string;
  entity_name: string;
  priority: number;
  estimated_size?: Record<string, number>;
}
```

**Example:**
```typescript
const discovered: JobsDiscoveredMessage = {
  type: 'jobs_discovered',
  timestamp: '2024-01-15T10:30:30Z',
  job_id: 'discovery-job-456',
  data: {
    discovered_jobs: [
      {
        job_type: 'crawl_project',
        entity_id: '1234',
        namespace_path: 'group/subgroup/project',
        entity_name: 'My Project',
        priority: 1,
        estimated_size: {
          issues: 500,
          merge_requests: 200
        }
      }
    ],
    discovery_summary: {
      total_users: 25,
      total_groups: 5,
      total_projects: 15,
      hierarchy_depth: 3
    }
  }
};
```

### Web App → Crawler Messages

#### JobAssignmentMessage

```typescript
interface JobAssignmentMessage {
  type: 'job_assignment';
  timestamp: string;
  data: JobAssignment;
}

interface JobAssignment {
  job_id: string;
  job_type: 'discover_namespaces' | 'crawl_user' | 'crawl_group' | 'crawl_project';
  entity_id?: string;
  namespace_path?: string;
  gitlab_host: string;
  access_token: string;
  priority: number;
  resume: boolean;
}
```

**Example:**
```typescript
const assignment: JobAssignmentMessage = {
  type: 'job_assignment',
  timestamp: '2024-01-15T10:31:00Z',
  data: {
    job_id: 'job-789',
    job_type: 'crawl_project',
    entity_id: '1234',
    namespace_path: 'group/project',
    gitlab_host: 'gitlab.example.com',
    access_token: 'glpat-xxxxxxxxxxxxxxxxxxxx',
    priority: 1,
    resume: false
  }
};
```

#### TokenRefreshResponseMessage

```typescript
interface TokenRefreshResponseMessage {
  type: 'token_refresh_response';
  timestamp: string;
  data: {
    access_token: string;
    expires_at?: string;
    refresh_successful: boolean;
  };
}
```

## Error Handling

### Error Categories and Severities

```typescript
enum ErrorCategory {
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

enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}
```

### Error Factory Functions

```typescript
import { 
  createConnectionError,
  createMessageError,
  createJobProcessingError 
} from '$lib/server/socket/types/errors';

// Create connection error
const connError = createConnectionError(
  'Connection timeout',
  'conn-123',
  { timeout: 30000 }
);

// Create message validation error
const msgError = createMessageError(
  'Invalid message format',
  'job_progress',
  ['Missing required field: job_id']
);

// Create job processing error
const jobError = createJobProcessingError(
  'Job execution failed',
  'job-456',
  true, // isRecoverable
  { stage: 'data_processing', retryCount: 2 }
);
```

### Error Handler Implementation

```typescript
import { ErrorHandler, SocketError, ErrorHandlingResult } from '$lib/server/socket/types/errors';

class DatabaseErrorHandler implements ErrorHandler {
  canHandle(error: SocketError): boolean {
    return error.category === ErrorCategory.DATABASE;
  }

  async handle(error: SocketError): Promise<ErrorHandlingResult> {
    const dbError = error as DatabaseError;
    
    // Check if it's a connection issue
    if (dbError.message.includes('connection')) {
      return {
        handled: true,
        shouldRetry: true,
        retryAfter: 5000,
        shouldNotify: true,
        shouldTerminate: false,
        resolution: 'Will retry database operation after 5 seconds'
      };
    }

    // For other database errors
    return {
      handled: true,
      shouldRetry: false,
      shouldNotify: true,
      shouldTerminate: false,
      resolution: 'Database operation failed, manual intervention required'
    };
  }

  getPriority(): number {
    return 80; // High priority for database errors
  }
}
```

## Event System

### Connection Events

```typescript
import { SocketConnection, ConnectionEvent } from '$lib/server/socket/types/connection';

// Listen to connection events
connection.on('message', (event: ConnectionEvent) => {
  if (event.type === 'message') {
    console.log('Received message:', event.message);
  }
});

connection.on('error', (event: ConnectionEvent) => {
  if (event.type === 'error') {
    console.error('Connection error:', event.error);
  }
});

connection.on('disconnected', (event: ConnectionEvent) => {
  if (event.type === 'disconnected') {
    console.log('Connection disconnected:', event.reason);
  }
});
```

### Progress Events

```typescript
import { ProgressTracker, ProgressEvent } from '$lib/server/socket/types/progress';

progressTracker.on('state_changed', (event: ProgressEvent) => {
  if (event.type === 'state_changed') {
    console.log(`Progress state changed from ${event.previousState} to ${event.newState}`);
  }
});

progressTracker.on('milestone_reached', (event: ProgressEvent) => {
  if (event.type === 'milestone_reached') {
    console.log('Milestone reached:', event.milestone.name);
  }
});
```

## Database Integration

### Job Operations

```typescript
import { SocketDatabaseOperations } from '$lib/server/socket/types/database';

// Example implementation
class JobDatabaseService implements SocketDatabaseOperations {
  async createJobFromAssignment(assignment: WebAppJobAssignmentData): Promise<Job> {
    const job: Job = {
      id: assignment.web_app_job_id,
      accountId: assignment.account_id,
      command: this.mapJobTypeToCommand(assignment.job_type),
      status: JobStatus.queued,
      created_at: new Date(),
      provider: assignment.provider,
      userId: assignment.user_id,
      // ... other fields
    };

    // Insert into database
    return await this.jobRepository.create(job);
  }

  async updateJobFromProgress(jobId: string, progress: WebAppProgressUpdate): Promise<Job> {
    const updateData = {
      progress: {
        overall_completion: progress.overall_completion,
        time_elapsed: progress.time_elapsed,
        entities: progress.progress_data,
        last_update: progress.last_update,
      },
      status: this.mapProgressStatusToJobStatus(progress.status),
      updated_at: new Date(),
    };

    return await this.jobRepository.update(jobId, updateData);
  }

  // ... implement other required methods
}
```

### Progress Tracking

```typescript
import { SocketJobProgress, ProgressMilestone } from '$lib/server/socket/types/database';

// Save progress update
async saveProgressUpdate(jobId: string, progress: SocketJobProgress): Promise<void> {
  await this.progressRepository.upsert({
    jobId,
    overall_completion: progress.overall_completion,
    time_elapsed: progress.time_elapsed,
    estimated_time_remaining: progress.estimated_time_remaining,
    entities: progress.entities,
    status: progress.status,
    last_update: progress.last_update,
    milestones: progress.milestones,
  });
}

// Get job progress
async getJobProgress(jobId: string): Promise<SocketJobProgress | null> {
  const progress = await this.progressRepository.findByJobId(jobId);
  return progress ? this.mapToSocketJobProgress(progress) : null;
}
```

## Performance Tuning

### Connection Pool Optimization

```typescript
// Optimize based on expected load
const config: SocketServerConfig = {
  maxConnections: 20,              // Adjust based on crawler instances
  connectionTimeout: 120000,       // 2 minutes for slow networks
  heartbeatInterval: 60000,        // 1 minute for production
  heartbeatTimeout: 180000,        // 3 minutes timeout
};
```

### Message Processing Optimization

```typescript
// Configure message handling for performance
const config: SocketServerConfig = {
  messageBufferSize: 2 * 1024 * 1024,    // 2MB buffer
  maxMessageSize: 5 * 1024 * 1024,       // 5MB max message
  maxConcurrentJobs: 10,                  // Based on server capacity
  jobQueueSize: 200,                      // Queue size for job assignment
};
```

### Database Performance

```typescript
// Database connection tuning
const config: SocketServerConfig = {
  databaseConnectionPool: 25,             // Based on concurrent jobs + overhead
  queryTimeout: 45000,                    // 45 seconds for complex queries
  transactionTimeout: 120000,             // 2 minutes for bulk operations
  cleanupInterval: 1800000,               // 30 minutes cleanup
};
```

### Memory Management

```typescript
// Memory optimization settings
const config: SocketServerConfig = {
  maxJobAge: 3 * 24 * 60 * 60 * 1000,    // 3 days job retention
  maxErrorLogAge: 7 * 24 * 60 * 60 * 1000, // 7 days error retention
  metricsInterval: 300000,                // 5 minutes metrics collection
};
```

## Code Examples

### Complete Server Setup

```typescript
import { SocketServer } from '$lib/server/socket';
import { createDefaultRouter } from '$lib/server/socket/message-router';
import { DatabaseManager } from '$lib/server/database';

async function setupSocketServer() {
  // Initialize database
  const dbManager = new DatabaseManager({
    connectionString: process.env.DATABASE_URL,
    poolSize: 20,
  });
  await dbManager.connect();

  // Create socket server with custom configuration
  const socketServer = new SocketServer({
    socketPath: process.env.SOCKET_PATH || '/tmp/crawler.sock',
    maxConnections: parseInt(process.env.MAX_CONNECTIONS || '10'),
    logLevel: (process.env.LOG_LEVEL as any) || 'info',
    heartbeatInterval: 60000,
    enableMetrics: true,
  });

  // Set up message routing
  const router = createDefaultRouter();
  
  // Add custom handlers
  router.registerHandler('job_progress', new CustomProgressHandler(dbManager));
  router.registerHandler('jobs_discovered', new DiscoveryHandler(dbManager));

  // Add authentication middleware
  router.addMiddleware(new AuthenticationMiddleware());
  
  // Start server
  await socketServer.start();
  console.log('Socket server started successfully');

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('Shutting down socket server...');
    await socketServer.stop();
    await dbManager.disconnect();
    process.exit(0);
  });

  return socketServer;
}

// Start the server
setupSocketServer().catch(console.error);
```

### Custom Message Handler

```typescript
import { MessageHandler, MessageProcessingResult } from '$lib/server/socket/message-router';
import { CrawlerMessage, SocketConnection } from '$lib/server/socket/types';

class CustomProgressHandler implements MessageHandler {
  constructor(private dbManager: DatabaseManager) {}

  canHandle(message: CrawlerMessage): boolean {
    return message.type === 'job_progress' && message.job_id !== undefined;
  }

  async handle(message: CrawlerMessage, connection: SocketConnection): Promise<MessageProcessingResult> {
    try {
      const progressMessage = message as JobProgressMessage;
      
      // Update database with progress
      await this.dbManager.updateJobProgress(
        progressMessage.job_id!,
        progressMessage.data
      );

      // Emit real-time update to web clients
      await this.emitProgressUpdate(progressMessage);

      // Check for milestones
      if (progressMessage.data.overall_completion >= 0.5) {
        await this.handleMilestone(progressMessage.job_id!, '50% completion');
      }

      return {
        success: true,
        data: { progress_updated: true }
      };
    } catch (error) {
      console.error('Progress update failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Progress update failed',
        shouldRetry: true,
        retryAfter: 5000
      };
    }
  }

  getPriority(): number {
    return 90; // High priority for progress updates
  }

  private async emitProgressUpdate(message: JobProgressMessage): Promise<void> {
    // Emit to WebSocket clients or SSE connections
    // Implementation depends on your real-time update system
  }

  private async handleMilestone(jobId: string, milestone: string): Promise<void> {
    console.log(`Job ${jobId} reached milestone: ${milestone}`);
    // Could trigger notifications, logging, etc.
  }
}
```

### Error Handling Setup

```typescript
import { ErrorManager, ErrorHandler } from '$lib/server/socket/types/errors';

// Custom error handler
class NotificationErrorHandler implements ErrorHandler {
  canHandle(error: SocketError): boolean {
    return error.severity === ErrorSeverity.CRITICAL;
  }

  async handle(error: SocketError): Promise<ErrorHandlingResult> {
    // Send notification to administrators
    await this.sendNotification(error);
    
    return {
      handled: true,
      shouldRetry: false,
      shouldNotify: true,
      shouldTerminate: error.category === ErrorCategory.CONFIGURATION,
      resolution: 'Critical error notification sent to administrators'
    };
  }

  getPriority(): number {
    return 100; // Highest priority
  }

  private async sendNotification(error: SocketError): Promise<void> {
    // Implementation for sending notifications (email, Slack, etc.)
  }
}

// Setup error management
const errorManager = new ErrorManager({
  logLevel: 'error',
  enableStackTraces: true,
  retryConfig: {
    maxRetries: 3,
    retryDelay: 5000,
    backoffMultiplier: 2,
    maxRetryDelay: 30000,
  }
});

errorManager.registerHandler(new NotificationErrorHandler());
```

This API reference provides comprehensive documentation for all major components of the socket communication system. Use these examples and interfaces to integrate the system into your application and extend it with custom functionality.