import { validateCrawlerMessage } from './types/messages.js';

/* eslint-disable @typescript-eslint/no-unused-vars */
import { auth } from '$lib/auth.js';
import { getLogger } from '$lib/logging';
import type { 
  CrawlerMessage, 
  WebAppMessage, 
  MessageProcessingResult,
  SocketConnection 
} from './types';
import { jobService } from './services/job-service.js';
import { adminUIBridge } from './services/admin-ui-bridge.js';
import { DiscoveryHandler } from './handlers/discovery-handler';
import { DatabaseManager } from './persistence/database-manager';

class DiscoveryHandlerAdapter {
  private handler: DiscoveryHandler;
  constructor(dbManager: DatabaseManager) {
    this.handler = new DiscoveryHandler(dbManager);
  }
  canHandle(message: any) {
    return message.type === 'jobs_discovered';
  }
  async handle(message: any, connection: any) {
    logger.debug(`DiscoveryHandlerAdapter: Handling jobs_discovered message. Raw message:`, message);
    logger.debug(`DiscoveryHandlerAdapter: Full message data:`, message.data);
    logger.debug(`DiscoveryHandlerAdapter: Discovered jobs data:`, message.data?.discovered_jobs);
    await this.handler.handleJobsDiscovered(connection, message);
    return { success: true };
  }
  getPriority() {
    return 0;
  }
}
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
      // Validate incoming message against Zod schema
      const validationResult = validateCrawlerMessage(message);
      if (!validationResult.success) {
        logger.error(`❌ Message validation failed: ${validationResult.error}`, message);
        return {
          success: false,
          error: `Message validation failed: ${validationResult.error}`
        };
      }
      if (!validationResult.data) {
        logger.error("❌ Validation succeeded but data is undefined", { message });
        return {
          success: false,
          error: "Validation succeeded but data is undefined"
        };
      }
      let processedMessage: CrawlerMessage = validationResult.data;

      // Apply pre-processing middleware
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
    logger.debug(`💓 Heartbeat from ${connection.id}:`, message.data);
    
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
    logger.debug(`🔍 JOB-HANDLER: Processing job request from ${connection.id}`);
    logger.debug(`📄 SOCKET-SERVER: Message data: ${JSON.stringify(message, null, 2)}`);
    
    try {
      // For now, create a simple mock job for testing
      // In production, this would query the database for pending jobs
      logger.debug(`📋 JOB-HANDLER: Fetching available jobs...`);
      let mockJobs = await this.getAvailableJobs();
      logger.debug(`✅ JOB-HANDLER: Found ${mockJobs.length} available jobs`);
      
      // Filter out jobs with entityType "areas" (not supported by crawler)
      mockJobs = mockJobs.filter(job => job.entityType !== "areas");
      
      // Debug: Log jobs with access tokens
      mockJobs.forEach((job, index) => {
        logger.debug(`🔍 JOB-HANDLER: Job ${index + 1}:`, {
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
          jobs: mockJobs.map(job => ({
            ...job,
            entityType: job.entityType as (
              "user" | "group" | "project" | "branch" | "issue" | "merge_request" | "commit" | "pipeline" | "release"
            )
          }))
        }
      };
      
      logger.debug(`📤 JOB-HANDLER: Sending job response to ${connection.id} with ${mockJobs.length} jobs`);
      await connection.send(jobResponse);
      logger.debug(`✅ JOB-HANDLER: Job response sent successfully`);
      
      logger.debug(`📊 JOB-HANDLER: Sent ${mockJobs.length} jobs to ${connection.id}`);
      
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
    logger.debug(`📋 JOB-HANDLER: Fetching available jobs...`);
    
    try {
      const jobs = await jobService.getAvailableJobs(5); // Get up to 5 jobs
      logger.debug(`✅ Found ${jobs.length} available jobs`);
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
    logger.debug(`🚀 Job started: ${message.jobId}`);
    
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
        logger.debug(`✅ Job ${message.jobId} marked as started in database`);
        
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
    logger.debug(`📈 Job progress: ${message.jobId}`);
    
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
        // Enhanced progress data
        itemCounts?: Record<string, number>;
        processingRate?: number;
        estimatedTimeRemaining?: number;
      };

      // Transform to backend expected ProgressData format
      const backendProgressData = {
        entity_type: crawlerProgressData.entityType,
        total_discovered: crawlerProgressData.total || 0,
        total_processed: crawlerProgressData.processed,
        current_page: crawlerProgressData.resumeState?.currentPage,
        items_per_page: undefined,
        sub_collection: undefined,
        estimated_remaining: undefined,
        // Pass through enhanced progress data
        item_counts: crawlerProgressData.itemCounts || {},
        processing_rate: crawlerProgressData.processingRate,
        estimated_time_remaining: crawlerProgressData.estimatedTimeRemaining
      };

      const success = await jobService.updateJobProgress(
        message.jobId,
        backendProgressData,
        connection.id
      );

      if (success) {
        logger.debug(`✅ Progress updated for job ${message.jobId}`);
        
        // Notify admin UI of job progress (using backend format)
        adminUIBridge.onJobProgress(connection, message.jobId, backendProgressData);
        
        return {
          success: true,
          data: { progress_updated: true }
        };
      } else {
        return {
          success: false,
          error: 'Failed to update job status in database'
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
    logger.debug(`🎉 Job completed: ${message.jobId}`);
    
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
        logger.debug(`✅ Job ${message.jobId} marked as completed in database`);
        
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
    logger.debug(`❌ Job failed: ${message.jobId}`);
    
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
        stackTrace?: string;
        isRecoverable: boolean;
        resumeState?: any;
        partialCounts?: Record<string, number>;
        requestDetails?: {
          method?: string;
          url?: string;
          status_code?: number;
          response_headers?: Record<string, string>;
        };
        retryCount?: number;
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

const logger = getLogger(['socket-message-router']);

export class TokenRefreshHandler implements MessageHandler {
  canHandle(message: CrawlerMessage): boolean {
    return message.type === 'token_refresh_request';
  }

  async handle(message: CrawlerMessage, connection: SocketConnection): Promise<MessageProcessingResult> {
    logger.warn(`🔄 Token refresh requested: ${message.jobId}`);
    
    try {
      if (!message.jobId) {
        return {
          success: false,
          error: 'Missing jobId in token_refresh_request message'
        };
      }

      const job = await jobService.getJobById(message.jobId);
      
      if (!job) {
        return {
          success: false,
          error: `Job ${message.jobId} not found`
        };
      }
      
      if (!job.usingAccount) {
        return {
          success: false,
          error: `Job ${message.jobId} not found or has no associated account`
        };
      }

      logger.warn(`Attempting to get access token for provider: ${job.usingAccount.provider}, account: ${job.usingAccount.id}`);
      const refreshed = await auth.api.getAccessToken({
        body: {
          providerId: job.usingAccount.providerId,
          accountId: job.usingAccount.id,
          userId: job.usingAccount.userId,
        }
      });
      logger.warn(`Result of getAccessToken: ${JSON.stringify(refreshed)}`);

      const tokenResponse: WebAppMessage = {
        type: 'token_refresh_response' as const,
        timestamp: new Date().toISOString(),
        jobId: message.jobId,
        data: {
          accessToken: refreshed.accessToken ?? "",
          refreshSuccessful: true,
          expiresAt: new Date(Date.now() + 3600000).toISOString() // 1 hour from now
        }
      };

      logger.warn(`[SOCKET] Full token_refresh_response payload:`, tokenResponse);

      await connection.send(tokenResponse);

      logger.warn(`✅ Token refresh response sent for job ${message.jobId}`);
      
      return {
        success: true,
        data: { token_refreshed: true }
      };
    } catch (error: any) {
      logger.error('Error handling token refresh:', error);
      
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
      } catch (sendError: any) {
        logger.error('Failed to send token refresh error response:', sendError);
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
    logger.debug(`📝 Processing ${message.type} message with jobId: ${message.jobId || 'none'}`);
    return message;
  }
}

// Logging middleware
export class LoggingMiddleware implements MessageMiddleware {
  name = 'logging';
  priority = 10;

  async beforeProcess(message: CrawlerMessage, connection: SocketConnection): Promise<CrawlerMessage | null> {
    logger.debug(`📨 Received ${message.type} from ${connection.id}`);
    return null; // Don't modify message
  }

  async afterProcess(result: MessageProcessingResult, message: CrawlerMessage, connection: SocketConnection): Promise<void> {
    if (!result.success) {
      logger.error(`❌ Failed to process ${message.type}: ${result.error}`);
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
  const dbManager = new DatabaseManager();
  router.registerHandler('jobs_discovered', new DiscoveryHandlerAdapter(dbManager));

  // Add default middleware
  router.addMiddleware(new ValidationMiddleware());
  router.addMiddleware(new CompatibilityMiddleware());
  router.addMiddleware(new LoggingMiddleware());
  
  console.log('✅ Message router configured with handlers:', router.getRegisteredTypes());
  
  return router;
};