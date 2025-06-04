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
      console.log(`Socket server started on ${this.config.socketPath || `${this.config.host}:${this.config.port}`}`);
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
      console.log('Socket server stopped');
    } catch (error) {
      console.error('Error stopping socket server:', error);
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
    // Initialize error manager
    // this.errorManager = new ErrorManager(this.config);

    // Initialize progress aggregator
    // this.progressAggregator = new ProgressAggregator();

    // Initialize connection pool
    // this.connectionPool = new ConnectionPool(this.config);

    // TODO: Implement actual initialization
    console.log('Components initialized (placeholder)');
  }

  private async createSocketServer(): Promise<void> {
    this.server = createServer();

    this.server.on('connection', (socket: Socket) => {
      this.handleNewConnection(socket);
    });

    this.server.on('error', (error: Error) => {
      console.error('Socket server error:', error);
      this.errorManager?.handleError(error);
    });

    this.server.on('close', () => {
      console.log('Socket server closed');
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
      if (!this.connectionPool) {
        socket.destroy();
        return;
      }

      const connection = this.connectionPool.addConnection(socket);
      
      // Set up message handling
      connection.on('message', (event) => {
        if ("message" in event)
          this.handleCrawlerMessage(event.connection, event.message);
      });

      console.log(`New connection established: ${connection.id}`);
    } catch (error) {
      console.error('Error handling new connection:', error);
      socket.destroy();
    }
  }

  private async handleCrawlerMessage(connection: SocketConnection, message: CrawlerMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'heartbeat':
          await this.handleHeartbeat(connection, message);
          break;
        case 'job_started':
          await this.handleJobStarted(connection, message);
          break;
        case 'job_progress':
          await this.handleJobProgress(connection, message);
          break;
        case 'job_completed':
          await this.handleJobCompleted(connection, message);
          break;
        case 'job_failed':
          await this.handleJobFailed(connection, message);
          break;
        case 'token_refresh_request':
          await this.handleTokenRefreshRequest(connection, message);
          break;
        default:
          console.warn(`Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error(`Error handling message ${message.type}:`, error);
      this.errorManager?.handleError(error as Error);
    }
  }

  private async handleHeartbeat(connection: SocketConnection, message: CrawlerMessage): Promise<void> {
    // TODO: Update connection heartbeat timestamp
    // TODO: Update system status metrics
    console.log(`Heartbeat from ${connection.id}:`, message.data);
  }

  private async handleJobStarted(connection: SocketConnection, message: CrawlerMessage): Promise<void> {
    // TODO: Update job status in database
    // TODO: Notify web clients via WebSocket
    console.log(`Job started: ${message.job_id}`);
  }

  private async handleJobProgress(connection: SocketConnection, message: CrawlerMessage): Promise<void> {
    // TODO: Update progress tracking
    // TODO: Persist progress to database
    // TODO: Broadcast progress to web clients
    console.log(`Job progress: ${message.job_id}`, message.data);
  }

  private async handleJobCompleted(connection: SocketConnection, message: CrawlerMessage): Promise<void> {
    // TODO: Update job status to completed
    // TODO: Process final results
    // TODO: Notify web clients
    console.log(`Job completed: ${message.job_id}`);
  }

  private async handleJobFailed(connection: SocketConnection, message: CrawlerMessage): Promise<void> {
    // TODO: Update job status to failed
    // TODO: Log error details
    // TODO: Determine if retry is needed
    console.log(`Job failed: ${message.job_id}`, message.data);
  }

  private async handleTokenRefreshRequest(connection: SocketConnection, message: CrawlerMessage): Promise<void> {
    // TODO: Handle token refresh logic
    // TODO: Send token refresh response
    console.log(`Token refresh requested: ${message.job_id}`);
  }

  private async cleanup(): Promise<void> {
    // TODO: Cleanup resources
    this.server = null;
    this.connectionPool = null;
    this.errorManager = null;
    this.progressAggregator = null;
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