/**
 * Network utilities for socket system
 */

/**
 * Parse socket address from string
 */
export function parseSocketAddress(address: string): { host?: string; port?: number; path?: string } {
  if (!address) return {};
  
  // Unix socket path
  if (address.startsWith('/')) {
    return { path: address };
  }
  
  // TCP socket (host:port)
  const parts = address.split(':');
  if (parts.length === 2 && parts[1]) {
    const port = parseInt(parts[1], 10);
    if (!isNaN(port)) {
      return { host: parts[0], port };
    }
  }
  
  // Just host
  return { host: address };
}

/**
 * Normalize host string
 */
export function normalizeHost(host: string): string {
  if (!host) return 'localhost';
  
  // Remove protocol if present
  const withoutProtocol = host.replace(/^https?:\/\//, '');
  
  // Remove trailing slash
  return withoutProtocol.replace(/\/$/, '');
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