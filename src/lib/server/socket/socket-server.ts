import { createServer, type Server, type Socket } from 'net';
import type { 
  SocketServerConfig, 
  ConnectionPool, 
  SocketConnection,
  CrawlerMessage,
  WebAppMessage,
  ErrorManager,
  ProgressAggregator
} from './types/index.js';
import { SOCKET_CONFIG } from './config.js';
import { ConnectionPoolImpl } from './connection/connection-pool.js';
import { MessageRouter, createDefaultRouter } from './message-router.js';
import { adminUIBridge } from './services/admin-ui-bridge.js';
import { getLogger } from '$lib/logging';

const logger = getLogger(['socket-server']);

/**
 * Core Socket Server Class
 * 
 * This class manages the Unix domain socket server that communicates with
 * the crawler system. It handles connection management, message routing,
 * and integration with the web application's job management system.
 */
export class SocketServer {
  private server: Server | null = null;
  private connectionPool: ConnectionPool | null = null;
  private errorManager: ErrorManager | null = null;
  private progressAggregator: ProgressAggregator | null = null;
  private messageRouter: MessageRouter | null = null;
  private isRunning = false;
  private readonly config: SocketServerConfig;

  constructor(config?: Partial<SocketServerConfig>) {
    this.config = { ...SOCKET_CONFIG, ...config };
  }

  /**
   * Start the socket server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Socket server is already running');
    }

    try {
      await this.initializeComponents();
      await this.createSocketServer();
      await this.startServer();
      
      this.isRunning = true;
      logger.info(`Socket server started on ${this.config.socketPath || `${this.config.host}:${this.config.port}`}`);
    } catch (error) {
      await this.cleanup();
      throw error;
    }
  }

  /**
   * Stop the socket server
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      this.isRunning = false;
      
      // Close all connections gracefully
      if (this.connectionPool) {
        await this.connectionPool.closeAll('Server shutdown');
      }

      // Close the server
      if (this.server) {
        await new Promise<void>((resolve, reject) => {
          this.server!.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      }

      await this.cleanup();
      logger.info('Socket server stopped');
    } catch (error) {
      logger.error('Error stopping socket server:', {error});
      throw error;
    }
  }

  /**
   * Get server status
   */
  getStatus(): ServerStatus {
    return {
      isRunning: this.isRunning,
      connections: this.connectionPool?.getConnectionCount() || 0,
      activeConnections: this.connectionPool?.getActiveConnectionCount() || 0,
      uptime: this.isRunning ? Date.now() - this.startTime : 0,
      config: this.config,
    };
  }

  /**
   * Send message to a specific crawler
   */
  async sendToCrawler(crawlerId: string, message: WebAppMessage): Promise<void> {
    if (!this.connectionPool) {
      throw new Error('Server not initialized');
    }

    const connections = this.connectionPool.getAllConnections()
      .filter(conn => conn.metadata.crawlerId === crawlerId);

    if (connections.length === 0) {
      throw new Error(`No connection found for crawler: ${crawlerId}`);
    }

    // Send to first active connection
    const activeConnection = connections.find(conn => conn.isActive());
    if (!activeConnection) {
      throw new Error(`No active connection found for crawler: ${crawlerId}`);
    }

    await activeConnection.send(message);
  }

  /**
   * Broadcast message to all active crawlers
   */
  async broadcast(message: WebAppMessage): Promise<void> {
    if (!this.connectionPool) {
      throw new Error('Server not initialized');
    }

    await this.connectionPool.broadcastToActive(message);
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): ConnectionStats {
    if (!this.connectionPool) {
      return {
        total: 0,
        active: 0,
        idle: 0,
        error: 0,
      };
    }

    return {
      total: this.connectionPool.getConnectionCount(),
      active: this.connectionPool.getActiveConnectionCount(),
      idle: this.connectionPool.getAllConnections().filter(c => c.getState() === 'idle').length,
      error: this.connectionPool.getAllConnections().filter(c => c.getState() === 'error').length,
    };
  }

  /**
   * Get progress aggregation across all jobs
   */
  getAggregateProgress(): AggregateProgress | null {
    return this.progressAggregator?.getAggregateProgress() || null;
  }

  private startTime = 0;

  private async initializeComponents(): Promise<void> {
    // Initialize connection pool
    this.connectionPool = new ConnectionPoolImpl(this.config);
        logger.info('✅ Connection pool initialized');
    
    // Initialize message router
    this.messageRouter = createDefaultRouter();
    logger.info('✅ Message router initialized');

    // Initialize admin UI bridge and start status updates
    adminUIBridge.startStatusUpdates(10000); // Update every 10 seconds
    logger.info('✅ Admin UI bridge initialized with status updates');

    // TODO: Initialize error manager and progress aggregator when implemented
    // this.errorManager = new ErrorManager(this.config);
    // this.progressAggregator = new ProgressAggregator();

    logger.info('✅ All components initialized successfully');
  }

  private async createSocketServer(): Promise<void> {
    this.server = createServer();

    this.server.on('connection', (socket: Socket) => {
      this.handleNewConnection(socket);
    });

    this.server.on('error', (error: Error) => {
      logger.error('Socket server error:', {error});
      this.errorManager?.handleError(error);
    });

    this.server.on('close', () => {
      logger.info('Socket server closed');
    });
  }

  private async startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        reject(new Error('Server not created'));
        return;
      }

      this.server.listen(this.config.socketPath || this.config.port, () => {
        this.startTime = Date.now();
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  private handleNewConnection(socket: Socket): void {
    try {
      logger.debug(`🔌 SOCKET-SERVER: New socket connection from ${socket.remoteAddress}`);
      
      if (!this.connectionPool) {
        logger.error('❌ SOCKET-SERVER: Connection pool not initialized, destroying socket');
        socket.destroy();
        return;
      }

      const connection = this.connectionPool.addConnection(socket);
      logger.debug(`✅ SOCKET-SERVER: Connection added to pool: ${connection.id}`);
      logger.debug(`📊 SOCKET-SERVER: Connection state: ${connection.getState()}, Active: ${connection.isActive()}`);
      
      // Set up message handling
      connection.on('message', (event) => {
        logger.debug(`📨 SOCKET-SERVER: Message event received from ${connection.id}`);
        if ("message" in event) {
          logger.debug(`📋 SOCKET-SERVER: Message type: ${event.message?.type || 'unknown'}`);
          this.handleCrawlerMessage(event.connection, event.message);
        } else {
          logger.warn(`⚠️ SOCKET-SERVER: Message event missing message property`);
        }
      });

      // Set up connection lifecycle events for admin UI
      connection.on('connected', (event) => {
        if (event.type === 'connected') {
          logger.debug(`🟢 SOCKET-SERVER: Connection ${event.connection.id} marked as connected`);
          adminUIBridge.onCrawlerConnected(event.connection);
        }
      });

      connection.on('disconnected', (event) => {
        if (event.type === 'disconnected') {
          logger.debug(`🔴 SOCKET-SERVER: Connection ${event.connection.id} disconnected: ${event.reason}`);
          adminUIBridge.onCrawlerDisconnected(event.connection.id, event.reason);
        }
      });

      logger.debug(`🔗 SOCKET-SERVER: New connection established: ${connection.id}`);
    } catch (error) {
      logger.error('💥 SOCKET-SERVER: Error handling new connection:', {error});
      socket.destroy();
    }
  }

  private async handleCrawlerMessage(connection: SocketConnection, message: CrawlerMessage): Promise<void> {
    try {
      logger.debug(`📥 SOCKET-SERVER: Received ${message.type} message from ${connection.id}`);
      logger.debug(`📄 SOCKET-SERVER: Message data:`, {message});
      
      if (!this.messageRouter) {
        logger.error('❌ SOCKET-SERVER: Message router not initialized');
        return;
      }
      
      logger.debug(`🎯 SOCKET-SERVER: Routing ${message.type} to message router...`);
      const result = await this.messageRouter.processMessage(message, connection);
      
      if (!result.success) {
        logger.error(`❌ SOCKET-SERVER: Failed to process ${message.type} message:`, {error: result.error});
      } else {
        logger.debug(`✅ SOCKET-SERVER: Successfully processed ${message.type} message`);
        if (result.data) {
          logger.debug(`📊 SOCKET-SERVER: Result data:`, {data: result.data});
        }
      }
    } catch (error) {
      logger.error('💥 SOCKET-SERVER: Error handling message ${message.type}:', {error});
      this.errorManager?.handleError(error as Error);
    }
  }

  // Individual message handlers removed - now using MessageRouter

  private async cleanup(): Promise<void> {
    try {
      // Close connection pool
      if (this.connectionPool) {
        await this.connectionPool.closeAll('Server shutdown');
      }
      
      logger.info('✅ Cleanup completed successfully');
    } catch (error) {
      logger.error('❌ Error during cleanup:', {error});
    } finally {
      // Clear references
      this.server = null;
      this.connectionPool = null;
      this.errorManager = null;
      this.progressAggregator = null;
      this.messageRouter = null;
    }
  }
}

// Type definitions for this module
interface ServerStatus {
  isRunning: boolean;
  connections: number;
  activeConnections: number;
  uptime: number;
  config: SocketServerConfig;
}

interface ConnectionStats {
  total: number;
  active: number;
  idle: number;
  error: number;
}

interface AggregateProgress {
  total_jobs: number;
  active_jobs: number;
  completed_jobs: number;
  failed_jobs: number;
  overall_completion: number;
}