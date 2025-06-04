/**
 * Time and formatting utilities for socket system
 */

/**
 * Format current timestamp as ISO string
 */
export function formatTimestamp(date?: Date): string {
  return (date || new Date()).toISOString();
}

/**
 * Parse ISO timestamp string to Date
 */
export function parseTimestamp(timestamp: string): Date {
  return new Date(timestamp);
}

/**
 * Calculate duration between two timestamps in milliseconds
 */
export function calculateDuration(start: string | Date, end?: string | Date): number {
  const startTime = start instanceof Date ? start : new Date(start);
  const endTime = end instanceof Date ? end : (end ? new Date(end) : new Date());
  
  return endTime.getTime() - startTime.getTime();
}

/**
 * Calculate duration in human-readable format
 */
export function formatDuration(milliseconds: number): string {
  if (milliseconds < 0) return '0ms';
  
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else if (seconds > 0) {
    return `${seconds}s`;
  } else {
    return `${milliseconds}ms`;
  }
}

/**
 * Get timestamp relative to now
 */
export function getRelativeTimestamp(offset: number): string {
  return formatTimestamp(new Date(Date.now() + offset));
}

/**
 * Check if timestamp is expired
 */
export function isExpired(timestamp: string | Date, now?: Date): boolean {
  const targetTime = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const currentTime = now || new Date();
  return targetTime.getTime() < currentTime.getTime();
}

/**
 * Add time to a timestamp
 */
export function addTime(timestamp: string | Date, milliseconds: number): Date {
  const baseTime = timestamp instanceof Date ? timestamp : new Date(timestamp);
  return new Date(baseTime.getTime() + milliseconds);
}

/**
 * Subtract time from a timestamp
 */
export function subtractTime(timestamp: string | Date, milliseconds: number): Date {
  const baseTime = timestamp instanceof Date ? timestamp : new Date(timestamp);
  return new Date(baseTime.getTime() - milliseconds);
}

/**
 * Get start of day for a timestamp
 */
export function getStartOfDay(timestamp: string | Date): Date {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  return startOfDay;
}

/**
 * Get end of day for a timestamp
 */
export function getEndOfDay(timestamp: string | Date): Date {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  return endOfDay;
}

/**
 * Check if two timestamps are on the same day
 */
export function isSameDay(timestamp1: string | Date, timestamp2: string | Date): boolean {
  const date1 = timestamp1 instanceof Date ? timestamp1 : new Date(timestamp1);
  const date2 = timestamp2 instanceof Date ? timestamp2 : new Date(timestamp2);
  
  return date1.getFullYear() === date2.getFullYear() &&
         date1.getMonth() === date2.getMonth() &&
         date1.getDate() === date2.getDate();
}

/**
 * Validate timestamp format
 */
export function isValidTimestamp(timestamp: string): boolean {
  if (!timestamp || typeof timestamp !== 'string') return false;
  
  const date = new Date(timestamp);
  return !isNaN(date.getTime()) && date.toISOString() === timestamp;
}