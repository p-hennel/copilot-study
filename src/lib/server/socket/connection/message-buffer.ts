import type { MessageBuffer } from '../types/index.js';

/**
 * MessageBuffer - Manages incoming message buffering and parsing
 * 
 * Handles partial message buffering, message extraction with delimiters,
 * and buffer overflow protection for socket communication.
 */
export class MessageBufferImpl implements MessageBuffer {
  private buffer: Buffer;
  private _currentSize: number = 0;

  constructor(readonly maxSize: number) {
    this.buffer = Buffer.alloc(maxSize);
  }

  /**
   * Get current buffer size
   */
  get currentSize(): number {
    return this._currentSize;
  }

  /**
   * Append data to the buffer
   */
  append(data: Buffer | string): void {
    const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    
    // Check if adding this data would exceed buffer size
    if (this._currentSize + dataBuffer.length > this.maxSize) {
      // If the new data alone is larger than max size, it's a protocol violation
      if (dataBuffer.length > this.maxSize) {
        throw new Error(`Message too large: ${dataBuffer.length} bytes exceeds maximum ${this.maxSize} bytes`);
      }
      
      // If adding would overflow, we need to make room
      // For now, we'll throw an error - in production you might want to implement
      // a sliding window or other strategy
      throw new Error(`Buffer overflow: ${this._currentSize + dataBuffer.length} bytes exceeds maximum ${this.maxSize} bytes`);
    }
    
    // Copy data to buffer
    dataBuffer.copy(this.buffer, this._currentSize);
    this._currentSize += dataBuffer.length;
  }

  /**
   * Extract complete messages using delimiter
   */
  extractMessages(delimiter: string): string[] {
    if (this._currentSize === 0) {
      return [];
    }
    
    const delimiterBuffer = Buffer.from(delimiter);
    const messages: string[] = [];
    let searchStart = 0;
    
    while (searchStart < this._currentSize) {
      // Find the next delimiter
      const delimiterIndex = this.buffer.indexOf(delimiterBuffer, searchStart);
      
      if (delimiterIndex === -1) {
        // No more delimiters found
        break;
      }
      
      // Extract message (excluding delimiter)
      const messageLength = delimiterIndex - searchStart;
      if (messageLength > 0) {
        const messageBuffer = this.buffer.subarray(searchStart, delimiterIndex);
        const messageString = messageBuffer.toString('utf8').trim();
        
        if (messageString.length > 0) {
          messages.push(messageString);
        }
      }
      
      // Move search start past the delimiter
      searchStart = delimiterIndex + delimiterBuffer.length;
    }
    
    // If we found messages, remove processed data from buffer
    if (messages.length > 0) {
      this.removeProcessedData(searchStart);
    }
    
    return messages;
  }

  /**
   * Clear the entire buffer
   */
  clear(): void {
    this._currentSize = 0;
    this.buffer.fill(0);
  }

  /**
   * Check if buffer is full
   */
  isFull(): boolean {
    return this._currentSize >= this.maxSize;
  }

  /**
   * Get buffer usage as a ratio (0-1)
   */
  getUsage(): number {
    return this._currentSize / this.maxSize;
  }

  /**
   * Get remaining capacity in bytes
   */
  getRemainingCapacity(): number {
    return this.maxSize - this._currentSize;
  }

  /**
   * Get buffer statistics for monitoring
   */
  getStats() {
    return {
      maxSize: this.maxSize,
      currentSize: this._currentSize,
      usage: this.getUsage(),
      remainingCapacity: this.getRemainingCapacity(),
      isFull: this.isFull()
    };
  }

  /**
   * Peek at buffer contents without extracting (for debugging)
   */
  peek(length?: number): string {
    const peekLength = Math.min(length || this._currentSize, this._currentSize);
    return this.buffer.subarray(0, peekLength).toString('utf8');
  }

  private removeProcessedData(processedLength: number): void {
    if (processedLength >= this._currentSize) {
      // All data was processed
      this.clear();
      return;
    }
    
    // Move remaining data to the beginning of the buffer
    const remainingLength = this._currentSize - processedLength;
    this.buffer.copy(this.buffer, 0, processedLength, this._currentSize);
    
    // Update size and clear the rest
    this._currentSize = remainingLength;
    this.buffer.fill(0, remainingLength);
  }
}

/**
 * Factory function to create message buffers with different configurations
 */
export function createMessageBuffer(maxSize: number): MessageBuffer {
  return new MessageBufferImpl(maxSize);
}

/**
 * Utility function to validate message size before processing
 */
export function validateMessageSize(data: Buffer | string, maxSize: number): boolean {
  const size = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data);
  return size <= maxSize;
}

/**
 * Utility function to estimate JSON message size
 */
export function estimateJsonSize(obj: any): number {
  return Buffer.byteLength(JSON.stringify(obj));
}