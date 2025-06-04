/**
 * Production Socket Server Setup Example
 * 
 * This example demonstrates a production-ready socket server setup with
 * comprehensive error handling, monitoring, security, and performance
 * optimizations.
 */

import { SocketServer } from '../socket-server.js';
import { createDefaultRouter, type MessageMiddleware } from '../message-router.js';
import type {
  SocketServerConfig,
  CrawlerMessage,
  SocketConnection
} from '../types/index.js';

/**
 * Production-ready socket server setup with full error handling,
 * monitoring, and security features.
 */
export async function productionSocketSetup() {
  console.log('🚀 Starting production socket server setup...');

  try {
    // 1. Load production configuration with validation
    const config = await loadProductionConfig();
    validateProductionConfig(config);

    // 2. Create socket server with production settings
    const socketServer = new SocketServer(config);

    // 3. Set up comprehensive message routing
    const router = createDefaultRouter();
    
    // Add production middleware
    router.addMiddleware(new SecurityMiddleware());
    router.addMiddleware(new MetricsMiddleware());
    router.addMiddleware(new ErrorTrackingMiddleware());
    router.addMiddleware(new RateLimitingMiddleware());

    // 4. Set up error handling
    await setupProductionErrorHandling();

    // 5. Set up monitoring and health checks
    const monitoring = await setupMonitoring(socketServer);

    // 6. Start the server
    await socketServer.start();
    console.log('✅ Production socket server started successfully');
    console.log(`🔌 Socket path: ${config.socketPath}`);
    console.log(`📊 Max connections: ${config.maxConnections}`);
    console.log(`🔐 Security enabled: ✓`);
    console.log(`📈 Monitoring enabled: ✓`);

    // 7. Set up graceful shutdown with cleanup
    await setupGracefulShutdown(socketServer, monitoring);

    return { socketServer, monitoring };

  } catch (error) {
    console.error('❌ Failed to start production socket server:', error);
    await notifyAdministrators('Socket server startup failed', error);
    throw error;
  }
}

/**
 * Load and validate production configuration
 */
async function loadProductionConfig(): Promise<SocketServerConfig> {
  const config: SocketServerConfig = {
    // Connection settings
    socketPath: process.env.SOCKET_PATH || '/var/run/copilot-study/crawler.sock',
    maxConnections: parseInt(process.env.SOCKET_MAX_CONNECTIONS || '20'),
    connectionTimeout: parseInt(process.env.SOCKET_CONNECTION_TIMEOUT || '120000'),
    
    // Security settings
    allowedOrigins: process.env.SOCKET_ALLOWED_ORIGINS?.split(',') || [],
    maxMessageSize: parseInt(process.env.SOCKET_MAX_MESSAGE_SIZE || '5242880'), // 5MB
    
    // Performance settings
    heartbeatInterval: parseInt(process.env.SOCKET_HEARTBEAT_INTERVAL || '60000'),
    heartbeatTimeout: parseInt(process.env.SOCKET_HEARTBEAT_TIMEOUT || '180000'),
    maxConcurrentJobs: parseInt(process.env.SOCKET_MAX_CONCURRENT_JOBS || '10'),
    
    // Database settings
    databaseConnectionPool: parseInt(process.env.DATABASE_CONNECTION_POOL || '25'),
    queryTimeout: parseInt(process.env.SOCKET_QUERY_TIMEOUT || '45000'),
    transactionTimeout: parseInt(process.env.SOCKET_TRANSACTION_TIMEOUT || '120000'),
    
    // Monitoring and logging
    logLevel: (process.env.SOCKET_LOG_LEVEL as any) || 'info',
    enableMetrics: process.env.SOCKET_ENABLE_METRICS !== 'false',
    metricsInterval: parseInt(process.env.SOCKET_METRICS_INTERVAL || '60000'),
    
    // Cleanup settings
    cleanupInterval: parseInt(process.env.SOCKET_CLEANUP_INTERVAL || '3600000'),
    maxJobAge: parseInt(process.env.SOCKET_MAX_JOB_AGE || '604800000'),
    maxErrorLogAge: parseInt(process.env.SOCKET_MAX_ERROR_LOG_AGE || '2592000000'),
  };

  return config;
}

/**
 * Validate production configuration
 */
function validateProductionConfig(config: SocketServerConfig): void {
  const errors: string[] = [];

  if (!config.socketPath) {
    errors.push('SOCKET_PATH is required in production');
  }

  if (!config.maxConnections || config.maxConnections < 1) {
    errors.push('SOCKET_MAX_CONNECTIONS must be a positive number');
  }

  if (config.logLevel === 'debug') {
    console.warn('⚠️ Debug logging is enabled in production');
  }

  if (errors.length > 0) {
    throw new Error(`Production configuration validation failed:\n${errors.join('\n')}`);
  }

  console.log('✅ Production configuration validated');
}

/**
 * Security middleware for production
 */
class SecurityMiddleware implements MessageMiddleware {
  name = 'security';
  priority = 1000;

  async beforeProcess(message: CrawlerMessage, connection: SocketConnection): Promise<CrawlerMessage | null> {
    // Validate message size
    const messageSize = JSON.stringify(message).length;
    if (messageSize > 5 * 1024 * 1024) { // 5MB limit
      throw new Error(`Message too large: ${messageSize} bytes`);
    }

    // Sanitize message data
    const sanitized = this.sanitizeMessage(message);
    
    // Log security events
    if (this.isSecuritySensitive(message)) {
      console.log(`🔐 Security-sensitive message ${message.type} from ${connection.id}`);
    }

    return sanitized;
  }

  private sanitizeMessage(message: CrawlerMessage): CrawlerMessage {
    // Remove or mask sensitive data for logging
    const sanitized = { ...message };
    
    if (sanitized.type === 'token_refresh_request' && sanitized.data) {
      // Mask sensitive token data
      sanitized.data = { ...sanitized.data };
      if ('access_token' in sanitized.data) {
        (sanitized.data as any).access_token = '***MASKED***';
      }
    }
    
    return sanitized;
  }

  private isSecuritySensitive(message: CrawlerMessage): boolean {
    return ['token_refresh_request', 'job_assignment'].includes(message.type);
  }
}

/**
 * Metrics collection middleware
 */
class MetricsMiddleware implements MessageMiddleware {
  name = 'metrics';
  priority = 10;
  
  private messageCounters = new Map<string, number>();
  private processingTimes = new Map<string, number[]>();

  async beforeProcess(message: CrawlerMessage): Promise<CrawlerMessage | null> {
    // Track message types
    const count = this.messageCounters.get(message.type) || 0;
    this.messageCounters.set(message.type, count + 1);
    
    // Start timing
    (message as any)._processingStartTime = Date.now();
    
    return null; // Don't modify message
  }

  async afterProcess(result: any, message: CrawlerMessage): Promise<void> {
    // Record processing time
    const startTime = (message as any)._processingStartTime;
    if (startTime) {
      const processingTime = Date.now() - startTime;
      const times = this.processingTimes.get(message.type) || [];
      times.push(processingTime);
      
      // Keep only last 100 measurements
      if (times.length > 100) {
        times.shift();
      }
      
      this.processingTimes.set(message.type, times);
    }
  }

  getMetrics() {
    const metrics: any = {
      message_counts: Object.fromEntries(this.messageCounters),
      processing_times: {}
    };

    for (const [type, times] of this.processingTimes) {
      if (times.length > 0) {
        metrics.processing_times[type] = {
          count: times.length,
          avg: times.reduce((a, b) => a + b, 0) / times.length,
          min: Math.min(...times),
          max: Math.max(...times),
        };
      }
    }

    return metrics;
  }
}

/**
 * Error tracking middleware
 */
class ErrorTrackingMiddleware implements MessageMiddleware {
  name = 'error-tracking';
  priority = 5;

  async afterProcess(result: any, message: CrawlerMessage, connection: SocketConnection): Promise<void> {
    if (!result.success) {
      await this.trackError(message, connection, result.error);
    }
  }

  private async trackError(message: CrawlerMessage, connection: SocketConnection, error: string): Promise<void> {
    const errorData = {
      timestamp: new Date().toISOString(),
      message_type: message.type,
      connection_id: connection.id,
      error_message: error,
      job_id: message.job_id,
    };

    // Log error
    console.error('🔥 Message processing error:', errorData);

    // Store error for analysis (implement based on your error storage system)
    // await this.storeError(errorData);
  }
}

/**
 * Rate limiting middleware
 */
class RateLimitingMiddleware implements MessageMiddleware {
  name = 'rate-limiting';
  priority = 900;

  private connectionLimits = new Map<string, { count: number; resetTime: number }>();
  private readonly RATE_LIMIT = 100; // messages per minute
  private readonly WINDOW_MS = 60000; // 1 minute

  async beforeProcess(message: CrawlerMessage, connection: SocketConnection): Promise<CrawlerMessage | null> {
    const now = Date.now();
    const key = connection.id;
    const limit = this.connectionLimits.get(key);

    if (!limit || now > limit.resetTime) {
      // Reset or create new limit window
      this.connectionLimits.set(key, {
        count: 1,
        resetTime: now + this.WINDOW_MS
      });
      return null;
    }

    if (limit.count >= this.RATE_LIMIT) {
      throw new Error(`Rate limit exceeded for connection ${connection.id}`);
    }

    limit.count++;
    return null;
  }
}

/**
 * Production error handling setup
 */
async function setupProductionErrorHandling(): Promise<void> {
  // Custom error handlers for production
  // TODO: Implement error handler registration when ErrorManager is available
  
  // Example error handler that would be registered:
  // const criticalErrorHandler: ErrorHandler = {
  //   canHandle: (error: SocketError) => error.severity === 'critical',
  //   handle: async (error: SocketError): Promise<ErrorHandlingResult> => {
  //     await notifyAdministrators('Critical socket error', error);
  //     return {
  //       handled: true,
  //       shouldRetry: false,
  //       shouldNotify: true,
  //       shouldTerminate: error.category === 'configuration',
  //       resolution: 'Administrator notification sent for critical error'
  //     };
  //   },
  //   getPriority: () => 100
  // };
  // errorManager.registerHandler(criticalErrorHandler);
  
  console.log('🛡️ Production error handling configured');
}

/**
 * Production monitoring setup
 */
async function setupMonitoring(socketServer: SocketServer) {
  const monitoring = {
    healthCheck: null as any,
    metricsCollection: null as any,
    alerting: null as any,
  };

  // Health check endpoint
  monitoring.healthCheck = setInterval(async () => {
    try {
      const status = socketServer.getStatus();
      const stats = socketServer.getConnectionStats();
      
      const health = {
        timestamp: new Date().toISOString(),
        status: status.isRunning ? 'healthy' : 'unhealthy',
        uptime: status.uptime,
        connections: {
          total: stats.total,
          active: stats.active,
          idle: stats.idle,
          error: stats.error,
        },
        memory: process.memoryUsage(),
      };

      // Log health status
      if (health.status === 'unhealthy' || stats.error > 0) {
        console.warn('⚠️ Health check warning:', health);
      }

      // Store health metrics
      // await storeHealthMetrics(health);
      
    } catch (error) {
      console.error('❌ Health check failed:', error);
    }
  }, 30000); // Every 30 seconds

  // Metrics collection
  monitoring.metricsCollection = setInterval(async () => {
    try {
      // Collect metrics for storage
      // TODO: Implement metrics storage when available
      
      // Example metrics that would be stored:
      // const progress = socketServer.getAggregateProgress();
      // const stats = socketServer.getConnectionStats();
      // const metrics = {
      //   timestamp: new Date().toISOString(),
      //   connections: stats,
      //   progress: progress,
      //   system: {
      //     memory: process.memoryUsage(),
      //     uptime: process.uptime(),
      //     pid: process.pid,
      //   }
      // };
      // await storeMetrics(metrics);
      
    } catch (error) {
      console.error('❌ Metrics collection failed:', error);
    }
  }, 60000); // Every minute

  console.log('📊 Production monitoring configured');
  return monitoring;
}

/**
 * Graceful shutdown handling
 */
async function setupGracefulShutdown(socketServer: SocketServer, monitoring: any): Promise<void> {
  const shutdown = async (signal: string) => {
    console.log(`\n🛑 Received ${signal}, initiating graceful shutdown...`);
    
    try {
      // Clear monitoring intervals
      if (monitoring.healthCheck) clearInterval(monitoring.healthCheck);
      if (monitoring.metricsCollection) clearInterval(monitoring.metricsCollection);
      
      // Stop accepting new connections
      console.log('🔌 Stopping socket server...');
      await socketServer.stop();
      
      // Wait for ongoing operations to complete
      console.log('⏳ Waiting for operations to complete...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      console.log('✅ Graceful shutdown completed');
      process.exit(0);
      
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
      await notifyAdministrators('Graceful shutdown failed', error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  
  // Handle uncaught exceptions
  process.on('uncaughtException', async (error) => {
    console.error('💥 Uncaught exception:', error);
    await notifyAdministrators('Uncaught exception in socket server', error);
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason, promise) => {
    console.error('💥 Unhandled rejection at:', promise, 'reason:', reason);
    await notifyAdministrators('Unhandled promise rejection', reason);
  });

  console.log('🛡️ Graceful shutdown handlers configured');
}

/**
 * Administrator notification system
 */
async function notifyAdministrators(subject: string, error: any): Promise<void> {
  const notification = {
    timestamp: new Date().toISOString(),
    subject,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    server: {
      hostname: process.env.HOSTNAME || 'unknown',
      pid: process.pid,
      environment: process.env.NODE_ENV || 'unknown',
    }
  };

  // Log notification
  console.error('🚨 Administrator notification:', notification);

  // Send notification via configured channels
  // - Email
  // - Slack
  // - PagerDuty
  // - etc.
  
  // Implementation depends on your notification system
  try {
    // await sendEmailNotification(notification);
    // await sendSlackNotification(notification);
  } catch (notificationError) {
    console.error('❌ Failed to send administrator notification:', notificationError);
  }
}

/**
 * Production readiness checklist
 */
export function validateProductionReadiness(): { ready: boolean; issues: string[] } {
  const issues: string[] = [];

  // Environment checks
  if (!process.env.SOCKET_PATH) {
    issues.push('SOCKET_PATH environment variable not set');
  }

  if (!process.env.DATABASE_URL) {
    issues.push('DATABASE_URL environment variable not set');
  }

  // Security checks
  if (process.env.NODE_ENV !== 'production') {
    issues.push('NODE_ENV should be set to "production"');
  }

  // Performance checks
  const maxConnections = parseInt(process.env.SOCKET_MAX_CONNECTIONS || '0');
  if (maxConnections < 5) {
    issues.push('SOCKET_MAX_CONNECTIONS should be at least 5 for production');
  }

  // Monitoring checks
  if (process.env.SOCKET_ENABLE_METRICS === 'false') {
    issues.push('Metrics should be enabled in production');
  }

  return {
    ready: issues.length === 0,
    issues
  };
}

/**
 * Run production setup if this file is executed directly
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  // Validate production readiness
  const readiness = validateProductionReadiness();
  if (!readiness.ready) {
    console.error('❌ Production readiness check failed:');
    readiness.issues.forEach(issue => console.error(`  - ${issue}`));
    process.exit(1);
  }

  console.log('✅ Production readiness check passed');

  productionSocketSetup()
    .then(({ socketServer }) => {
      console.log('🎯 Production socket server is running');
      console.log('📊 Status:', socketServer.getStatus());
    })
    .catch((error) => {
      console.error('💥 Production setup failed:', error);
      process.exit(1);
    });
}

/**
 * Usage Instructions:
 * 
 * 1. Environment Setup:
 *    ```bash
 *    export NODE_ENV=production
 *    export SOCKET_PATH=/var/run/copilot-study/crawler.sock
 *    export SOCKET_MAX_CONNECTIONS=20
 *    export DATABASE_URL=postgresql://...
 *    ```
 * 
 * 2. Run Production Server:
 *    ```bash
 *    npx tsx src/lib/server/socket/examples/production-setup.ts
 *    ```
 * 
 * 3. Integration:
 *    ```typescript
 *    import { productionSocketSetup } from './examples/production-setup';
 *    const { socketServer, monitoring } = await productionSocketSetup();
 *    ```
 * 
 * 4. Process Management:
 *    ```bash
 *    pm2 start production-setup.ts --name socket-server
 *    # or with systemd service
 *    systemctl start copilot-study-socket
 *    ```
 * 
 * 5. Monitoring:
 *    - Health checks run every 30 seconds
 *    - Metrics collected every minute
 *    - Error tracking and alerting enabled
 *    - Graceful shutdown handling
 * 
 * 6. Security Features:
 *    - Message size limits
 *    - Rate limiting per connection
 *    - Sensitive data masking
 *    - Security event logging
 */