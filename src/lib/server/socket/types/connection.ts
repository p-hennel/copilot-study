import type { Socket } from 'net';
import type { CrawlerMessage, WebAppMessage } from './messages.js';
import type { SocketServerConfig } from './config.js';

// Connection state enumeration
export enum ConnectionState {
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  AUTHENTICATED = 'authenticated',
  ACTIVE = 'active',
  IDLE = 'idle',
  DISCONNECTING = 'disconnecting',
  DISCONNECTED = 'disconnected',
  ERROR = 'error',
}

// Connection metadata
export interface ConnectionMetadata {
  id: string;
  crawlerId?: string;
  connectedAt: Date;
  lastActivity: Date;
  lastHeartbeat: Date;
  state: ConnectionState;
  version?: string;
  capabilities?: string[];
  remoteAddress?: string;
  userAgent?: string;
  tags?: Record<string, string>;
}

// Connection statistics
export interface ConnectionStats {
  messagesReceived: number;
  messagesSent: number;
  bytesReceived: number;
  bytesSent: number;
  errors: number;
  reconnects: number;
  uptime: number;
  avgResponseTime: number;
  lastError?: {
    timestamp: Date;
    message: string;
    type: string;
  };
}

// Connection configuration
export interface ConnectionConfig {
  heartbeatInterval: number;
  heartbeatTimeout: number;
  messageTimeout: number;
  maxMessageSize: number;
  bufferSize: number;
  autoReconnect: boolean;
  maxReconnectAttempts: number;
  reconnectDelay: number;
}

// Socket connection wrapper
export interface SocketConnection {
  readonly id: string;
  readonly socket: Socket;
  readonly metadata: ConnectionMetadata;
  readonly stats: ConnectionStats;
  readonly config: ConnectionConfig;
  
  // Connection management
  connect(): Promise<void>;
  disconnect(reason?: string): Promise<void>;
  reconnect(): Promise<void>;
  
  // Message handling
  send(message: WebAppMessage): Promise<void>;
  sendRaw(data: string | Buffer): Promise<void>;
  
  // State management
  getState(): ConnectionState;
  setState(state: ConnectionState): void;
  isConnected(): boolean;
  isActive(): boolean;
  
  // Heartbeat management
  startHeartbeat(): void;
  stopHeartbeat(): void;
  sendHeartbeat(): Promise<void>;
  
  // Event handling
  on(event: ConnectionEvent['type'], handler: ConnectionEventHandler): this;
  off(event: ConnectionEvent['type'], handler: ConnectionEventHandler): this;
  emit(name: string, event: ConnectionEvent): boolean;
  
  // Cleanup
  destroy(): void;
}

// Connection events
export type ConnectionEvent = 
  | { type: 'connecting'; connection: SocketConnection }
  | { type: 'connected'; connection: SocketConnection }
  | { type: 'authenticated'; connection: SocketConnection; crawlerId: string }
  | { type: 'message'; connection: SocketConnection; message: CrawlerMessage }
  | { type: 'heartbeat'; connection: SocketConnection; timestamp: Date }
  | { type: 'idle'; connection: SocketConnection; idleTime: number }
  | { type: 'error'; connection: SocketConnection; error: Error }
  | { type: 'disconnecting'; connection: SocketConnection; reason?: string }
  | { type: 'disconnected'; connection: SocketConnection; reason?: string }
  | { type: 'reconnecting'; connection: SocketConnection; attempt: number }
  | { type: 'stats_updated'; connection: SocketConnection; stats: ConnectionStats };

export type ConnectionEventHandler = (event: ConnectionEvent) => void;

// Connection pool management
export interface ConnectionPool {
  readonly connections: Map<string, SocketConnection>;
  readonly config: SocketServerConfig;
  
  // Pool management
  addConnection(socket: Socket): SocketConnection;
  removeConnection(id: string): void;
  getConnection(id: string): SocketConnection | undefined;
  getAllConnections(): SocketConnection[];
  getActiveConnections(): SocketConnection[];
  
  // Broadcasting
  broadcast(message: WebAppMessage): Promise<void>;
  broadcastToActive(message: WebAppMessage): Promise<void>;
  broadcastToCrawlers(crawlerIds: string[], message: WebAppMessage): Promise<void>;
  
  // Pool statistics
  getPoolStats(): PoolStats;
  getConnectionCount(): number;
  getActiveConnectionCount(): number;
  
  // Cleanup and maintenance
  cleanup(): Promise<void>;
  closeAll(reason?: string): Promise<void>;
  
  // Event handling
  on(event: PoolEvent['type'], handler: PoolEventHandler): this;
  off(event: PoolEvent['type'], handler: PoolEventHandler): this;
}

// Pool statistics
export interface PoolStats {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  errorConnections: number;
  totalMessagesHandled: number;
  totalBytesTransferred: number;
  averageConnectionTime: number;
  peakConnections: number;
  lastActivity: Date;
}

// Pool events
export type PoolEvent = 
  | { type: 'connection_added'; connection: SocketConnection }
  | { type: 'connection_removed'; connectionId: string; reason?: string }
  | { type: 'pool_capacity_reached'; maxConnections: number }
  | { type: 'pool_stats_updated'; stats: PoolStats }
  | { type: 'pool_error'; error: Error }
  | { type: 'pool_cleanup'; removedConnections: number };

export type PoolEventHandler = (event: PoolEvent) => void;

// Connection authentication
export interface ConnectionAuth {
  authenticate(connection: SocketConnection, credentials: AuthCredentials): Promise<AuthResult>;
  isAuthenticated(connection: SocketConnection): boolean;
  getCrawlerId(connection: SocketConnection): string | undefined;
  revoke(connection: SocketConnection): void;
}

export interface AuthCredentials {
  type: 'crawler' | 'admin' | 'monitor';
  token?: string;
  crawlerId?: string;
  capabilities?: string[];
  metadata?: Record<string, any>;
}

export interface AuthResult {
  success: boolean;
  crawlerId?: string;
  permissions?: string[];
  error?: string;
  expiresAt?: Date;
}

// Message buffer management
export interface MessageBuffer {
  readonly maxSize: number;
  readonly currentSize: number;
  
  append(data: Buffer | string): void;
  extractMessages(delimiter: string): string[];
  clear(): void;
  isFull(): boolean;
  getUsage(): number; // Returns 0-1 representing fullness
  peek(length?: number): string; // For debugging and JSON parsing
}

// Connection health monitoring
export interface ConnectionHealth {
  readonly connection: SocketConnection;
  readonly isHealthy: boolean;
  readonly lastCheck: Date;
  readonly issues: HealthIssue[];
  
  check(): Promise<HealthResult>;
  getStatus(): HealthStatus;
  subscribe(callback: HealthCallback): () => void;
}

export interface HealthIssue {
  type: 'timeout' | 'high_latency' | 'message_errors' | 'memory_usage' | 'heartbeat_missed';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: Date;
  details?: Record<string, any>;
}

export interface HealthResult {
  healthy: boolean;
  latency: number;
  lastActivity: Date;
  issues: HealthIssue[];
  metrics: {
    responseTime: number;
    errorRate: number;
    messageRate: number;
  };
}

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export type HealthCallback = (health: ConnectionHealth) => void;

// Connection rate limiting
export interface RateLimiter {
  checkLimit(connection: SocketConnection, action: string): Promise<RateLimitResult>;
  updateUsage(connection: SocketConnection, action: string): void;
  getRemainingQuota(connection: SocketConnection, action: string): number;
  reset(connection: SocketConnection): void;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: Date;
  retryAfter?: number;
}

// Connection middleware
export interface ConnectionMiddleware {
  name: string;
  priority: number;
  onConnect?(connection: SocketConnection): Promise<void>;
  onMessage?(connection: SocketConnection, message: CrawlerMessage): Promise<CrawlerMessage | null>;
  onSend?(connection: SocketConnection, message: WebAppMessage): Promise<WebAppMessage | null>;
  onDisconnect?(connection: SocketConnection, reason?: string): Promise<void>;
  onError?(connection: SocketConnection, error: Error): Promise<void>;
}

// Connection factory
export interface ConnectionFactory {
  createConnection(socket: Socket, config: ConnectionConfig): SocketConnection;
  createConnectionPool(config: SocketServerConfig): ConnectionPool;
  createAuth(config: SocketServerConfig): ConnectionAuth;
  createRateLimiter(config: SocketServerConfig): RateLimiter;
}

// Utility types for connection management
export type ConnectionFilter = (connection: SocketConnection) => boolean;
export type ConnectionComparator = (a: SocketConnection, b: SocketConnection) => number;
export type ConnectionTransform<T> = (connection: SocketConnection) => T;