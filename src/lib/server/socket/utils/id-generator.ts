import { randomUUID, randomBytes } from 'crypto';

/**
 * ID generation utilities for socket system
 */

/**
 * Generate a unique job ID
 */
export function createJobId(prefix = 'job'): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(4).toString('hex');
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * Generate a unique message ID
 */
export function createMessageId(prefix = 'msg'): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(3).toString('hex');
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * Generate a unique connection ID
 */
export function createConnectionId(prefix = 'conn'): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(4).toString('hex');
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * Generate a UUID
 */
export function createUUID(): string {
  return randomUUID();
}

/**
 * Generate a short random ID
 */
export function createShortId(length = 8): string {
  return randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

/**
 * Parse an ID to extract components
 */
export function parseId(id: string): { prefix?: string; timestamp?: number; random?: string } {
  const parts = id.split('_');
  if (parts.length >= 3) {
    const timestampStr = parts[1];
    const randomStr = parts[2];
    if (timestampStr && randomStr) {
      return {
        prefix: parts[0],
        timestamp: parseInt(timestampStr, 36),
        random: randomStr
      };
    }
  }
  return {};
}

/**
 * Validate ID format
 */
export function isValidId(id: string, expectedPrefix?: string): boolean {
  if (!id || typeof id !== 'string') return false;
  
  const parts = id.split('_');
  if (parts.length < 3) return false;
  
  if (expectedPrefix && parts[0] !== expectedPrefix) return false;
  
  // Check if timestamp part is valid base36
  const timestampStr = parts[1];
  const randomStr = parts[2];
  
  if (!timestampStr || !randomStr) return false;
  
  const timestamp = parseInt(timestampStr, 36);
  if (isNaN(timestamp)) return false;
  
  // Check if random part is valid hex
  const hexRegex = /^[0-9a-f]+$/i;
  return hexRegex.test(randomStr);
}