/**
 * Connection Management Module
 * 
 * This module contains the implementation of socket connection management,
 * including connection pooling, lifecycle management, and health monitoring.
 */

export { SocketManager } from './socket-manager.js';
export { ConnectionPoolImpl } from './connection-pool.js';
export { SocketConnectionImpl } from './socket-connection.js';
export { HealthMonitorImpl } from './health-monitor.js';
export { MessageBufferImpl, createMessageBuffer } from './message-buffer.js';

// Re-export types for convenience
export type {
  SocketConnection,
  ConnectionPool,
  ConnectionState,
  ConnectionEvent,
  ConnectionEventHandler,
  ConnectionMetadata,
  ConnectionStats,
  ConnectionConfig,
  PoolStats,
  PoolEvent,
  PoolEventHandler,
  ConnectionHealth,
  HealthResult,
  HealthStatus,
  HealthIssue,
  MessageBuffer
} from '../types/index.js';