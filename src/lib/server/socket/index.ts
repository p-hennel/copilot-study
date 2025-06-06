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

import { getLogger } from '@logtape/logtape';
import { SOCKET_CONFIG } from './config';
import { MessageRouter, createDefaultRouter } from './message-router';
import { SocketServer } from './socket-server';
import AppSettings from '../settings';
import path from 'path';

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

const logger = getLogger(["backend", "socket"])

let defaultSocketServer: SocketServer|undefined
export const getDefaultSocketServer = async () => {
  if (!defaultSocketServer) {
    defaultSocketServer = await createDefaultSocketServer()
    if (!defaultSocketServer.getStatus().isRunning)
      await defaultSocketServer.start()
  }
  return defaultSocketServer
}

const createDefaultSocketServer = async () => {
  logger.info('🚀 Starting basic socket server setup...');

  try {
    // 1. Create socket server with development defaults
    const socketServer = new SocketServer({
      socketPath: process.env.SOCKET_PATH || path.resolve(path.join(AppSettings().paths.config, "api.sock")),
      maxConnections: 3,
      logLevel: 'debug',
      heartbeatInterval: 2000, // 2 seconds for faster feedback
      enableMetrics: true,
    });

    // 2. Set up basic message routing
    const router = createDefaultRouter();
    
    // Log all incoming messages for debugging
    router.addMiddleware({
      name: 'debug-logger',
      priority: 5,
      async beforeProcess(message, connection) {
        logger.info(`📨 Received ${message.type} from ${connection.id}`);
        logger.info('Message data:', { data: message.data });
        return null; // Don't modify the message
      }
    });

    // 3. Start the server
    await socketServer.start();
    logger.info('✅ Socket server started successfully');
    logger.info(`🔌 Listening on: ${SOCKET_CONFIG.socketPath}`);
    logger.info(`📊 Max connections: ${SOCKET_CONFIG.maxConnections}`);

    // 4. Monitor server status
    setInterval(() => {
      const status = socketServer.getStatus();
      const stats = socketServer.getConnectionStats();
      
      logger.info(`📈 Server Status:`, {
        running: status.isRunning,
        uptime: Math.round(status.uptime / 1000) + 's',
        connections: `${stats.active}/${stats.total}`,
      });
    }, 5000); // Every 5 seconds

    // 5. Handle graceful shutdown
    const shutdown = async () => {
      logger.info('\n🛑 Shutting down socket server...');
      try {
        await socketServer.stop();
        logger.info('✅ Socket server stopped gracefully');
        process.exit(0);
      } catch (error) {
        logger.error('❌ Error during shutdown:', {error});
        process.exit(1);
      }
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    return socketServer;

  } catch (error) {
    logger.error('❌ Failed to start socket server:', {error});
    throw error;
  }
}

// Default export for convenience
const socketModule = {
  SocketServer,
  MessageRouter,
  createDefaultRouter,
  createSocketServer,
  config: SOCKET_CONFIG,
};

export default socketModule;