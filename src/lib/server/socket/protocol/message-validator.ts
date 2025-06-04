import { getLogger } from 'nodemailer/lib/shared';
import type { 
  CrawlerMessage,
  WebAppMessage,
  MessageProcessingResult,
  SocketServerConfig
} from '../types/index.js';
import { 
  validateCrawlerMessage,
  validateWebAppMessage
} from '../types/messages.js';

/**
 * MessageValidator - Comprehensive message validation
 * 
 * Implements message validation using Zod schemas with specific validation
 * for each message type, custom validation rules, and detailed error reporting.
 */
export class MessageValidator {
  private readonly config: SocketServerConfig;
  private validationStats = {
    totalValidated: 0,
    validMessages: 0,
    invalidMessages: 0,
    errorsByType: new Map<string, number>()
  };

  constructor(config: SocketServerConfig) {
    this.config = config;
  }

  /**
   * Validate a crawler message
   */
  validateCrawlerMessage(message: unknown): MessageProcessingResult<CrawlerMessage> {
    this.validationStats.totalValidated++;

    try {
      // Basic structure validation
      const result = validateCrawlerMessage(message);
      
      if (!result.success) {
        this.recordValidationError('schema', result.error || 'Schema validation failed');
        return result;
      }

      // Additional business logic validation
      const businessValidation = this.validateCrawlerBusinessRules(result.data!);
      if (!businessValidation.success) {
        this.recordValidationError('business', businessValidation.error || 'Business rule validation failed');
        return businessValidation;
      }

      // Message size validation
      const sizeValidation = this.validateMessageSize(message);
      if (!sizeValidation.success) {
        this.recordValidationError('size', sizeValidation.error || 'Message size validation failed');
        return sizeValidation as MessageProcessingResult<CrawlerMessage>;
      }

      this.validationStats.validMessages++;
      return { success: true, data: result.data };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown validation error';
      this.recordValidationError('exception', errorMessage);
      return { 
        success: false, 
        error: `Validation exception: ${errorMessage}` 
      };
    }
  }

  /**
   * Validate a web app message
   */
  validateWebAppMessage(message: unknown): MessageProcessingResult<WebAppMessage> {
    this.validationStats.totalValidated++;

    try {
      // Basic structure validation
      const result = validateWebAppMessage(message);
      
      if (!result.success) {
        this.recordValidationError('schema', result.error || 'Schema validation failed');
        return result;
      }

      // Additional business logic validation
      const businessValidation = this.validateWebAppBusinessRules(result.data!);
      if (!businessValidation.success) {
        this.recordValidationError('business', businessValidation.error || 'Business rule validation failed');
        return businessValidation;
      }

      // Message size validation
      const sizeValidation = this.validateMessageSize(message);
      if (!sizeValidation.success) {
        this.recordValidationError('size', sizeValidation.error || 'Message size validation failed');
        return sizeValidation as MessageProcessingResult<WebAppMessage>;
      }

      this.validationStats.validMessages++;
      return { success: true, data: result.data };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown validation error';
      this.recordValidationError('exception', errorMessage);
      return { 
        success: false, 
        error: `Validation exception: ${errorMessage}` 
      };
    }
  }

  /**
   * Validate message structure without type checking
   */
  validateMessageStructure(message: unknown): MessageProcessingResult<any> {
    if (!message || typeof message !== 'object') {
      return { 
        success: false, 
        error: 'Message must be a non-null object' 
      };
    }

    const msg = message as Record<string, any>;

    // Check required base fields
    if (!msg.type || typeof msg.type !== 'string') {
      return { 
        success: false, 
        error: 'Message must have a valid type field' 
      };
    }

    if (!msg.timestamp || typeof msg.timestamp !== 'string') {
      return { 
        success: false, 
        error: 'Message must have a valid timestamp field' 
      };
    }

    // Validate timestamp format
    const timestamp = new Date(msg.timestamp);
    if (isNaN(timestamp.getTime())) {
      return { 
        success: false, 
        error: 'Message timestamp must be a valid ISO 8601 string' 
      };
    }

    // Check timestamp is not too old or too far in the future
    const now = Date.now();
    const messageTime = timestamp.getTime();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    const maxFuture = 5 * 60 * 1000; // 5 minutes

    if (now - messageTime > maxAge) {
      return { 
        success: false, 
        error: 'Message timestamp is too old' 
      };
    }

    if (messageTime - now > maxFuture) {
      return { 
        success: false, 
        error: 'Message timestamp is too far in the future' 
      };
    }

    return { success: true, data: msg };
  }

  /**
   * Get validation statistics
   */
  getValidationStats() {
    return {
      ...this.validationStats,
      errorsByType: Object.fromEntries(this.validationStats.errorsByType),
      successRate: this.validationStats.totalValidated > 0 
        ? this.validationStats.validMessages / this.validationStats.totalValidated 
        : 0
    };
  }

  /**
   * Reset validation statistics
   */
  resetStats(): void {
    this.validationStats = {
      totalValidated: 0,
      validMessages: 0,
      invalidMessages: 0,
      errorsByType: new Map<string, number>()
    };
  }

  private validateCrawlerBusinessRules(message: CrawlerMessage): MessageProcessingResult<CrawlerMessage> {
    switch (message.type) {
      case 'heartbeat':
        return this.validateHeartbeatMessage(message);
      
      case 'job_progress':
        return this.validateJobProgressMessage(message);
      
      case 'job_started':
      case 'job_completed':
      case 'job_failed':
        return this.validateJobMessage(message);
      
      case 'token_refresh_request':
        return this.validateTokenRefreshRequest(message);
      
      default:
        return { 
          success: false, 
          error: `Unknown crawler message type: ${message.type}` 
        };
    }
  }

  private validateWebAppBusinessRules(message: WebAppMessage): MessageProcessingResult<WebAppMessage> {
    switch (message.type) {
      case 'job_assignment':
        return this.validateJobAssignment(message);
      
      case 'token_refresh_response':
        return this.validateTokenRefreshResponse(message);
      
      case 'shutdown':
        return this.validateShutdownMessage(message);
      
      default:
        return { 
          success: false, 
          error: `Unknown web app message type: ${(message as WebAppMessage).type}` 
        };
    }
  }

  private validateHeartbeatMessage(message: CrawlerMessage): MessageProcessingResult<CrawlerMessage> {
    if (message.type !== 'heartbeat') {
      return { success: false, error: 'Message type mismatch' };
    }

    const data = message.data;
    
    // Validate system status
    const validStatuses = ['idle', 'discovering', 'crawling', 'error'];
    if (!validStatuses.includes(data.system_status)) {
      return { 
        success: false, 
        error: `Invalid system status: ${data.system_status}` 
      };
    }

    // Validate active jobs count
    if (data.active_jobs < 0) {
      return { 
        success: false, 
        error: 'Active jobs count cannot be negative' 
      };
    }

    return { success: true, data: message };
  }

  private validateJobProgressMessage(message: CrawlerMessage): MessageProcessingResult<CrawlerMessage> {
    if (message.type !== 'job_progress') {
      return { success: false, error: 'Message type mismatch' };
    }

    const data = message.data;
    
    // Validate completion percentage
    if (data.overall_completion < 0 || data.overall_completion > 1) {
      return { 
        success: false, 
        error: 'Overall completion must be between 0 and 1' 
      };
    }

    // Validate progress data
    for (const progress of data.progress) {
      if (progress.total_processed > progress.total_discovered) {
        return { 
          success: false, 
          error: `Processed count (${progress.total_processed}) cannot exceed discovered count (${progress.total_discovered}) for ${progress.entity_type}` 
        };
      }
    }

    return { success: true, data: message };
  }

  private validateJobMessage(message: CrawlerMessage): MessageProcessingResult<CrawlerMessage> {
    if (!message.job_id) {
      return { 
        success: false, 
        error: 'Job messages must include job_id' 
      };
    }

    // Validate job_id format (basic validation)
    if (message.job_id.length < 3) {
      return { 
        success: false, 
        error: 'Job ID must be at least 3 characters long' 
      };
    }

    return { success: true, data: message };
  }

  private validateTokenRefreshRequest(message: CrawlerMessage): MessageProcessingResult<CrawlerMessage> {
    if (message.type !== 'token_refresh_request') {
      return { success: false, error: 'Message type mismatch' };
    }

    if (!message.job_id) {
      return { 
        success: false, 
        error: 'Token refresh request must include job_id' 
      };
    }

    return { success: true, data: message };
  }

  private validateJobAssignment(message: WebAppMessage): MessageProcessingResult<WebAppMessage> {
    if (message.type !== 'job_assignment') {
      return { success: false, error: 'Message type mismatch' };
    }

    const data = message.data;
    
    // Validate job_id
    if (!data.job_id || data.job_id.length < 3) {
      return { 
        success: false, 
        error: 'Job assignment must have a valid job_id' 
      };
    }

    // Validate access token
    if (!data.access_token || data.access_token.length < 10) {
      return { 
        success: false, 
        error: 'Job assignment must have a valid access_token' 
      };
    }

    // Validate GitLab host
    try {
      new URL(data.gitlab_host);
    } catch {
      return { 
        success: false, 
        error: 'Job assignment must have a valid gitlab_host URL' 
      };
    }

    return { success: true, data: message };
  }

  private validateTokenRefreshResponse(message: WebAppMessage): MessageProcessingResult<WebAppMessage> {
    if (message.type !== 'token_refresh_response') {
      return { success: false, error: 'Message type mismatch' };
    }

    const data = message.data;
    
    if (data.refresh_successful && !data.access_token) {
      return { 
        success: false, 
        error: 'Successful token refresh must include access_token' 
      };
    }

    return { success: true, data: message };
  }

  private validateShutdownMessage(message: WebAppMessage): MessageProcessingResult<WebAppMessage> {
    if (message.type !== 'shutdown') {
      return { success: false, error: 'Message type mismatch' };
    }

    const data = message.data;
    
    if (data.timeout_seconds && data.timeout_seconds < 0) {
      return { 
        success: false, 
        error: 'Shutdown timeout cannot be negative' 
      };
    }

    return { success: true, data: message };
  }

  private validateMessageSize(message: unknown): MessageProcessingResult<void> {
    const maxSize = this.config.maxMessageSize || 1024 * 1024; // 1MB default
    
    try {
      const messageString = JSON.stringify(message);
      const size = Buffer.byteLength(messageString, 'utf8');
      
      if (size > maxSize) {
        return { 
          success: false, 
          error: `Message size (${size} bytes) exceeds maximum allowed size (${maxSize} bytes)` 
        };
      }
      
      return { success: true };
    } catch (error: any) {
      getLogger(["backend", "socket", "validator"]).error(error)
      return { 
        success: false, 
        error: 'Failed to calculate message size' 
      };
    }
  }

  private recordValidationError(type: string, error: string): void {
    this.validationStats.invalidMessages++;
    const currentCount = this.validationStats.errorsByType.get(type) || 0;
    this.validationStats.errorsByType.set(type, currentCount + 1);
    getLogger(["backend", "socket", "validator"]).error(error)
  }
}

/**
 * Factory function to create a message validator
 */
export function createMessageValidator(config: SocketServerConfig): MessageValidator {
  return new MessageValidator(config);
}