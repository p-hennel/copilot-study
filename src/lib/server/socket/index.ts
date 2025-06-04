/**
 * Socket Communication System
 * 
 * This module provides comprehensive socket communication capabilities for
 * integrating with the crawler system. It includes connection management,
 * message routing, progress tracking, and database integration.
 * 
 * Main Components:
 * - SocketServer: Core server class for managing crawler connections
 * - MessageRouter: Message routing and handling infrastructure
 * - Configuration: Environment-specific configuration management
 * - Types: Comprehensive TypeScript type definitions
 * 
 * Usage:
 * ```typescript
 * import { SocketServer, createDefaultRouter } from '$lib/server/socket';
 * 
 * const server = new SocketServer({
 *   socketPath: '/tmp/crawler.sock',
 *   maxConnections: 5
 * });
 * 
 * await server.start();
 * ```
 */

import { SOCKET_CONFIG } from './config';
import { MessageRouter, createDefaultRouter } from './message-router';
import { SocketServer } from './socket-server';

// Core components
export { SocketServer } from './socket-server';
export { 
  MessageRouter, 
  createDefaultRouter,
  type MessageHandler,
  type MessageMiddleware,
  HeartbeatHandler,
  JobProgressHandler,
  JobCompletedHandler,
  ValidationMiddleware,
  LoggingMiddleware,
} from './message-router';
export { SOCKET_CONFIG, configManager, isDevelopment, isTest, isProduction, validateCurrentConfig } from './config';

// Type exports for external use
export type {
  // Configuration types
  SocketServerConfig,
  
  // Message types
  CrawlerMessage,
  WebAppMessage,
  BaseMessage,
  ProgressData,
  MessageProcessingResult,
  
  // Connection types
  SocketConnection,
  ConnectionPool,
  ConnectionState,
  ConnectionEvent,
  
  // Progress types
  ProgressTracker,
  JobProgress,
  ProgressState,
  
  // Database types
  Job,
  Area,
  SocketDatabaseOperations,
  
  // Error types
  SocketError,
  ErrorCategory,
  ErrorSeverity,
  ErrorHandlingResult,
} from './types';

// Factory function for easy setup
export const createSocketServer = (config?: Partial<import('./types').SocketServerConfig>) => {
  return new SocketServer(config);
};

// Default export for convenience
const socketModule = {
  SocketServer,
  MessageRouter,
  createDefaultRouter,
  createSocketServer,
  config: SOCKET_CONFIG,
};

export default socketModule;