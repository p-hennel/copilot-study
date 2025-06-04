/**
 * Error utilities for socket system
 */

import { ulid } from 'ulid';
import { ErrorSeverity, type SocketError } from '../types/errors.js';

/**
 * Create a socket error
 */
export function createSocketError(
  message: string,
  code?: string,
  category?: string
): SocketError {
  return {
    message,
    code,
    category: category as any,
    severity: ErrorSeverity.CRITICAL,
    timestamp: new Date(),
    id: ulid(),
    limit: Number.MAX_SAFE_INTEGER,
    currentUsage: -1
  };
}

/**
 * Format error for logging
 */
export function formatErrorForLogging(error: Error | SocketError | any): string {
  if (!error) return 'Unknown error';
  
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  
  if (typeof error === 'object' && error.message) {
    const details = error.code ? ` (${error.code})` : '';
    return `${error.message}${details}`;
  }
  
  return String(error);
}

/**
 * Check if error is retryable
 */
export function isRetryableError(error: Error | SocketError | any): boolean {
  if (!error) return false;
  
  // Check explicit retryable flag
  if (typeof error === 'object' && 'retryable' in error) {
    return !!error.retryable;
  }
  
  // Check for common retryable error types
  const retryablePatterns = [
    /timeout/i,
    /connection/i,
    /network/i,
    /temporary/i,
    /rate.?limit/i,
    /service.?unavailable/i
  ];
  
  const errorMessage = error.message || String(error);
  return retryablePatterns.some(pattern => pattern.test(errorMessage));
}