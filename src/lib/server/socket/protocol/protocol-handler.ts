import { EventEmitter } from 'events';
import type { 
  SocketServerConfig,
  SocketConnection,
  CrawlerMessage,
  WebAppMessage,
  MessageProcessingResult
} from '../types/index.js';
import { MessageParser } from './message-parser.js';
import { MessageValidator } from './message-validator.js';

/**
 * ProtocolHandler - Main protocol coordination
 * 
 * Coordinates message parsing, validation, and routing with comprehensive
 * error handling for malformed messages and protocol violations.
 * Supports protocol versioning and backwards compatibility.
 */
export class ProtocolHandler extends EventEmitter {
  private messageParser: MessageParser;
  private messageValidator: MessageValidator;
  private protocolStats = {
    messagesProcessed: 0,
    messagesRouted: 0,
    protocolErrors: 0,
    validationErrors: 0,
    parseErrors: 0
  };

  constructor(private readonly config: SocketServerConfig) {
    super();
    this.messageParser = new MessageParser(config);
    this.messageValidator = new MessageValidator(config);
  }

  /**
   * Process incoming data from a connection
   */
  async processIncomingData(
    connection: SocketConnection, 
    data: Buffer
  ): Promise<MessageProcessingResult<void>> {
    try {
      // Parse messages from data
      const parseResult = this.messageParser.processData(data);
      
      if (!parseResult.success) {
        this.protocolStats.parseErrors++;
        this.emit('parse_error', {
          connectionId: connection.id,
          error: parseResult.error,
          timestamp: new Date()
        });
        
        return {
          success: false,
          error: parseResult.error,
          shouldRetry: parseResult.shouldRetry
        };
      }

      // Process each parsed message
      const messages = parseResult.data || [];
      const results: MessageProcessingResult<void>[] = [];

      for (const message of messages) {
        const result = await this.processMessage(connection, message);
        results.push(result);
      }

      // Determine overall success
      const hasErrors = results.some(r => !r.success);
      const errorMessages = results
        .filter(r => !r.success)
        .map(r => r.error)
        .join('; ');

      this.protocolStats.messagesProcessed += messages.length;

      if (hasErrors) {
        return {
          success: false,
          error: `Some messages failed: ${errorMessages}`
        };
      }

      return { success: true };

    } catch (error) {
      this.protocolStats.protocolErrors++;
      return {
        success: false,
        error: `Protocol processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Process a single parsed message
   */
  async processMessage(
    connection: SocketConnection, 
    message: CrawlerMessage
  ): Promise<MessageProcessingResult<void>> {
    try {
      // Additional validation
      const validationResult = this.validateMessageForConnection(connection, message);
      if (!validationResult.success) {
        this.protocolStats.validationErrors++;
        this.emit('validation_error', {
          connectionId: connection.id,
          messageType: message.type,
          error: validationResult.error,
          timestamp: new Date()
        });
        return validationResult;
      }

      // Route message based on type
      await this.routeMessage(connection, message);
      
      this.protocolStats.messagesRouted++;
      this.emit('message_routed', {
        connectionId: connection.id,
        messageType: message.type,
        timestamp: new Date()
      });

      return { success: true };

    } catch (error) {
      this.protocolStats.protocolErrors++;
      this.emit('processing_error', {
        connectionId: connection.id,
        messageType: message.type,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date()
      });

      return {
        success: false,
        error: `Message processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Send a message to a connection
   */
  async sendMessage(
    connection: SocketConnection,
    message: WebAppMessage
  ): Promise<MessageProcessingResult<void>> {
    try {
      // Validate outgoing message
      const validationResult = this.messageValidator.validateWebAppMessage(message);
      if (!validationResult.success) {
        this.emit('outgoing_validation_error', {
          connectionId: connection.id,
          messageType: message.type,
          error: validationResult.error,
          timestamp: new Date()
        });
        return validationResult as MessageProcessingResult<void>;
      }

      // Send through connection
      await connection.send(message);

      this.emit('message_sent', {
        connectionId: connection.id,
        messageType: message.type,
        timestamp: new Date()
      });

      return { success: true };

    } catch (error) {
      this.emit('send_error', {
        connectionId: connection.id,
        messageType: message.type,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date()
      });

      return {
        success: false,
        error: `Message send failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Get protocol statistics
   */
  getProtocolStats() {
    return {
      ...this.protocolStats,
      parsingStats: this.messageParser.getParsingStats(),
      validationStats: this.messageValidator.getValidationStats(),
      successRate: this.protocolStats.messagesProcessed > 0
        ? this.protocolStats.messagesRouted / this.protocolStats.messagesProcessed
        : 0
    };
  }

  /**
   * Reset all statistics
   */
  resetStats(): void {
    this.protocolStats = {
      messagesProcessed: 0,
      messagesRouted: 0,
      protocolErrors: 0,
      validationErrors: 0,
      parseErrors: 0
    };
    this.messageParser.resetStats();
    this.messageValidator.resetStats();
  }

  /**
   * Get buffer status
   */
  getBufferStatus() {
    return {
      hasCapacity: this.messageParser.hasCapacity(),
      usage: this.messageParser.getBufferUsage(),
      hasPartialMessage: this.messageParser.hasPartialMessage(),
      estimatedMessageCount: this.messageParser.estimateMessageCount()
    };
  }

  /**
   * Force flush partial messages (emergency cleanup)
   */
  async forceFlush(connection: SocketConnection): Promise<MessageProcessingResult<void>> {
    try {
      const flushResult = this.messageParser.forceFlush();
      
      if (flushResult.success && flushResult.data) {
        // Process any flushed messages
        for (const message of flushResult.data) {
          await this.processMessage(connection, message);
        }
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Force flush failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  private validateMessageForConnection(
    connection: SocketConnection, 
    message: CrawlerMessage
  ): MessageProcessingResult<void> {
    // Check if connection is authenticated for certain message types
    if (['job_progress', 'job_started', 'job_completed', 'job_failed'].includes(message.type)) {
      if (!connection.metadata.crawlerId) {
        return {
          success: false,
          error: 'Connection must be authenticated to send job-related messages'
        };
      }

      if (!message.jobId) {
        return {
          success: false,
          error: 'Job-related messages must include jobId'
        };
      }
    }

    // Validate heartbeat frequency (prevent spam)
    if (message.type === 'heartbeat') {
      const lastHeartbeat = connection.metadata.lastHeartbeat.getTime();
      const now = Date.now();
      const minInterval = 1000; // 1 second minimum between heartbeats
      
      if (now - lastHeartbeat < minInterval) {
        return {
          success: false,
          error: 'Heartbeat messages too frequent'
        };
      }
    }

    return { success: true };
  }

  private async routeMessage(
    connection: SocketConnection, 
    message: CrawlerMessage
  ): Promise<void> {
    // Emit message for handlers to process
    this.emit('message', {
      connection,
      message,
      timestamp: new Date()
    });

    // Update connection metadata based on message type
    switch (message.type) {
      case 'heartbeat':
        connection.metadata.lastHeartbeat = new Date();
        break;
      
      case 'job_started':
      case 'job_progress':
      case 'job_completed':
      case 'job_failed':
        connection.metadata.lastActivity = new Date();
        break;
    }
  }
}

/**
 * ProtocolVersion - Handle protocol versioning
 */
export class ProtocolVersion {
  static readonly CURRENT_VERSION = '1.0.0';
  static readonly SUPPORTED_VERSIONS = ['1.0.0'];

  /**
   * Check if a protocol version is supported
   */
  static isSupported(version: string): boolean {
    return this.SUPPORTED_VERSIONS.includes(version);
  }

  /**
   * Get compatibility info for a version
   */
  static getCompatibility(version: string) {
    if (!this.isSupported(version)) {
      return {
        supported: false,
        reason: 'Version not supported',
        suggestedVersion: this.CURRENT_VERSION
      };
    }

    return {
      supported: true,
      features: this.getVersionFeatures(version)
    };
  }

  private static getVersionFeatures(version: string) {
    switch (version) {
      case '1.0.0':
        return {
          heartbeat: true,
          jobProgress: true,
          tokenRefresh: true,
          errorRecovery: true
        };
      default:
        return {};
    }
  }
}

/**
 * Factory function
 */
export function createProtocolHandler(config: SocketServerConfig): ProtocolHandler {
  return new ProtocolHandler(config);
}

/**
 * Protocol event types for type safety
 */
export interface ProtocolEvent {
  connectionId: string;
  timestamp: Date;
}

export interface MessageEvent extends ProtocolEvent {
  connection: SocketConnection;
  message: CrawlerMessage;
}

export interface ErrorEvent extends ProtocolEvent {
  messageType?: string;
  error: string;
}

export interface StatusEvent extends ProtocolEvent {
  messageType: string;
}