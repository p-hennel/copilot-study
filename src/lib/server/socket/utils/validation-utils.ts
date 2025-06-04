/**
 * Validation utilities for socket system
 */

/**
 * Validate job ID format
 */
export function isValidJobId(jobId: string): boolean {
  if (!jobId || typeof jobId !== 'string') return false;
  
  // Job IDs should be non-empty strings with reasonable length
  if (jobId.length < 3 || jobId.length > 100) return false;
  
  // Allow alphanumeric, hyphens, underscores
  const validPattern = /^[a-zA-Z0-9_-]+$/;
  return validPattern.test(jobId);
}

/**
 * Validate account ID format
 */
export function isValidAccountId(accountId: string): boolean {
  if (!accountId || typeof accountId !== 'string') return false;
  
  // Account IDs should be non-empty strings with reasonable length
  if (accountId.length < 1 || accountId.length > 50) return false;
  
  // Allow alphanumeric, hyphens, underscores
  const validPattern = /^[a-zA-Z0-9_-]+$/;
  return validPattern.test(accountId);
}

/**
 * Validate OAuth2 token format
 */
export function isValidToken(token: string): boolean {
  if (!token || typeof token !== 'string') return false;
  
  // Tokens should be non-empty and have reasonable length
  if (token.length < 10 || token.length > 2048) return false;
  
  // Tokens are typically base64 or alphanumeric
  const validPattern = /^[a-zA-Z0-9+/=_\-.]+$/;
  return validPattern.test(token);
}

/**
 * Validate connection ID format
 */
export function isValidConnectionId(connectionId: string): boolean {
  if (!connectionId || typeof connectionId !== 'string') return false;
  
  // Connection IDs should follow our generated format
  if (connectionId.length < 5 || connectionId.length > 100) return false;
  
  // Allow alphanumeric, hyphens, underscores
  const validPattern = /^[a-zA-Z0-9_-]+$/;
  return validPattern.test(connectionId);
}

/**
 * Validate namespace path format
 */
export function isValidNamespacePath(path: string): boolean {
  if (!path || typeof path !== 'string') return false;
  
  // Namespace paths should be reasonable length
  if (path.length < 1 || path.length > 200) return false;
  
  // Allow alphanumeric, hyphens, underscores, dots, slashes
  const validPattern = /^[a-zA-Z0-9_\-./]+$/;
  return validPattern.test(path);
}

/**
 * Validate GitLab host URL
 */
export function isValidGitlabHost(host: string): boolean {
  if (!host || typeof host !== 'string') return false;
  
  try {
    const url = new URL(host);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Validate message type
 */
export function isValidMessageType(type: string): boolean {
  if (!type || typeof type !== 'string') return false;
  
  const validTypes = [
    'heartbeat',
    'job_started',
    'job_progress',
    'job_completed',
    'job_failed',
    'jobs_discovered',
    'token_refresh_request',
    'job_assignment',
    'token_refresh_response',
    'shutdown'
  ];
  
  return validTypes.includes(type);
}

/**
 * Validate priority value
 */
export function isValidPriority(priority: number): boolean {
  return typeof priority === 'number' && 
         Number.isInteger(priority) && 
         priority >= 0 && 
         priority <= 10;
}

/**
 * Validate completion percentage
 */
export function isValidCompletion(completion: number): boolean {
  return typeof completion === 'number' && 
         completion >= 0 && 
         completion <= 1 &&
         !Number.isNaN(completion);
}

/**
 * Validate socket path
 */
export function isValidSocketPath(path: string): boolean {
  if (!path || typeof path !== 'string') return false;
  
  // Socket paths should be absolute and reasonable length
  if (path.length < 5 || path.length > 255) return false;
  
  // Should start with / for Unix sockets
  return path.startsWith('/');
}

/**
 * Validate port number
 */
export function isValidPort(port: number): boolean {
  return typeof port === 'number' && 
         Number.isInteger(port) && 
         port > 0 && 
         port <= 65535;
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Sanitize string input
 */
export function sanitizeString(input: string, maxLength = 1000): string {
  if (!input || typeof input !== 'string') return '';
  
  // Remove control characters and limit length
  return input
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .trim()
    .slice(0, maxLength);
}

/**
 * Validate object has required properties
 */
export function hasRequiredProperties<T extends Record<string, any>>(
  obj: any, 
  requiredProps: (keyof T)[]
): obj is T {
  if (!obj || typeof obj !== 'object') return false;
  
  return requiredProps.every(prop => 
    Object.prototype.hasOwnProperty.call(obj, prop) && obj[prop] !== null && obj[prop] !== undefined
  );
}