import { EventEmitter } from 'events';
import type { Socket } from 'net';
import { 
  type ConnectionPool,
  type SocketConnection,
  type SocketServerConfig,
  type WebAppMessage,
  type PoolStats,
  type PoolEvent,
  type PoolEventHandler,
} from '../types/index';
import { ConnectionState } from '../types/connection';
import { SocketConnectionImpl } from './socket-connection';

/**
 * ConnectionPool - Manages multiple active socket connections
 * 
 * Provides connection lifecycle management, health checks, timeouts,
 * and broadcasting capabilities for multiple crawler connections.
 */
export class ConnectionPoolImpl extends EventEmitter implements ConnectionPool {
  readonly connections = new Map<string, SocketConnection>();
  private connectionIdCounter = 0;
  private poolStats: PoolStats;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(readonly config: SocketServerConfig) {
    super();
    
    // Initialize pool statistics
    this.poolStats = {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      errorConnections: 0,
      totalMessagesHandled: 0,
      totalBytesTransferred: 0,
      averageConnectionTime: 0,
      peakConnections: 0,
      lastActivity: new Date()
    };

    // Start cleanup routine
    this.startCleanupRoutine();
  }

  /**
   * Add a new socket connection to the pool
   */
  addConnection(socket: Socket): SocketConnection {
    const connectionId = `conn_${++this.connectionIdCounter}_${Date.now()}`;
    
    // Create connection wrapper
    const connection = new SocketConnectionImpl(connectionId, socket, {
      heartbeatInterval: this.config.heartbeatInterval || 30000,
      heartbeatTimeout: this.config.heartbeatTimeout || 90000,
      messageTimeout: this.config.connectionTimeout || 30000,
      maxMessageSize: this.config.maxMessageSize || 1024 * 1024,
      bufferSize: this.config.messageBufferSize || 1024 * 1024,
      autoReconnect: false, // Server-side connections don't auto-reconnect
      maxReconnectAttempts: 0,
      reconnectDelay: 0
    });

    // Set up event handlers
    this.setupConnectionEvents(connection);

    // Add to pool
    this.connections.set(connectionId, connection);
    
    // Update statistics
    this.updatePoolStats();
    this.poolStats.peakConnections = Math.max(this.poolStats.peakConnections, this.connections.size);

    // Emit pool event
    this.emit('connection_added', { 
      type: 'connection_added',
      connection 
    } as PoolEvent);

    console.log(`Connection ${connectionId} added to pool (total: ${this.connections.size})`);
    
    return connection;
  }

  /**
   * Remove a connection from the pool
   */
  removeConnection(id: string): void {
    const connection = this.connections.get(id);
    if (!connection) {
      return;
    }

    try {
      // Clean up the connection
      connection.destroy();
      
      // Remove from pool
      this.connections.delete(id);
      
      // Update statistics
      this.updatePoolStats();

      // Emit pool event
      this.emit('connection_removed', { 
        type: 'connection_removed',
        connectionId: id,
        reason: 'Removed from pool'
      } as PoolEvent);

      console.log(`Connection ${id} removed from pool (total: ${this.connections.size})`);
    } catch (error) {
      console.error(`Error removing connection ${id}:`, error);
    }
  }

  /**
   * Get a specific connection by ID
   */
  getConnection(id: string): SocketConnection | undefined {
    return this.connections.get(id);
  }

  /**
   * Get all connections
   */
  getAllConnections(): SocketConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Get only active connections
   */
  getActiveConnections(): SocketConnection[] {
    return this.getAllConnections().filter(conn => conn.isActive());
  }

  /**
   * Broadcast message to all active connections
   */
  async broadcast(message: WebAppMessage): Promise<void> {
    const activeConnections = this.getActiveConnections();
    
    if (activeConnections.length === 0) {
      console.warn('No active connections to broadcast to');
      return;
    }

    const sendPromises = activeConnections.map(async (connection) => {
      try {
        await connection.send(message);
        return { success: true, connectionId: connection.id };
      } catch (error) {
        console.error(`Failed to send message to ${connection.id}:`, error);
        return { success: false, connectionId: connection.id, error };
      }
    });

    const results = await Promise.allSettled(sendPromises);
    const successful = results.filter(r => r.status === 'fulfilled').length;
    
    console.log(`Broadcast complete: ${successful}/${activeConnections.length} connections`);
  }

  /**
   * Broadcast message to all active connections
   */
  async broadcastToActive(message: WebAppMessage): Promise<void> {
    return this.broadcast(message);
  }

  /**
   * Broadcast message to specific crawlers
   */
  async broadcastToCrawlers(crawlerIds: string[], message: WebAppMessage): Promise<void> {
    const targetConnections = this.getAllConnections().filter(conn => 
      conn.isActive() && 
      conn.metadata.crawlerId && 
      crawlerIds.includes(conn.metadata.crawlerId)
    );

    if (targetConnections.length === 0) {
      console.warn(`No active connections found for crawlers: ${crawlerIds.join(', ')}`);
      return;
    }

    const sendPromises = targetConnections.map(async (connection) => {
      try {
        await connection.send(message);
        return { success: true, connectionId: connection.id };
      } catch (error) {
        console.error(`Failed to send message to crawler ${connection.metadata.crawlerId}:`, error);
        return { success: false, connectionId: connection.id, error };
      }
    });

    const results = await Promise.allSettled(sendPromises);
    const successful = results.filter(r => r.status === 'fulfilled').length;
    
    console.log(`Crawler broadcast complete: ${successful}/${targetConnections.length} connections`);
  }

  /**
   * Get pool statistics
   */
  getPoolStats(): PoolStats {
    this.updatePoolStats();
    return { ...this.poolStats };
  }

  /**
   * Get connection count
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Get active connection count
   */
  getActiveConnectionCount(): number {
    return this.getActiveConnections().length;
  }

  /**
   * Clean up dead/unhealthy connections
   */
  async cleanup(): Promise<void> {
    const connectionsToRemove: string[] = [];
    const now = Date.now();
    
    for (const [id, connection] of this.connections) {
      const shouldRemove = this.shouldRemoveConnection(connection, now);
      if (shouldRemove.remove) {
        console.log(`Marking connection ${id} for cleanup: ${shouldRemove.reason}`);
        connectionsToRemove.push(id);
      }
    }

    // Remove unhealthy connections
    for (const id of connectionsToRemove) {
      this.removeConnection(id);
    }

    if (connectionsToRemove.length > 0) {
      this.emit('pool_cleanup', { 
        type: 'pool_cleanup',
        removedConnections: connectionsToRemove.length
      } as PoolEvent);
    }
  }

  /**
   * Close all connections gracefully
   */
  async closeAll(reason = 'Pool shutdown'): Promise<void> {
    console.log(`Closing all connections: ${reason}`);
    
    const closePromises = Array.from(this.connections.values()).map(async (connection) => {
      try {
        await connection.disconnect(reason);
      } catch (error) {
        console.error(`Error closing connection ${connection.id}:`, error);
        // Force destroy if graceful close fails
        connection.destroy();
      }
    });

    await Promise.allSettled(closePromises);
    
    // Clear the pool
    this.connections.clear();
    
    // Stop cleanup routine
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    // Update stats
    this.updatePoolStats();
    
    console.log('All connections closed');
  }

  /**
   * Event handler registration
   */
  on(event: PoolEvent['type'], handler: PoolEventHandler): this {
    super.on(event, handler);
    return this;
  }

  off(event: PoolEvent['type'], handler: PoolEventHandler): this {
    super.off(event, handler);
    return this;
  }

  private setupConnectionEvents(connection: SocketConnection): void {
    // Forward connection events
    connection.on('message', () => {
      this.poolStats.totalMessagesHandled++;
      this.poolStats.lastActivity = new Date();
    });

    connection.on('disconnected', () => {
      // Connection will be cleaned up by the cleanup routine
      this.updatePoolStats();
    });

    connection.on('error', (event) => {
      if (event.type === "error")
        console.error(`Connection ${connection.id} error:`, event.error);
      this.updatePoolStats();
    });

    connection.on('stats_updated', (event) => {
      if (event.type === "stats_updated") {
        this.poolStats.totalBytesTransferred += (event.stats.bytesReceived + event.stats.bytesSent);
        this.updatePoolStats();
      }
    });
  }

  private shouldRemoveConnection(connection: SocketConnection, now: number): { remove: boolean; reason?: string } {
    const state = connection.getState();
    const lastActivity = connection.metadata.lastActivity.getTime();
    const connectionTimeout = this.config.connectionTimeout || 30000;
    const heartbeatTimeout = this.config.heartbeatTimeout || 90000;

    // Remove disconnected connections
    if (state === ConnectionState.DISCONNECTED) {
      return { remove: true, reason: 'disconnected' };
    }

    // Remove error connections
    if (state === ConnectionState.ERROR) {
      return { remove: true, reason: 'error state' };
    }

    // Remove timed out connections
    if (now - lastActivity > connectionTimeout) {
      return { remove: true, reason: 'activity timeout' };
    }

    // Remove connections with missed heartbeats
    const lastHeartbeat = connection.metadata.lastHeartbeat.getTime();
    if (now - lastHeartbeat > heartbeatTimeout) {
      return { remove: true, reason: 'heartbeat timeout' };
    }

    return { remove: false };
  }

  private updatePoolStats(): void {
    const connections = this.getAllConnections();
    
    this.poolStats.totalConnections = connections.length;
    this.poolStats.activeConnections = connections.filter(c => c.isActive()).length;
    this.poolStats.idleConnections = connections.filter(c => c.getState() === ConnectionState.IDLE).length;
    this.poolStats.errorConnections = connections.filter(c => c.getState() === ConnectionState.ERROR).length;

    // Calculate average connection time
    if (connections.length > 0) {
      const totalConnectionTime = connections.reduce((sum, conn) => {
        return sum + (Date.now() - conn.metadata.connectedAt.getTime());
      }, 0);
      this.poolStats.averageConnectionTime = totalConnectionTime / connections.length;
    }

    // Emit stats update
    this.emit('pool_stats_updated', { 
      type: 'pool_stats_updated',
      stats: this.poolStats
    } as PoolEvent);
  }

  private startCleanupRoutine(): void {
    const cleanupInterval = this.config.cleanupInterval || 60000; // 1 minute default
    
    this.cleanupInterval = setInterval(async () => {
      try {
        await this.cleanup();
      } catch (error) {
        console.error('Error during connection pool cleanup:', error);
      }
    }, cleanupInterval);
  }
}