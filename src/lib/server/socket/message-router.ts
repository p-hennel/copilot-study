/* eslint-disable @typescript-eslint/no-unused-vars */
import type { 
  CrawlerMessage, 
  WebAppMessage, 
  MessageProcessingResult,
  SocketConnection 
} from './types';

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
    console.log(`Heartbeat from ${connection.id}:`, message.data);
    
    return {
      success: true,
      data: { acknowledged: true }
    };
  }

  getPriority(): number {
    return 100; // High priority for heartbeats
  }
}

export class JobProgressHandler implements MessageHandler {
  canHandle(message: CrawlerMessage): boolean {
    return message.type === 'job_progress';
  }

  async handle(message: CrawlerMessage, connection: SocketConnection): Promise<MessageProcessingResult> {
    // Update progress tracking
    // Persist progress to database
    // Broadcast progress to web clients
    console.log(`Job progress: ${message.job_id}`, message.data);
    
    return {
      success: true,
      data: { progress_updated: true }
    };
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
    // Update job status to completed
    // Process final results
    // Notify web clients
    console.log(`Job completed: ${message.job_id}`);
    
    return {
      success: true,
      data: { job_completed: true }
    };
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

// Logging middleware
export class LoggingMiddleware implements MessageMiddleware {
  name = 'logging';
  priority = 10;

  async beforeProcess(message: CrawlerMessage, connection: SocketConnection): Promise<CrawlerMessage | null> {
    console.log(`Received ${message.type} from ${connection.id}`);
    return null; // Don't modify message
  }

  async afterProcess(result: MessageProcessingResult, message: CrawlerMessage, connection: SocketConnection): Promise<void> {
    if (!result.success) {
      console.error(`Failed to process ${message.type}: ${result.error}`);
    }
  }
}

// Create and configure default router
export const createDefaultRouter = (): MessageRouter => {
  const router = new MessageRouter();
  
  // Register default handlers
  router.registerHandler('heartbeat', new HeartbeatHandler());
  router.registerHandler('job_progress', new JobProgressHandler());
  router.registerHandler('job_completed', new JobCompletedHandler());
  
  // Add default middleware
  router.addMiddleware(new ValidationMiddleware());
  router.addMiddleware(new LoggingMiddleware());
  
  return router;
};