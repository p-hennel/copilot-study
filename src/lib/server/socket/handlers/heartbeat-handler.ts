import type { HeartbeatMessage } from '../types/messages.js';
import type { SocketConnection } from '../types/connection.js';
import type { DatabaseManager } from '../persistence/database-manager.js';

/**
 * Process heartbeat messages from crawler to update system status
 * 
 * Handles:
 * - Heartbeat messages from crawler to update system status
 * - Track crawler health and activity status
 * - Update internal monitoring and metrics
 * - Handle connection health validation
 */
export class HeartbeatHandler {
  constructor(private dbManager: DatabaseManager) {}

  /**
   * Process heartbeat message from crawler
   */
  async processHeartbeat(
    connection: SocketConnection, 
    message: HeartbeatMessage
  ): Promise<void> {
    try {
      // Update connection metadata with heartbeat data
      await this.updateConnectionMetadata(connection, message);
      
      // Update system metrics
      await this.updateSystemMetrics(message);
      
      // Log heartbeat for monitoring
      this.logHeartbeat(connection, message);
      
    } catch (error) {
      console.error(`Error processing heartbeat from ${connection.id}:`, error);
      throw error;
    }
  }

  /**
   * Update connection metadata with heartbeat information
   */
  private async updateConnectionMetadata(
    connection: SocketConnection,
    message: HeartbeatMessage
  ): Promise<void> {
    // Update connection metadata - we'll extend the metadata interface later
    const metadata = connection.metadata as any;
    metadata.lastHeartbeat = message.timestamp;
    metadata.activeJobs = message.data.activeJobs;
    metadata.systemStatus = message.data.systemStatus;
    metadata.lastActivity = message.timestamp; // Use message timestamp since last_activity doesn't exist

    // Update database connection state if needed
    const connectionStateOps = this.dbManager.createConnectionStateOperations();
    // Map processing status to the expected crawling status for database compatibility
    const dbStatus = message.data.systemStatus === 'processing' ? 'crawling' : message.data.systemStatus;
    await connectionStateOps.updateHeartbeat(connection.id, dbStatus as 'idle' | 'discovering' | 'crawling' | 'error');
  }

  /**
   * Update system-wide metrics
   */
  private async updateSystemMetrics(message: HeartbeatMessage): Promise<void> {
    // In a production system, you might want to store these metrics
    // in a time-series database or metrics collection system
    
    const metrics = {
      timestamp: new Date(message.timestamp),
      activeJobs: message.data.activeJobs,
      systemStatus: message.data.systemStatus,
      totalProcessed: message.data.totalProcessed,
      lastActivity: new Date(message.timestamp) // Use message timestamp as activity indicator
    };

    // For now, we'll just log the metrics
    // In production, you might send to monitoring systems like Prometheus, etc.
    console.log('System metrics updated:', metrics);
  }

  /**
   * Log heartbeat for debugging and monitoring
   */
  private logHeartbeat(connection: SocketConnection, message: HeartbeatMessage): void {
    console.log(`Heartbeat received from ${connection.id}:`, {
      activeJobs: message.data.activeJobs,
      systemStatus: message.data.systemStatus,
      totalProcessed: message.data.totalProcessed,
      timestamp: message.timestamp
    });
  }

  /**
   * Check if heartbeat indicates any issues
   */
  checkHeartbeatHealth(message: HeartbeatMessage): HealthStatus {
    const issues: string[] = [];
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';

    // Check system status
    if (message.data.systemStatus === 'error') {
      issues.push('Crawler reported error status');
      status = 'critical';
    }

    // Check message age (if too old, might indicate issues)
    const messageTime = new Date(message.timestamp);
    const timeSinceMessage = Date.now() - messageTime.getTime();
    const maxIdleTime = 5 * 60 * 1000; // 5 minutes

    if (timeSinceMessage > maxIdleTime && message.data.activeJobs > 0) {
      issues.push(`Last heartbeat was ${Math.round(timeSinceMessage / 1000)}s ago but has active jobs`);
      status = status === 'critical' ? 'critical' : 'warning';
    }

    // Check active jobs vs status consistency
    if (message.data.activeJobs === 0 && message.data.systemStatus === 'processing') {
      issues.push('Status shows processing but no active jobs');
      status = status === 'critical' ? 'critical' : 'warning';
    }

    return {
      status,
      issues,
      activeJobs: message.data.activeJobs,
      systemStatus: message.data.systemStatus,
      lastActivity: messageTime
    };
  }

  /**
   * Handle missed heartbeats (called by connection manager)
   */
  async handleMissedHeartbeat(connection: SocketConnection): Promise<void> {
    console.warn(`Missed heartbeat from connection ${connection.id}`);
    
    // Mark connection as potentially stale
    const metadata = connection.metadata as any;
    metadata.missedHeartbeats = (metadata.missedHeartbeats || 0) + 1;
    metadata.lastMissedHeartbeat = new Date().toISOString();

    // If too many missed heartbeats, consider connection dead
    const maxMissedHeartbeats = 3;
    if ((metadata.missedHeartbeats || 0) >= maxMissedHeartbeats) {
      console.error(`Connection ${connection.id} exceeded max missed heartbeats, marking as dead`);
      
      // Update connection state
      const connectionStateOps = this.dbManager.createConnectionStateOperations();
      await connectionStateOps.markDisconnected(connection.id);
      
      // Disconnect the connection (implement this method call appropriately)
      console.log(`Would disconnect connection ${connection.id}`);
    }
  }

  /**
   * Get heartbeat statistics for monitoring
   */
  getHeartbeatStatistics(connections: SocketConnection[]): HeartbeatStatistics {
    const stats: HeartbeatStatistics = {
      totalConnections: connections.length,
      activeConnections: 0,
      totalActiveJobs: 0,
      systemStatuses: {
        idle: 0,
        discovering: 0,
        processing: 0,
        error: 0
      },
      healthyConnections: 0,
      staleConnections: 0
    };

    const now = Date.now();
    const staleThreshold = 2 * 60 * 1000; // 2 minutes

    connections.forEach(conn => {
      if (conn.isActive()) {
        stats.activeConnections++;
        
        const metadata = conn.metadata as any;
        const lastHeartbeat = metadata.lastHeartbeat ?
          new Date(metadata.lastHeartbeat).getTime() : 0;
        
        if (now - lastHeartbeat < staleThreshold) {
          stats.healthyConnections++;
        } else {
          stats.staleConnections++;
        }

        // Count active jobs
        stats.totalActiveJobs += metadata.activeJobs || 0;

        // Count system statuses
        const systemStatus = metadata.systemStatus;
        if (systemStatus && systemStatus in stats.systemStatuses) {
          (stats.systemStatuses as any)[systemStatus]++;
        }
      }
    });

    return stats;
  }
}

// Type definitions
interface HealthStatus {
  status: 'healthy' | 'warning' | 'critical';
  issues: string[];
  activeJobs: number;
  systemStatus: string;
  lastActivity: Date;
}

interface HeartbeatStatistics {
  totalConnections: number;
  activeConnections: number;
  totalActiveJobs: number;
  systemStatuses: {
    idle: number;
    discovering: number;
    processing: number;
    error: number;
  };
  healthyConnections: number;
  staleConnections: number;
}