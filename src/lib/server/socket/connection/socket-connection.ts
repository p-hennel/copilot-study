import { EventEmitter } from 'events';
import type { Socket } from 'net';
import type { 
  SocketConnection,
  ConnectionMetadata,
  ConnectionStats,
  ConnectionConfig,
  ConnectionState,
  ConnectionEvent,
  ConnectionEventHandler,
  WebAppMessage,
  MessageBuffer
} from '../types/index';
import { ConnectionState as ConnState } from '../types/connection';
import { MessageBufferImpl } from './message-buffer';

/**
 * SocketConnection - Individual connection wrapper implementation
 * 
 * Wraps a raw socket with connection management, state tracking,
 * heartbeat handling, and message buffering capabilities.
 */
export class SocketConnectionImpl extends EventEmitter implements SocketConnection {
  readonly id: string;
  readonly socket: Socket;
  readonly metadata: ConnectionMetadata;
  readonly stats: ConnectionStats;
  readonly config: ConnectionConfig;
  
  private messageBuffer: MessageBuffer;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private messageTimeouts = new Map<string, NodeJS.Timeout>();
  private isDestroyed = false;

  constructor(id: string, socket: Socket, config: ConnectionConfig) {
    super();
    
    this.id = id;
    this.socket = socket;
    this.config = config;
    
    // Initialize metadata
    this.metadata = {
      id,
      connectedAt: new Date(),
      lastActivity: new Date(),
      lastHeartbeat: new Date(),
      state: ConnState.CONNECTING,
      remoteAddress: socket.remoteAddress,
      tags: {}
    };

    // Initialize statistics
    this.stats = {
      messagesReceived: 0,
      messagesSent: 0,
      bytesReceived: 0,
      bytesSent: 0,
      errors: 0,
      reconnects: 0,
      uptime: 0,
      avgResponseTime: 0
    };

    // Initialize message buffer
    this.messageBuffer = new MessageBufferImpl(this.config.bufferSize);

    // Set up socket event handlers
    this.setupSocketHandlers();
    
    // Set connection state to connected
    this.setState(ConnState.CONNECTED);
  }

  /**
   * Connect (for client-side connections, server-side are already connected)
   */
  async connect(): Promise<void> {
    if (this.socket.readyState === 'open') {
      this.setState(ConnState.CONNECTED);
      return;
    }
    throw new Error('Server-side connections are already connected');
  }

  /**
   * Disconnect gracefully
   */
  async disconnect(reason?: string): Promise<void> {
    if (this.isDestroyed) {
      return;
    }

    this.setState(ConnState.DISCONNECTING);
    
    try {
      // Stop heartbeat
      this.stopHeartbeat();
      
      // Clear message timeouts
      this.clearMessageTimeouts();
      
      // Close socket gracefully
      this.socket.end();
      
      // Wait for socket to close or timeout
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          this.socket.destroy();
          resolve();
        }, this.config.messageTimeout);
        
        this.socket.once('close', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      
      this.setState(ConnState.DISCONNECTED);
      this.emitConnectionEvent({
        type: 'disconnected',
        connection: this,
        reason
      });
      
    } catch (error) {
      this.setState(ConnState.ERROR);
      this.emitConnectionEvent({
        type: 'error',
        connection: this,
        error: error instanceof Error ? error : new Error('Disconnect failed')
      });
    }
  }

  /**
   * Reconnect (not applicable for server-side connections)
   */
  async reconnect(): Promise<void> {
    throw new Error('Server-side connections cannot reconnect');
  }

  /**
   * Send a structured message
   */
  async send(message: WebAppMessage): Promise<void> {
    if (this.isDestroyed || !this.socket.writable) {
      throw new Error('Connection is not writable');
    }

    try {
      const messageString = JSON.stringify(message);
      const messageData = messageString + '\n';
      
      await this.sendRaw(messageData);
      
      this.stats.messagesSent++;
      this.updateActivity();
      
    } catch (error) {
      this.stats.errors++;
      this.updateStats();
      throw error;
    }
  }

  /**
   * Send raw data
   */
  async sendRaw(data: string | Buffer): Promise<void> {
    if (this.isDestroyed || !this.socket.writable) {
      throw new Error('Connection is not writable');
    }

    return new Promise((resolve, reject) => {
      const messageId = `msg_${Date.now()}_${Math.random()}`;
      
      // Set up timeout
      const timeout = setTimeout(() => {
        this.messageTimeouts.delete(messageId);
        reject(new Error('Message send timeout'));
      }, this.config.messageTimeout);
      
      this.messageTimeouts.set(messageId, timeout);
      
      this.socket.write(data, (error) => {
        clearTimeout(timeout);
        this.messageTimeouts.delete(messageId);
        
        if (error) {
          this.stats.errors++;
          this.updateStats();
          reject(error);
        } else {
          const bytes = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data);
          this.stats.bytesSent += bytes;
          this.updateActivity();
          this.updateStats();
          resolve();
        }
      });
    });
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.metadata.state;
  }

  /**
   * Set connection state
   */
  setState(state: ConnectionState): void {
    const oldState = this.metadata.state;
    this.metadata.state = state;
    
    if (oldState !== state) {
      console.log(`Connection ${this.id} state: ${oldState} -> ${state}`);
      
      // Emit specific state change events
      switch (state) {
        case ConnState.CONNECTED:
          this.emit('connected', { type: 'connected', connection: this });
          break;
        case ConnState.AUTHENTICATED:
          this.emit('authenticated', { 
            type: 'authenticated', 
            connection: this, 
            crawlerId: this.metadata.crawlerId || ''
          });
          break;
        case ConnState.IDLE:
          this.emit('idle', { 
            type: 'idle', 
            connection: this, 
            idleTime: Date.now() - this.metadata.lastActivity.getTime()
          });
          break;
        case ConnState.ERROR:
          this.emit('error', { 
            type: 'error', 
            connection: this, 
            error: new Error('Connection entered error state')
          });
          break;
      }
    }
  }

  /**
   * Check if connection is connected
   */
  isConnected(): boolean {
    return this.metadata.state === ConnState.CONNECTED || 
           this.metadata.state === ConnState.AUTHENTICATED ||
           this.metadata.state === ConnState.ACTIVE;
  }

  /**
   * Check if connection is active
   */
  isActive(): boolean {
    return this.metadata.state === ConnState.ACTIVE ||
           this.metadata.state === ConnState.AUTHENTICATED;
  }

  /**
   * Start heartbeat monitoring
   */
  startHeartbeat(): void {
    if (this.heartbeatTimer) {
      return;
    }

    this.heartbeatTimer = setInterval(() => {
      this.checkHeartbeat();
    }, this.config.heartbeatInterval);
  }

  /**
   * Stop heartbeat monitoring
   */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Send heartbeat (server doesn't send heartbeats, just monitors them)
   */
  async sendHeartbeat(): Promise<void> {
    // Server-side connections don't send heartbeats, they receive them
    throw new Error('Server-side connections do not send heartbeats');
  }

  /**
   * Event handler registration
   */
  on(event: ConnectionEvent['type'], handler: ConnectionEventHandler): this {
    return super.on(event, handler);
  }

  off(event: ConnectionEvent['type'], handler: ConnectionEventHandler): this {
    return super.off(event, handler);
  }

  emit(name: string, event: ConnectionEvent): boolean {
    return super.emit(name, event);
  }

  emitConnectionEvent(event: ConnectionEvent): boolean {
    return super.emit(event.type, event);
  }

  /**
   * Destroy the connection immediately
   */
  destroy(): void {
    if (this.isDestroyed) {
      return;
    }

    this.isDestroyed = true;
    
    try {
      // Stop heartbeat
      this.stopHeartbeat();
      
      // Clear timeouts
      this.clearMessageTimeouts();
      
      // Destroy socket
      this.socket.destroy();
      
      // Update state
      this.setState(ConnState.DISCONNECTED);
      
    } catch (error) {
      console.error(`Error destroying connection ${this.id}:`, error);
    }
  }

  private setupSocketHandlers(): void {
    // Handle incoming data
    this.socket.on('data', (data: Buffer) => {
      this.handleIncomingData(data);
    });

    // Handle socket close
    this.socket.on('close', (hadError: boolean) => {
      console.log(`Socket closed for connection ${this.id}, hadError: ${hadError}`);
      this.setState(ConnState.DISCONNECTED);
      this.emit('disconnected', { 
        type: 'disconnected', 
        connection: this, 
        reason: hadError ? 'Socket error' : 'Socket closed'
      });
    });

    // Handle socket errors
    this.socket.on('error', (error: Error) => {
      console.error(`Socket error for connection ${this.id}:`, error);
      this.stats.errors++;
      this.setState(ConnState.ERROR);
      this.emit('error', { type: 'error', connection: this, error });
    });

    // Handle socket timeout
    this.socket.on('timeout', () => {
      console.warn(`Socket timeout for connection ${this.id}`);
      this.setState(ConnState.ERROR);
      this.emit('error', { 
        type: 'error', 
        connection: this, 
        error: new Error('Socket timeout') 
      });
    });
  }

  private handleIncomingData(data: Buffer): void {
    try {
      // Update statistics
      this.stats.bytesReceived += data.length;
      this.updateActivity();

      // Add data to buffer
      this.messageBuffer.append(data);

      // Extract complete messages
      const messages = this.messageBuffer.extractMessages('\n');
      
      for (const messageString of messages) {
        this.processMessage(messageString);
      }

      this.updateStats();
      
    } catch (error) {
      console.error(`Error handling incoming data for ${this.id}:`, error);
      this.stats.errors++;
      this.updateStats();
    }
  }

  private processMessage(messageString: string): void {
    try {
      const message = JSON.parse(messageString) as any;

      if (!("type" in message))
        throw new Error(`Invalid message structure: ${message}`)
      
      // Update message statistics
      this.stats.messagesReceived++;
      this.updateActivity();

      // Update heartbeat timestamp for heartbeat messages
      if (message.type === 'heartbeat') {
        this.metadata.lastHeartbeat = new Date();
        this.emit('heartbeat', { 
          type: 'heartbeat', 
          connection: this, 
          timestamp: new Date() 
        });
      }

      // Emit message event
      this.emit('message', { 
        type: 'message', 
        connection: this, 
        message 
      });
      
    } catch (error) {
      console.error(`Error parsing message for ${this.id}:`, error);
      this.stats.errors++;
      this.updateStats();
    }
  }

  private checkHeartbeat(): void {
    const now = Date.now();
    const lastHeartbeat = this.metadata.lastHeartbeat.getTime();
    const heartbeatTimeout = this.config.heartbeatTimeout;

    if (now - lastHeartbeat > heartbeatTimeout) {
      console.warn(`Heartbeat timeout for connection ${this.id}`);
      this.setState(ConnState.ERROR);
      this.emit('error', { 
        type: 'error', 
        connection: this, 
        error: new Error('Heartbeat timeout') 
      });
    }
  }

  private updateActivity(): void {
    this.metadata.lastActivity = new Date();
  }

  private updateStats(): void {
    this.stats.uptime = Date.now() - this.metadata.connectedAt.getTime();
    
    // Emit stats updated event
    this.emit('stats_updated', { 
      type: 'stats_updated', 
      connection: this, 
      stats: { ...this.stats } 
    });
  }

  private clearMessageTimeouts(): void {
    for (const timeout of this.messageTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.messageTimeouts.clear();
  }
}