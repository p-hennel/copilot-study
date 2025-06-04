/**
 * Message utilities for socket system
 */

import type { MessageProcessingResult } from '../types/messages.js';

/**
 * Sanitize message content for logging
 */
export function sanitizeMessage(message: any): any {
  if (!message || typeof message !== 'object') {
    return message;
  }

  const sanitized = { ...message };
  
  // Remove or sanitize sensitive fields
  if (sanitized.access_token) {
    sanitized.access_token = sanitized.access_token.slice(0, 8) + '***';
  }
  
  if (sanitized.data?.access_token) {
    sanitized.data.access_token = sanitized.data.access_token.slice(0, 8) + '***';
  }
  
  return sanitized;
}

/**
 * Validate message size
 */
export function validateMessageSize(message: string | Buffer, maxSize = 1024 * 1024): MessageProcessingResult<void> {
  const size = typeof message === 'string' ? Buffer.byteLength(message) : message.length;
  
  if (size > maxSize) {
    return {
      success: false,
      error: `Message size ${size} exceeds maximum ${maxSize} bytes`
    };
  }
  
  return { success: true };
}

/**
 * Create error response message
 */
export function createErrorResponse(error: string, code?: string): MessageProcessingResult<any> {
  return {
    success: false,
    error,
    data: code ? { error_code: code } : undefined
  };
}

/**
 * Create success response message
 */
export function createSuccessResponse<T>(data?: T): MessageProcessingResult<T> {
  return {
    success: true,
    data
  };
}

/**
 * Truncate string to specified length
 */
export function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Format message for logging
 */
export function formatMessageForLog(message: any, maxLength = 500): string {
  try {
    const sanitized = sanitizeMessage(message);
    const jsonString = JSON.stringify(sanitized);
    return truncateString(jsonString, maxLength);
  } catch {
    return '[Invalid message format]';
  }
}