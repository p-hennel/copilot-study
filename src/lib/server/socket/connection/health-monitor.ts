import { EventEmitter } from 'events';
import type { 
  SocketServerConfig,
  SocketConnection,
  ConnectionHealth,
  HealthResult,
  HealthStatus,
  HealthIssue,
  HealthCallback
} from '../types/index.js';
import { ConnectionState } from '../types/connection.js';

/**
 * HealthMonitor - Connection health monitoring implementation
 * 
 * Monitors connection health with heartbeat tracking, automatic detection
 * of dead connections, and collection of connection metrics and statistics.
 */
export class HealthMonitorImpl extends EventEmitter {
  private healthChecks = new Map<string, ConnectionHealthImpl>();
  private monitoringInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(private readonly config: SocketServerConfig) {
    super();
  }

  /**
   * Start health monitoring
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    const interval = this.config.healthCheckInterval || 60000; // 1 minute default
    
    this.monitoringInterval = setInterval(() => {
      this.performHealthChecks();
    }, interval);

    console.log(`Health monitoring started (interval: ${interval}ms)`);
  }

  /**
   * Stop health monitoring
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    // Clean up health checks
    this.healthChecks.clear();
    
    console.log('Health monitoring stopped');
  }

  /**
   * Add a connection to health monitoring
   */
  addConnection(connection: SocketConnection): ConnectionHealth {
    const health = new ConnectionHealthImpl(connection, this.config);
    this.healthChecks.set(connection.id, health);
    
    // Set up connection event handlers to update health
    connection.on('heartbeat', () => {
      health.recordHeartbeat();
    });

    connection.on('message', () => {
      health.recordActivity();
    });

    connection.on('error', (event) => {
      if ('error' in event) {
        health.recordError(event.error);
      }
    });

    connection.on('disconnected', () => {
      this.removeConnection(connection.id);
    });

    return health;
  }

  /**
   * Remove a connection from health monitoring
   */
  removeConnection(connectionId: string): void {
    const health = this.healthChecks.get(connectionId);
    if (health) {
      health.destroy();
      this.healthChecks.delete(connectionId);
    }
  }

  /**
   * Get health status for a specific connection
   */
  getConnectionHealth(connectionId: string): ConnectionHealth | undefined {
    return this.healthChecks.get(connectionId);
  }

  /**
   * Get health status for all monitored connections
   */
  getAllHealthStatuses(): Map<string, ConnectionHealth> {
    return new Map(this.healthChecks);
  }

  /**
   * Get overall health summary
   */
  getHealthSummary() {
    const healths = Array.from(this.healthChecks.values());
    const total = healths.length;
    
    if (total === 0) {
      return {
        total: 0,
        healthy: 0,
        degraded: 0,
        unhealthy: 0,
        unknown: 0,
        healthyPercentage: 0
      };
    }

    const statusCounts = healths.reduce((counts, health) => {
      const status = health.getStatus();
      counts[status]++;
      return counts;
    }, { healthy: 0, degraded: 0, unhealthy: 0, unknown: 0 });

    return {
      total,
      ...statusCounts,
      healthyPercentage: (statusCounts.healthy / total) * 100
    };
  }

  private async performHealthChecks(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    const unhealthyConnections: string[] = [];
    
    for (const [connectionId, health] of this.healthChecks) {
      try {
        const result = await health.check();
        
        if (!result.healthy) {
          unhealthyConnections.push(connectionId);
          
          // Emit health warning
          this.emit('health_warning', {
            connectionId,
            status: health.getStatus(),
            issues: result.issues
          });
        }
      } catch (error) {
        console.error(`Health check failed for connection ${connectionId}:`, error);
        unhealthyConnections.push(connectionId);
      }
    }

    // Emit overall health status
    this.emit('health_summary', {
      timestamp: new Date(),
      summary: this.getHealthSummary(),
      unhealthyConnections
    });
  }
}

/**
 * ConnectionHealth implementation for individual connections
 */
class ConnectionHealthImpl implements ConnectionHealth {
  private _lastCheck = new Date();
  private _issues: HealthIssue[] = [];
  private callbacks: HealthCallback[] = [];
  private metrics = {
    heartbeatCount: 0,
    activityCount: 0,
    errorCount: 0,
    lastHeartbeat: new Date(),
    lastActivity: new Date()
  };

  constructor(
    readonly connection: SocketConnection,
    private readonly config: SocketServerConfig
  ) {}

  get isHealthy(): boolean {
    return this.getStatus() === 'healthy';
  }

  get lastCheck(): Date {
    return this._lastCheck;
  }

  get issues(): HealthIssue[] {
    return [...this._issues];
  }

  /**
   * Perform health check
   */
  async check(): Promise<HealthResult> {
    this._lastCheck = new Date();
    this._issues = [];

    const now = Date.now();
    const state = this.connection.getState();
    const metadata = this.connection.metadata;

    // Check connection state
    if (state === ConnectionState.ERROR || state === ConnectionState.DISCONNECTED) {
      this.addIssue('timeout', 'critical', 'Connection is in error or disconnected state');
    }

    // Check heartbeat timeout
    const heartbeatTimeout = this.config.heartbeatTimeout || 90000;
    const timeSinceHeartbeat = now - metadata.lastHeartbeat.getTime();
    if (timeSinceHeartbeat > heartbeatTimeout) {
      this.addIssue('heartbeat_missed', 'high', 
        `Heartbeat timeout: ${timeSinceHeartbeat}ms since last heartbeat`);
    }

    // Check activity timeout
    const activityTimeout = this.config.connectionTimeout || 30000;
    const timeSinceActivity = now - metadata.lastActivity.getTime();
    if (timeSinceActivity > activityTimeout) {
      this.addIssue('timeout', 'medium', 
        `Activity timeout: ${timeSinceActivity}ms since last activity`);
    }

    // Check error rate
    const stats = this.connection.stats;
    const totalMessages = stats.messagesReceived + stats.messagesSent;
    if (totalMessages > 0) {
      const errorRate = stats.errors / totalMessages;
      if (errorRate > 0.1) { // 10% error rate threshold
        this.addIssue('message_errors', 'medium', 
          `High error rate: ${(errorRate * 100).toFixed(1)}%`);
      }
    }

    // Check response time
    if (stats.avgResponseTime > 5000) { // 5 second threshold
      this.addIssue('high_latency', 'low', 
        `High average response time: ${stats.avgResponseTime}ms`);
    }

    const result: HealthResult = {
      healthy: this.issues.length === 0,
      latency: stats.avgResponseTime,
      lastActivity: metadata.lastActivity,
      issues: [...this.issues],
      metrics: {
        responseTime: stats.avgResponseTime,
        errorRate: totalMessages > 0 ? stats.errors / totalMessages : 0,
        messageRate: this.calculateMessageRate()
      }
    };

    // Notify callbacks
    this.notifyCallbacks();

    return result;
  }

  /**
   * Get current health status
   */
  getStatus(): HealthStatus {
    if (this._issues.length === 0) {
      return 'healthy';
    }

    const hasCritical = this._issues.some(issue => issue.severity === 'critical');
    if (hasCritical) {
      return 'unhealthy';
    }

    const hasHigh = this._issues.some(issue => issue.severity === 'high');
    if (hasHigh) {
      return 'unhealthy';
    }

    const hasMedium = this._issues.some(issue => issue.severity === 'medium');
    if (hasMedium) {
      return 'degraded';
    }

    return 'degraded'; // Has low severity issues
  }

  /**
   * Subscribe to health status changes
   */
  subscribe(callback: HealthCallback): () => void {
    this.callbacks.push(callback);
    
    return () => {
      const index = this.callbacks.indexOf(callback);
      if (index > -1) {
        this.callbacks.splice(index, 1);
      }
    };
  }

  /**
   * Record heartbeat activity
   */
  recordHeartbeat(): void {
    this.metrics.heartbeatCount++;
    this.metrics.lastHeartbeat = new Date();
  }

  /**
   * Record general activity
   */
  recordActivity(): void {
    this.metrics.activityCount++;
    this.metrics.lastActivity = new Date();
  }

  /**
   * Record error occurrence
   */
  recordError(error: Error): void {
    this.metrics.errorCount++;
    this.addIssue('message_errors', 'medium', `Connection error: ${error.message}`);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.callbacks = [];
    this._issues = [];
  }

  private addIssue(type: HealthIssue['type'], severity: HealthIssue['severity'], message: string): void {
    this._issues.push({
      type,
      severity,
      message,
      timestamp: new Date(),
      details: {
        connectionId: this.connection.id,
        connectionState: this.connection.getState()
      }
    });
  }

  private calculateMessageRate(): number {
    const stats = this.connection.stats;
    const uptime = stats.uptime;
    
    if (uptime === 0) {
      return 0;
    }
    
    const totalMessages = stats.messagesReceived + stats.messagesSent;
    return (totalMessages / uptime) * 1000; // Messages per second
  }

  private notifyCallbacks(): void {
    for (const callback of this.callbacks) {
      try {
        callback(this);
      } catch (error) {
        console.error('Error in health callback:', error);
      }
    }
  }
}