import type { 
  SocketServerConfig,
  MessageBuffer,
  MessageProcessingResult,
  CrawlerMessage
} from '../types/index.js';
import { MessageBufferImpl } from '../connection/message-buffer.js';
import { MessageValidator } from './message-validator.js';

/**
 * MessageParser - Robust newline-delimited JSON message parsing
 * 
 * Implements robust message parsing with buffer management, comprehensive
 * message validation, partial message handling, and buffer overflow protection.
 */
export class MessageParser {
  private messageBuffer: MessageBuffer;
  private validator: MessageValidator;
  private parsingStats = {
    totalMessages: 0,
    validMessages: 0,
    invalidMessages: 0,
    bufferOverflows: 0,
    parseErrors: 0
  };

  constructor(private readonly config: SocketServerConfig) {
    this.messageBuffer = new MessageBufferImpl(
      config.messageBufferSize || 1024 * 1024
    );
    this.validator = new MessageValidator(config);
  }

  /**
   * Process incoming data and extract complete messages
   */
  processData(data: Buffer | string): MessageProcessingResult<CrawlerMessage[]> {
    try {
      // Add data to buffer
      this.messageBuffer.append(data);

      // Extract complete messages
      const delimiter = this.config.messageDelimiter || '\n';
      const messageStrings = this.messageBuffer.extractMessages(delimiter);

      if (messageStrings.length === 0) {
        return { success: true, data: [] };
      }

      // Parse and validate messages
      const messages: CrawlerMessage[] = [];
      const errors: string[] = [];

      for (const messageString of messageStrings) {
        const result = this.parseMessage(messageString);
        
        if (result.success && result.data) {
          messages.push(result.data);
        } else {
          errors.push(result.error || 'Unknown parse error');
        }
      }

      // Return results
      if (messages.length > 0) {
        return { 
          success: true, 
          data: messages,
          error: errors.length > 0 ? `Some messages failed: ${errors.join(', ')}` : undefined
        };
      } else {
        return { 
          success: false, 
          error: `All messages failed: ${errors.join(', ')}`
        };
      }

    } catch (error) {
      this.parsingStats.parseErrors++;
      
      if (error instanceof Error && error.message.includes('Buffer overflow')) {
        this.parsingStats.bufferOverflows++;
        return { 
          success: false, 
          error: 'Buffer overflow - message too large or malformed',
          shouldRetry: false
        };
      }

      return { 
        success: false, 
        error: `Message parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        shouldRetry: true
      };
    }
  }

  /**
   * Parse a single message string
   */
  parseMessage(messageString: string): MessageProcessingResult<CrawlerMessage> {
    this.parsingStats.totalMessages++;

    try {
      // Validate message size
      const maxSize = this.config.maxMessageSize || 1024 * 1024;
      if (Buffer.byteLength(messageString, 'utf8') > maxSize) {
        this.parsingStats.invalidMessages++;
        return { 
          success: false, 
          error: `Message exceeds maximum size limit: ${maxSize} bytes` 
        };
      }

      // Parse JSON
      const rawMessage = JSON.parse(messageString);

      // Validate message structure
      const structureResult = this.validator.validateMessageStructure(rawMessage);
      if (!structureResult.success) {
        this.parsingStats.invalidMessages++;
        return structureResult;
      }

      // Validate as crawler message
      const validationResult = this.validator.validateCrawlerMessage(rawMessage);
      if (!validationResult.success) {
        this.parsingStats.invalidMessages++;
        return validationResult;
      }

      this.parsingStats.validMessages++;
      return validationResult;

    } catch (error) {
      this.parsingStats.invalidMessages++;
      
      if (error instanceof SyntaxError) {
        return { 
          success: false, 
          error: `Invalid JSON: ${error.message}` 
        };
      }

      return { 
        success: false, 
        error: `Parse error: ${error instanceof Error ? error.message : 'Unknown error'}` 
      };
    }
  }

  /**
   * Check if buffer has remaining capacity
   */
  hasCapacity(): boolean {
    return !this.messageBuffer.isFull();
  }

  /**
   * Get current buffer usage
   */
  getBufferUsage(): number {
    return this.messageBuffer.getUsage();
  }

  /**
   * Clear the message buffer
   */
  clearBuffer(): void {
    this.messageBuffer.clear();
  }

  /**
   * Get buffer statistics
   */
  getBufferStats() {
    // Use the implementation-specific method if available
    if (this.messageBuffer instanceof MessageBufferImpl) {
      return this.messageBuffer.getStats();
    }
    
    // Fallback to basic stats from interface
    return {
      maxSize: this.messageBuffer.maxSize,
      currentSize: this.messageBuffer.currentSize,
      usage: this.messageBuffer.getUsage(),
      isFull: this.messageBuffer.isFull()
    };
  }

  /**
   * Get parsing statistics
   */
  getParsingStats() {
    return {
      ...this.parsingStats,
      successRate: this.parsingStats.totalMessages > 0 
        ? this.parsingStats.validMessages / this.parsingStats.totalMessages 
        : 0,
      validationStats: this.validator.getValidationStats()
    };
  }

  /**
   * Reset parsing statistics
   */
  resetStats(): void {
    this.parsingStats = {
      totalMessages: 0,
      validMessages: 0,
      invalidMessages: 0,
      bufferOverflows: 0,
      parseErrors: 0
    };
    this.validator.resetStats();
  }

  /**
   * Peek at buffer contents for debugging
   */
  peekBuffer(length?: number): string {
    if (this.messageBuffer instanceof MessageBufferImpl) {
      return this.messageBuffer.peek(length);
    }
    return `Buffer size: ${this.messageBuffer.currentSize}/${this.messageBuffer.maxSize}`;
  }

  /**
   * Check if buffer contains partial message
   */
  hasPartialMessage(): boolean {
    return this.messageBuffer.currentSize > 0;
  }

  /**
   * Estimate how many complete messages might be in buffer
   */
  estimateMessageCount(): number {
    if (this.messageBuffer instanceof MessageBufferImpl) {
      const delimiter = this.config.messageDelimiter || '\n';
      const bufferContent = this.messageBuffer.peek();
      return (bufferContent.match(new RegExp(delimiter, 'g')) || []).length;
    }
    return 0; // Cannot estimate without peek capability
  }

  /**
   * Force flush partial message (for emergency cleanup)
   */
  forceFlush(): MessageProcessingResult<CrawlerMessage[]> {
    if (this.messageBuffer instanceof MessageBufferImpl) {
      const bufferContent = this.messageBuffer.peek();
      if (!bufferContent.trim()) {
        return { success: true, data: [] };
      }

      // Try to parse as-is (might be incomplete)
      const result = this.parseMessage(bufferContent);
      this.clearBuffer();

      if (result.success && result.data) {
        return { success: true, data: [result.data] };
      } else {
        return {
          success: false,
          error: `Force flush failed: ${result.error}`
        };
      }
    }
    
    // Fallback: just clear buffer
    this.clearBuffer();
    return { success: true, data: [] };
  }
}

/**
 * StreamingMessageParser - For handling streaming data
 * 
 * Optimized for handling continuous streams of data with
 * automatic buffer management and backpressure handling.
 */
export class StreamingMessageParser extends MessageParser {
  private streamStats = {
    totalBytesProcessed: 0,
    totalChunks: 0,
    averageChunkSize: 0
  };

  /**
   * Process streaming data chunk
   */
  processChunk(chunk: Buffer): MessageProcessingResult<CrawlerMessage[]> {
    this.streamStats.totalChunks++;
    this.streamStats.totalBytesProcessed += chunk.length;
    this.streamStats.averageChunkSize = 
      this.streamStats.totalBytesProcessed / this.streamStats.totalChunks;

    // Check for backpressure
    if (this.getBufferUsage() > 0.8) { // 80% threshold
      return { 
        success: false, 
        error: 'Buffer approaching capacity, backpressure applied',
        shouldRetry: true,
        retryAfter: 100 // milliseconds
      };
    }

    return this.processData(chunk);
  }

  /**
   * Get streaming statistics
   */
  getStreamStats() {
    return {
      ...this.streamStats,
      bufferStats: this.getBufferStats(),
      parsingStats: this.getParsingStats()
    };
  }

  /**
   * Reset all statistics
   */
  resetAllStats(): void {
    this.resetStats();
    this.streamStats = {
      totalBytesProcessed: 0,
      totalChunks: 0,
      averageChunkSize: 0
    };
  }
}

/**
 * Factory functions
 */
export function createMessageParser(config: SocketServerConfig): MessageParser {
  return new MessageParser(config);
}

export function createStreamingMessageParser(config: SocketServerConfig): StreamingMessageParser {
  return new StreamingMessageParser(config);
}

/**
 * Utility functions for message parsing
 */
export const MessageParserUtils = {
  /**
   * Estimate buffer size needed for typical message load
   */
  estimateBufferSize(avgMessageSize: number, maxConcurrentMessages: number): number {
    // Add 50% overhead for safety
    return Math.ceil(avgMessageSize * maxConcurrentMessages * 1.5);
  },

  /**
   * Validate message delimiter
   */
  validateDelimiter(delimiter: string): boolean {
    return delimiter.length > 0 && delimiter.length <= 4;
  },

  /**
   * Calculate optimal buffer size based on connection speed
   */
  calculateOptimalBufferSize(
    connectionSpeedBps: number, 
    maxLatencyMs: number
  ): number {
    // Calculate how much data might arrive during max latency
    const maxDataDuringLatency = (connectionSpeedBps * maxLatencyMs) / 1000;
    // Add 100% overhead for burst handling
    return Math.max(1024, Math.ceil(maxDataDuringLatency * 2));
  }
};