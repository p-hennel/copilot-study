/* eslint-disable @typescript-eslint/no-unused-vars */
import type { 
  CrawlerMessage, 
  WebAppMessage, 
  MessageProcessingResult,
  SocketConnection 
} from './types';
import { jobService } from './services/job-service.js';
import { adminUIBridge } from './services/admin-ui-bridge.js';

/**
 * Message Router
 * 
 * Handles routing and processing of messages between the web application
 * and crawler instances. Provides message validation, transformation,
 * and dispatch to appropriate handlers.
 */

export interface MessageHandler<T = any> {
  canHandle(message: CrawlerMessage): boolean;
  handle(message: CrawlerMessage, connection: SocketConnection): Promise<MessageProcessingResult<T>>;
  getPriority(): number;
}

export class MessageRouter {
  private handlers: Map<string, MessageHandler[]> = new Map();
  private middlewares: MessageMiddleware[] = [];

  /**
   * Register a message handler for a specific message type
   */
  registerHandler(messageType: string, handler: MessageHandler): void {
    if (!this.handlers.has(messageType)) {
      this.handlers.set(messageType, []);
    }
    
    const handlers = this.handlers.get(messageType)!;
    handlers.push(handler);
    
    // Sort by priority (higher priority first)
    handlers.sort((a, b) => b.getPriority() - a.getPriority());
  }

  /**
   * Unregister a message handler
   */
  unregisterHandler(messageType: string, handler: MessageHandler): void {
    const handlers = this.handlers.get(messageType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Add middleware for message processing
   */
  addMiddleware(middleware: MessageMiddleware): void {
    this.middlewares.push(middleware);
    this.middlewares.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Process an incoming message from a crawler
   */
  async processMessage(
    message: CrawlerMessage, 
    connection: SocketConnection
  ): Promise<MessageProcessingResult> {
    try {
      // Apply pre-processing middleware
      let processedMessage = message;
      for (const middleware of this.middlewares) {
        if (middleware.beforeProcess) {
          const result = await middleware.beforeProcess(processedMessage, connection);
          if (result) {
            processedMessage = result;
          }
        }
      }

      // Find and execute handlers
      const handlers = this.handlers.get(processedMessage.type) || [];
      
      if (handlers.length === 0) {
        return {
          success: false,
          error: `No handler found for message type: ${processedMessage.type}`
        };
      }

      let result: MessageProcessingResult | null = null;
      
      for (const handler of handlers) {
        if (handler.canHandle(processedMessage)) {
          result = await handler.handle(processedMessage, connection);
          if (result.success) {
            break; // Stop at first successful handler
          }
        }
      }

      if (!result) {
        return {
          success: false,
          error: `No capable handler found for message type: ${processedMessage.type}`
        };
      }

      // Apply post-processing middleware
      for (const middleware of this.middlewares) {
        if (middleware.afterProcess) {
          await middleware.afterProcess(result, processedMessage, connection);
        }
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Send a message to a crawler connection
   */
  async sendMessage(
    message: WebAppMessage, 
    connection: SocketConnection
  ): Promise<MessageProcessingResult> {
    try {
      // Apply middleware for outgoing messages
      let processedMessage = message;
      for (const middleware of this.middlewares) {
        if (middleware.beforeSend) {
          const result = await middleware.beforeSend(processedMessage, connection);
          if (result) {
            processedMessage = result;
          }
        }
      }

      await connection.send(processedMessage);
      
      // Apply post-send middleware
      for (const middleware of this.middlewares) {
        if (middleware.afterSend) {
          await middleware.afterSend(processedMessage, connection);
        }
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send message'
      };
    }
  }

  /**
   * Get all registered message types
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Get handler count for a message type
   */
  getHandlerCount(messageType: string): number {
    return this.handlers.get(messageType)?.length || 0;
  }
}

// Message middleware interface
export interface MessageMiddleware {
  name: string;
  priority: number;
  beforeProcess?(message: CrawlerMessage, connection: SocketConnection): Promise<CrawlerMessage | null>;
  afterProcess?(result: MessageProcessingResult, message: CrawlerMessage, connection: SocketConnection): Promise<void>;
  beforeSend?(message: WebAppMessage, connection: SocketConnection): Promise<WebAppMessage | null>;
  afterSend?(message: WebAppMessage, connection: SocketConnection): Promise<void>;
}

// Default message handlers
export class HeartbeatHandler implements MessageHandler {
  canHandle(message: CrawlerMessage): boolean {
    return message.type === 'heartbeat';
  }

  async handle(message: CrawlerMessage, connection: SocketConnection): Promise<MessageProcessingResult> {
    // Update connection heartbeat timestamp
    // Update system status metrics
    console.log(`💓 Heartbeat from ${connection.id}:`, message.data);
    
    // Notify admin UI of heartbeat
    adminUIBridge.onCrawlerHeartbeat(connection, message.data);
    
    return {
      success: true,
      data: { acknowledged: true }
    };
  }

  getPriority(): number {
    return 100; // High priority for heartbeats
  }
}

export class JobRequestHandler implements MessageHandler {
  canHandle(message: CrawlerMessage): boolean {
    return message.type === 'job_request';
  }

  async handle(message: CrawlerMessage, connection: SocketConnection): Promise<MessageProcessingResult> {
    console.log(`🔍 JOB-HANDLER: Processing job request from ${connection.id}`);
    console.log(`📄 JOB-HANDLER: Request message data:`, JSON.stringify(message, null, 2));
    
    try {
      // For now, create a simple mock job for testing
      // In production, this would query the database for pending jobs
      console.log(`📋 JOB-HANDLER: Fetching available jobs...`);
      const mockJobs = await this.getAvailableJobs();
      console.log(`✅ JOB-HANDLER: Found ${mockJobs.length} available jobs`);
      
      // Debug: Log jobs with access tokens
      mockJobs.forEach((job, index) => {
        console.log(`🔍 JOB-HANDLER: Job ${index + 1}:`, {
          id: job.id,
          entityType: job.entityType,
          entityId: job.entityId,
          gitlabUrl: job.gitlabUrl,
          hasAccessToken: !!job.accessToken,
          accessTokenLength: job.accessToken?.length || 0,
          accessTokenPreview: job.accessToken ? `${job.accessToken.substring(0, 10)}...` : 'MISSING'
        });
      });
      
      // Send job response back to crawler
      const jobResponse = {
        type: 'job_response' as const,
        timestamp: new Date().toISOString(),
        data: {
          jobs: mockJobs
        }
      };
      
      console.log(`📤 JOB-HANDLER: Sending job response to ${connection.id} with ${mockJobs.length} jobs`);
      await connection.send(jobResponse);
      console.log(`✅ JOB-HANDLER: Job response sent successfully`);
      
      console.log(`📊 JOB-HANDLER: Sent ${mockJobs.length} jobs to ${connection.id}`);
      
      return {
        success: true,
        data: { jobs_sent: mockJobs.length }
      };
    } catch (error) {
      console.error('💥 JOB-HANDLER: Error handling job request:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async getAvailableJobs() {
    // Use real job service to fetch available jobs from database
    console.log('📋 Fetching available jobs from database...');
    
    try {
      const jobs = await jobService.getAvailableJobs(5); // Get up to 5 jobs
      console.log(`✅ Found ${jobs.length} available jobs`);
      return jobs;
    } catch (error) {
      console.error('❌ Error fetching jobs from database:', error);
      return [];
    }
  }

  getPriority(): number {
    return 95; // High priority for job requests
  }
}

export class JobStartedHandler implements MessageHandler {
  canHandle(message: CrawlerMessage): boolean {
    return message.type === 'job_started';
  }

  async handle(message: CrawlerMessage, connection: SocketConnection): Promise<MessageProcessingResult> {
    console.log(`🚀 Job started: ${message.jobId}`);
    
    try {
      if (!message.jobId) {
        return {
          success: false,
          error: 'Missing jobId in job_started message'
        };
      }

      const success = await jobService.markJobStarted(
        message.jobId,
        connection.id,
        message.data
      );

      if (success) {
        console.log(`✅ Job ${message.jobId} marked as started in database`);
        
        // Notify admin UI of job start - pass message data directly for started events
        adminUIBridge.onJobStarted(connection, message.jobId, message.data);
        
        return {
          success: true,
          data: { job_started: true }
        };
      } else {
        return {
          success: false,
          error: 'Failed to update job status in database'
        };
      }
    } catch (error) {
      console.error('Error handling job started:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  getPriority(): number {
    return 85;
  }
}

export class JobProgressHandler implements MessageHandler {
  canHandle(message: CrawlerMessage): boolean {
    return message.type === 'job_progress';
  }

  async handle(message: CrawlerMessage, connection: SocketConnection): Promise<MessageProcessingResult> {
    console.log(`📈 Job progress: ${message.jobId}`);
    
    try {
      if (!message.jobId) {
        return {
          success: false,
          error: 'Missing jobId in job_progress message'
        };
      }

      // Convert crawler progress data format to backend expected format
      const crawlerProgressData = message.data as {
        stage: 'discovering' | 'fetching' | 'completed' | 'failed';
        entityType: string;
        processed: number;
        total?: number;
        message?: string;
        resumeState?: any;
      };

      // Transform to backend expected ProgressData format
      const backendProgressData = {
        entity_type: crawlerProgressData.entityType,
        total_discovered: crawlerProgressData.total || 0,
        total_processed: crawlerProgressData.processed,
        current_page: crawlerProgressData.resumeState?.currentPage,
        items_per_page: undefined,
        sub_collection: undefined,
        estimated_remaining: undefined
      };

      const success = await jobService.updateJobProgress(
        message.jobId,
        backendProgressData,
        connection.id
      );

      if (success) {
        console.log(`✅ Progress updated for job ${message.jobId}`);
        
        // Notify admin UI of job progress (using backend format)
        adminUIBridge.onJobProgress(connection, message.jobId, backendProgressData);
        
        return {
          success: true,
          data: { progress_updated: true }
        };
      } else {
        return {
          success: false,
          error: 'Failed to update job progress in database'
        };
      }
    } catch (error) {
      console.error('Error handling job progress:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  getPriority(): number {
    return 90;
  }
}

export class JobCompletedHandler implements MessageHandler {
  canHandle(message: CrawlerMessage): boolean {
    return message.type === 'job_completed';
  }

  async handle(message: CrawlerMessage, connection: SocketConnection): Promise<MessageProcessingResult> {
    console.log(`🎉 Job completed: ${message.jobId}`);
    
    try {
      if (!message.jobId) {
        return {
          success: false,
          error: 'Missing jobId in job_completed message'
        };
      }

      // Extract completion data from job_completed message data
      const completionData = message.data as {
        success: boolean;
        finalCounts: Record<string, number>;
        message?: string;
        outputFiles?: string[];
      };

      const success = await jobService.markJobCompleted(
        message.jobId,
        completionData,
        connection.id
      );

      if (success) {
        console.log(`✅ Job ${message.jobId} marked as completed in database`);
        
        // Notify admin UI of job completion
        adminUIBridge.onJobCompleted(connection, message.jobId, completionData);
        
        return {
          success: true,
          data: { job_completed: true }
        };
      } else {
        return {
          success: false,
          error: 'Failed to update job status in database'
        };
      }
    } catch (error) {
      console.error('Error handling job completed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  getPriority(): number {
    return 80;
  }
}

export class JobFailedHandler implements MessageHandler {
  canHandle(message: CrawlerMessage): boolean {
    return message.type === 'job_failed';
  }

  async handle(message: CrawlerMessage, connection: SocketConnection): Promise<MessageProcessingResult> {
    console.log(`❌ Job failed: ${message.jobId}`);
    
    try {
      if (!message.jobId) {
        return {
          success: false,
          error: 'Missing jobId in job_failed message'
        };
      }

      // Extract failure data from job_failed message data
      const failureData = message.data as {
        error: string;
        errorType?: string;
        isRecoverable: boolean;
        resumeState?: any;
        partialCounts?: Record<string, number>;
      };

      const success = await jobService.markJobFailed(
        message.jobId,
        failureData,
        connection.id
      );

      if (success) {
        console.log(`✅ Job ${message.jobId} marked as failed in database`);
        
        // Notify admin UI of job failure
        adminUIBridge.onJobFailed(connection, message.jobId, failureData);
        
        return {
          success: true,
          data: { job_failed: true }
        };
      } else {
        return {
          success: false,
          error: 'Failed to update job status in database'
        };
      }
    } catch (error) {
      console.error('Error handling job failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  getPriority(): number {
    return 80;
  }
}

// Message validation middleware
export class ValidationMiddleware implements MessageMiddleware {
  name = 'validation';
  priority = 1000;

  async beforeProcess(message: CrawlerMessage, connection: SocketConnection): Promise<CrawlerMessage | null> {
    // Validate message structure
    if (!message.type || !message.timestamp) {
      throw new Error('Invalid message structure');
    }
    
    return message;
  }
}

export class TokenRefreshHandler implements MessageHandler {
  canHandle(message: CrawlerMessage): boolean {
    return message.type === 'token_refresh_request';
  }

  async handle(message: CrawlerMessage, connection: SocketConnection): Promise<MessageProcessingResult> {
    console.log(`🔄 Token refresh requested: ${message.jobId}`);
    
    try {
      if (!message.jobId) {
        return {
          success: false,
          error: 'Missing jobId in token_refresh_request message'
        };
      }

      // Get job details to fetch account information
      const job = await jobService.getJobStatus(message.jobId);
      
      if (!job) {
        return {
          success: false,
          error: `Job ${message.jobId} not found`
        };
      }

      // TODO: Implement token refresh logic with OAuth provider
      // For now, send back current token (in production, refresh with OAuth provider)
      const tokenResponse = {
        type: 'token_refresh_response' as const,
        timestamp: new Date().toISOString(),
        jobId: message.jobId,
        data: {
          accessToken: job.usingAccount?.access_token || '', // Fixed: use correct property path
          refreshSuccessful: true, // Fixed: use correct property name
          expiresAt: new Date(Date.now() + 3600000).toISOString() // 1 hour from now
        }
      };
      
      await connection.send(tokenResponse);
      
      console.log(`✅ Token refresh response sent for job ${message.jobId}`);
      
      return {
        success: true,
        data: { token_refreshed: true }
      };
    } catch (error) {
      console.error('Error handling token refresh:', error);
      
      // Send failure response
      try {
        const errorResponse = {
          type: 'token_refresh_response' as const,
          timestamp: new Date().toISOString(),
          jobId: message.jobId,
          data: {
            accessToken: '', // Required field
            refreshSuccessful: false, // Fixed: use correct property name
            expiresAt: new Date().toISOString()
          }
        };
        
        await connection.send(errorResponse);
      } catch (sendError) {
        console.error('Failed to send token refresh error response:', sendError);
      }
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  getPriority(): number {
    return 85;
  }
}

// Message compatibility middleware to handle field name differences
export class CompatibilityMiddleware implements MessageMiddleware {
  name = 'compatibility';
  priority = 500; // High priority to transform early

  async beforeProcess(message: CrawlerMessage, connection: SocketConnection): Promise<CrawlerMessage | null> {
    // No transformation needed anymore - messages now use jobId consistently
    console.log(`📝 Processing ${message.type} message with jobId: ${message.jobId || 'none'}`);
    return message;
  }
}

// Logging middleware
export class LoggingMiddleware implements MessageMiddleware {
  name = 'logging';
  priority = 10;

  async beforeProcess(message: CrawlerMessage, connection: SocketConnection): Promise<CrawlerMessage | null> {
    console.log(`📨 Received ${message.type} from ${connection.id}`);
    return null; // Don't modify message
  }

  async afterProcess(result: MessageProcessingResult, message: CrawlerMessage, connection: SocketConnection): Promise<void> {
    if (!result.success) {
      console.error(`❌ Failed to process ${message.type}: ${result.error}`);
    }
  }
}

// Create and configure default router
export const createDefaultRouter = (): MessageRouter => {
  const router = new MessageRouter();
  
  // Register default handlers
  router.registerHandler('heartbeat', new HeartbeatHandler());
  router.registerHandler('job_request', new JobRequestHandler());
  router.registerHandler('job_started', new JobStartedHandler());
  router.registerHandler('job_progress', new JobProgressHandler());
  router.registerHandler('job_completed', new JobCompletedHandler());
  router.registerHandler('job_failed', new JobFailedHandler());
  router.registerHandler('token_refresh_request', new TokenRefreshHandler());
  
  // Add default middleware
  router.addMiddleware(new ValidationMiddleware());
  router.addMiddleware(new CompatibilityMiddleware());
  router.addMiddleware(new LoggingMiddleware());
  
  console.log('✅ Message router configured with handlers:', router.getRegisteredTypes());
  
  return router;
};