/**
 * Configuration utilities for socket system
 */

import type { SocketServerConfig } from '../types/config.js';

/**
 * Load socket configuration with defaults
 */
export function loadSocketConfig(overrides?: Partial<SocketServerConfig>): SocketServerConfig {
  const defaults: SocketServerConfig = {
    socketPath: process.env.SOCKET_PATH || '/tmp/gitlab-crawler.sock',
    host: process.env.SOCKET_HOST || 'localhost',
    port: parseInt(process.env.SOCKET_PORT || '8080', 10),
    maxConnections: parseInt(process.env.MAX_CONNECTIONS || '5', 10),
    connectionTimeout: parseInt(process.env.CONNECTION_TIMEOUT || '30000', 10),
    heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || '30000', 10),
    heartbeatTimeout: parseInt(process.env.HEARTBEAT_TIMEOUT || '90000', 10),
    messageTimeout: parseInt(process.env.MESSAGE_TIMEOUT || '10000', 10),
    bufferSize: parseInt(process.env.BUFFER_SIZE || '65536', 10),
    backlog: parseInt(process.env.SOCKET_BACKLOG || '511', 10),
    retryAttempts: parseInt(process.env.RETRY_ATTEMPTS || '3', 10),
    retryDelay: parseInt(process.env.RETRY_DELAY || '1000', 10)
  };

  return {
    ...defaults,
    ...overrides
  };
}

/**
 * Validate configuration value
 */
export function validateConfigValue(key: string, value: any, type: 'string' | 'number' | 'boolean'): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string' && value.length > 0;
    case 'number':
      return typeof value === 'number' && !isNaN(value) && value >= 0;
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return false;
  }
}

/**
 * Get configuration with defaults
 */
export function getConfigWithDefaults<T>(config: Partial<T>, defaults: T): T {
  return {
    ...defaults,
    ...config
  };
}