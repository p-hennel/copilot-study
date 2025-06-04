import { createServer, type Server, type Socket } from 'net';
import { EventEmitter } from 'events';
import { unlink } from 'fs/promises';
import type {
  SocketServerConfig,
  ConnectionPool
} from '../types/index';
import { ConnectionPoolImpl } from './connection-pool';
import { HealthMonitorImpl } from './health-monitor';

/**
 * SocketManager - Robust Unix socket server management
 * 
 * Handles Unix socket server creation, client connection management,
 * and connection pooling with comprehensive error handling and lifecycle management.
 */
export class SocketManager extends EventEmitter {
  private server: Server | null = null;
  private connectionPool: ConnectionPool;
  private healthMonitor: HealthMonitorImpl;
  private isRunning = false;
  private isShuttingDown = false;
  private startTime: Date | null = null;
  private connectionCounter = 0;
  
  constructor(private readonly config: SocketServerConfig) {
    super();
    this.connectionPool = new ConnectionPoolImpl(config);
    this.healthMonitor = new HealthMonitorImpl(config);
    
    // Set up connection pool event forwarding
    this.connectionPool.on('connection_added', (event) => {
      this.emit('connection_added', event);
    });
    
    this.connectionPool.on('connection_removed', (event) => {
      this.emit('connection_removed', event);
    });
    
    this.connectionPool.on('pool_error', (event) => {
      this.emit('pool_error', event);
    });
  }

  /**
   * Start the socket server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('SocketManager is already running');
    }

    if (this.isShuttingDown) {
      throw new Error('SocketManager is shutting down, cannot start');
    }

    try {
      await this.cleanupExistingSocket();
      await this.createServer();
      await this.startServer();
      
      this.isRunning = true;
      this.startTime = new Date();
      
      // Start health monitoring
      this.healthMonitor.start();
      
      this.emit('server_started', {
        socketPath: this.config.socketPath,
        timestamp: this.startTime
      });
      
      console.log(`SocketManager started on ${this.getServerAddress()}`);
    } catch (error) {
      await this.cleanup();
      throw new Error(`Failed to start SocketManager: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Stop the socket server gracefully
   */
  async stop(reason = 'Manual shutdown'): Promise<void> {
    if (!this.isRunning || this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    
    try {
      this.emit('server_stopping', { reason, timestamp: new Date() });
      
      // Stop accepting new connections
      if (this.server) {
        this.server.close();
      }
      
      // Stop health monitoring
      this.healthMonitor.stop();
      
      // Close all existing connections gracefully
      await this.connectionPool.closeAll(reason);
      
      // Wait for server to fully close
      if (this.server) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Server close timeout'));
          }, this.config.connectionTimeout || 30000);
          
          this.server!.close((error) => {
            clearTimeout(timeout);
            if (error) reject(error);
            else resolve();
          });
        });
      }
      
      await this.cleanup();
      
      this.isRunning = false;
      this.isShuttingDown = false;
      
      this.emit('server_stopped', { reason, timestamp: new Date() });
      console.log(`SocketManager stopped: ${reason}`);
    } catch (error) {
      this.isShuttingDown = false;
      throw new Error(`Failed to stop SocketManager: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get connection pool for external access
   */
  getConnectionPool(): ConnectionPool {
    return this.connectionPool;
  }

  /**
   * Get server status information
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      isShuttingDown: this.isShuttingDown,
      startTime: this.startTime,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      address: this.getServerAddress(),
      connectionCount: this.connectionPool.getConnectionCount(),
      activeConnectionCount: this.connectionPool.getActiveConnectionCount(),
      poolStats: this.connectionPool.getPoolStats()
    };
  }

  /**
   * Check if the server is healthy
   */
  isHealthy(): boolean {
    return this.isRunning && !this.isShuttingDown && this.server !== null;
  }

  /**
   * Get server metrics for monitoring
   */
  getMetrics() {
    const poolStats = this.connectionPool.getPoolStats();
    return {
      ...poolStats,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      serverStatus: this.isRunning ? 'running' : 'stopped',
      totalConnectionsCreated: this.connectionCounter,
      healthStatus: this.isHealthy() ? 'healthy' : 'unhealthy'
    };
  }

  private async cleanupExistingSocket(): Promise<void> {
    if (this.config.socketPath) {
      try {
        await unlink(this.config.socketPath);
      } catch (error: any) {
        // Socket file doesn't exist, that's fine
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
    }
  }

  private async createServer(): Promise<void> {
    this.server = createServer();
    
    // Set server options
    if (this.config.backlog) {
      this.server.maxConnections = this.config.maxConnections || 10;
    }

    // Handle new connections
    this.server.on('connection', (socket: Socket) => {
      this.handleNewConnection(socket);
    });

    // Handle server errors
    this.server.on('error', (error: Error) => {
      console.error('SocketManager server error:', error);
      this.emit('server_error', { error, timestamp: new Date() });
    });

    // Handle server close
    this.server.on('close', () => {
      console.log('SocketManager server closed');
      this.emit('server_closed', { timestamp: new Date() });
    });

    // Handle listening event
    this.server.on('listening', () => {
      console.log(`SocketManager listening on ${this.getServerAddress()}`);
      this.emit('server_listening', { 
        address: this.getServerAddress(),
        timestamp: new Date()
      });
    });
  }

  private async startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        reject(new Error('Server not created'));
        return;
      }

      const timeoutId = setTimeout(() => {
        reject(new Error('Server start timeout'));
      }, this.config.connectionTimeout || 30000);

      const onListening = () => {
        clearTimeout(timeoutId);
        this.server!.removeListener('error', onError);
        resolve();
      };

      const onError = (error: Error) => {
        clearTimeout(timeoutId);
        this.server!.removeListener('listening', onListening);
        reject(error);
      };

      this.server.once('listening', onListening);
      this.server.once('error', onError);

      // Start listening
      if (this.config.socketPath) {
        this.server.listen(this.config.socketPath);
      } else {
        this.server.listen(this.config.port || 8080, this.config.host || 'localhost');
      }
    });
  }

  private handleNewConnection(socket: Socket): void {
    try {
      // Check if we can accept more connections
      if (this.connectionPool.getConnectionCount() >= (this.config.maxConnections || 10)) {
        console.warn('Maximum connections reached, rejecting new connection');
        socket.destroy();
        this.emit('connection_rejected', { 
          reason: 'max_connections_reached',
          timestamp: new Date()
        });
        return;
      }

      // Set socket options
      socket.setKeepAlive(true);
      socket.setTimeout(this.config.connectionTimeout || 30000);
      
      // Generate unique connection ID
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const connectionId = `conn_${++this.connectionCounter}_${Date.now()}`;
      
      // Add connection to pool
      const connection = this.connectionPool.addConnection(socket);
      
      // Set up connection timeout handling
      socket.on('timeout', () => {
        console.warn(`Connection timeout for ${connection.id}`);
        this.connectionPool.removeConnection(connection.id);
      });

      // Set up error handling
      socket.on('error', (error) => {
        console.error(`Socket error for connection ${connection.id}:`, error);
        this.connectionPool.removeConnection(connection.id);
      });

      console.log(`New connection established: ${connection.id}`);
      
    } catch (error) {
      console.error('Error handling new connection:', error);
      socket.destroy();
      this.emit('connection_error', { 
        error: error instanceof Error ? error : new Error('Unknown connection error'),
        timestamp: new Date()
      });
    }
  }

  private getServerAddress(): string {
    if (this.config.socketPath) {
      return this.config.socketPath;
    }
    return `${this.config.host || 'localhost'}:${this.config.port || 8080}`;
  }

  private async cleanup(): Promise<void> {
    try {
      // Clean up socket file if using Unix socket
      if (this.config.socketPath) {
        try {
          await unlink(this.config.socketPath);
        } catch (error: any) {
          // Ignore ENOENT errors
          if (error.code !== 'ENOENT') {
            console.warn('Failed to cleanup socket file:', error);
          }
        }
      }
      
      this.server = null;
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }
}