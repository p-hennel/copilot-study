import { getLogger } from '$lib/logging';
import { jobService } from '$lib/server/socket/services/job-service.js';
import type { 
  SocketConnection,
  ProgressData
} from '$lib/server/socket/types/index.js';
import type { CompletionData, FailureData } from '../types/data';

const logger = getLogger(['backend', 'socket', 'admin-bridge']);

/**
 * Admin UI Bridge - Connects socket server events to admin UI data flows
 * 
 * This service bridges the gap between the socket communication layer and the
 * admin UI, ensuring real-time updates flow correctly to the web interface.
 */
export class AdminUIBridge {
  private webSocketConnections = new Set<WebSocket>();
  private sseConnections = new Map<string, { response: Response; controller: ReadableStreamDefaultController }>();
  
  constructor() {
    logger.info('🌉 Admin UI Bridge initialized');
  }

  /**
   * Register admin WebSocket connection for broadcasts
   */
  addWebSocketConnection(ws: WebSocket, connectionId: string): void {
    this.webSocketConnections.add(ws);
    logger.info(`📱 Admin WebSocket connected: ${connectionId}`);
    
    // Send initial status
    this.sendInitialStatus(ws);
    
    // Clean up on close
    ws.addEventListener('close', () => {
      this.webSocketConnections.delete(ws);
      logger.info(`📱 Admin WebSocket disconnected: ${connectionId}`);
    });
  }

  /**
   * Register admin SSE connection for broadcasts
   */
  addSSEConnection(connectionId: string, response: Response, controller: ReadableStreamDefaultController): void {
    this.sseConnections.set(connectionId, { response, controller });
    logger.info(`📡 Admin SSE connected: ${connectionId}`);
    
    // Send initial status
    this.sendSSEInitialStatus(controller);
  }

  /**
   * Remove SSE connection
   */
  removeSSEConnection(connectionId: string): void {
    this.sseConnections.delete(connectionId);
    logger.info(`📡 Admin SSE disconnected: ${connectionId}`);
  }

  /**
   * Handle crawler connection events
   */
  onCrawlerConnected(connection: SocketConnection): void {
    logger.info(`🤖 Crawler connected: ${connection.id}`);
    
    this.broadcastToAdmin({
      type: 'connection',
      payload: {
        component: 'messageBus',
        status: 'connected',
        connectionId: connection.id,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Handle crawler disconnection events
   */
  onCrawlerDisconnected(connectionId: string, reason?: string): void {
    logger.info(`🤖 Crawler disconnected: ${connectionId}, reason: ${reason}`);
    
    this.broadcastToAdmin({
      type: 'connection',
      payload: {
        component: 'messageBus',
        status: 'disconnected',
        connectionId,
        reason,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Handle heartbeat messages from crawler
   */
  onCrawlerHeartbeat(connection: SocketConnection, heartbeatData: any): void {
    logger.debug(`💓 Crawler heartbeat from ${connection.id}`);
    
    this.broadcastToAdmin({
      type: 'heartbeat',
      payload: {
        connectionId: connection.id,
        timestamp: new Date().toISOString(),
        ...heartbeatData
      }
    });
    
    // Also send connection status update
    this.broadcastToAdmin({
      type: 'connection',
      payload: {
        component: 'messageBus',
        status: 'connected',
        connectionId: connection.id,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Handle job started events
   */
  onJobStarted(connection: SocketConnection, jobId: string, jobData: any): void {
    logger.info(`🚀 Job started: ${jobId} on ${connection.id}`);
    
    this.broadcastToAdmin({
      type: 'jobUpdate',
      payload: {
        action: 'started',
        jobId,
        connectionId: connection.id,
        timestamp: new Date().toISOString(),
        ...jobData
      }
    });
  }

  /**
   * Handle job progress events
   */
  onJobProgress(connection: SocketConnection, jobId: string, progressData: ProgressData): void {
    logger.debug(`📊 Job progress: ${jobId} - ${progressData.total_processed}/${progressData.total_discovered || '?'}`);
    
    this.broadcastToAdmin({
      type: 'jobUpdate',
      payload: {
        action: 'progress',
        jobId,
        connectionId: connection.id,
        timestamp: new Date().toISOString(),
        progress: {
          ...progressData,
          // Include enhanced progress data for UI
          itemCounts: progressData.item_counts || {},
          processingRate: progressData.processing_rate,
          estimatedTimeRemaining: progressData.estimated_time_remaining
        }
      }
    });
  }

  /**
   * Handle job completion events
   */
  onJobCompleted(connection: SocketConnection, jobId: string, completionData: CompletionData): void {
    logger.info(`🎉 Job completed: ${jobId} on ${connection.id}`);
    
    this.broadcastToAdmin({
      type: 'jobUpdate',
      payload: {
        action: 'completed',
        jobId,
        connectionId: connection.id,
        timestamp: new Date().toISOString(),
        result: completionData
      }
    });
  }

  /**
   * Handle job failure events
   */
  onJobFailed(connection: SocketConnection, jobId: string, failureData: FailureData): void {
    logger.error(`💥 Job failed: ${jobId} on ${connection.id} - ${failureData.error}`);
    
    // Send job failure log
    this.broadcastToAdmin({
      type: 'jobFailure',
      payload: {
        jobId,
        taskType: failureData.errorType || 'unknown',
        error: failureData.error,
        timestamp: new Date().toISOString(),
        connectionId: connection.id,
        isRecoverable: failureData.isRecoverable,
        // Correctly map stackTrace field from FailureData
        stackTrace: failureData.stackTrace || null,
        // Properly structure the context object with all available error details
        context: {
          errorType: failureData.errorType,
          isRecoverable: failureData.isRecoverable,
          partialCounts: failureData.partialCounts,
          resumeState: failureData.resumeState,
          retryCount: failureData.retryCount,
          requestDetails: failureData.requestDetails,
          // Include raw error for debugging
          rawError: failureData.error
        }
      }
    });

    // Also send general job update
    this.broadcastToAdmin({
      type: 'jobUpdate',
      payload: {
        action: 'failed',
        jobId,
        connectionId: connection.id,
        timestamp: new Date().toISOString(),
        error: failureData
      }
    });
  }

  /**
   * Send periodic status updates with job queue statistics
   */
  async sendStatusUpdate(): Promise<void> {
    try {
      const jobStats = await jobService.getJobQueueStats();
      const runningCount = await jobService.getRunningJobsCount();
      
      const statusData = {
        queued: jobStats.queued,
        running: jobStats.running,
        processing: runningCount,
        completed: jobStats.completed,
        failed: jobStats.failed,
        state: runningCount > 0 ? 'running' : jobStats.queued > 0 ? 'queued' : 'idle',
        lastUpdate: new Date().toISOString()
      };
      
      this.broadcastToAdmin({
        type: 'statusUpdate',
        payload: statusData
      });
      
      logger.debug('📊 Status update sent:', statusData);
    } catch (error) {
      logger.error('❌ Error sending status update:', { error });
    }
  }

  /**
   * Send initial status to new connections
   */
  private async sendInitialStatus(ws: WebSocket): Promise<void> {
    try {
      const jobStats = await jobService.getJobQueueStats();
      const runningCount = await jobService.getRunningJobsCount();
      
      const initialStatus = {
        type: 'client_status',
        payload: {
          messageBusConnected: true, // We're connected if we can send this
          cachedStatus: {
            queued: jobStats.queued,
            running: jobStats.running,
            processing: runningCount,
            completed: jobStats.completed,
            failed: jobStats.failed,
            state: runningCount > 0 ? 'running' : 'idle'
          },
          lastHeartbeat: new Date().toISOString(),
          jobFailureLogs: []
        }
      };
      
      ws.send(JSON.stringify(initialStatus));
    } catch (error) {
      logger.error('❌ Error sending initial WebSocket status:', { error });
    }
  }

  /**
   * Send initial status via SSE
   */
  private async sendSSEInitialStatus(controller: ReadableStreamDefaultController): Promise<void> {
    try {
      const jobStats = await jobService.getJobQueueStats();
      const runningCount = await jobService.getRunningJobsCount();
      
      const initialStatus = {
        messageBusConnected: true,
        timestamp: new Date().toISOString(),
        message: 'Socket server connected',
        cachedStatus: {
          queued: jobStats.queued,
          running: jobStats.running,
          processing: runningCount,
          completed: jobStats.completed,
          failed: jobStats.failed,
          state: runningCount > 0 ? 'running' : 'idle'
        },
        lastHeartbeat: new Date().toISOString(),
        lastStatusUpdate: new Date().toISOString(),
        isHealthy: true,
        jobFailureLogs: []
      };
      
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(initialStatus)}\n\n`));
    } catch (error) {
      logger.error('❌ Error sending initial SSE status:', { error });
    }
  }

  /**
   * Broadcast message to all admin connections
   */
  private broadcastToAdmin(message: any): void {
    const messageStr = JSON.stringify(message);
    
    // Broadcast to WebSocket connections
    for (const ws of this.webSocketConnections) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(messageStr);
        } catch (error) {
          logger.error('❌ Error sending WebSocket message:', { error });
          this.webSocketConnections.delete(ws);
        }
      }
    }
    
    // Broadcast to SSE connections
    const encoder = new TextEncoder();
    for (const [connectionId, { controller }] of this.sseConnections) {
      try {
        controller.enqueue(encoder.encode(`data: ${messageStr}\n\n`));
      } catch (error) {
        logger.error(`❌ Error sending SSE message to ${connectionId}:`, { error });
        this.removeSSEConnection(connectionId);
      }
    }
  }

  /**
   * Start periodic status updates
   */
  startStatusUpdates(intervalMs: number = 10000): void {
    setInterval(() => {
      this.sendStatusUpdate();
    }, intervalMs);
    
    logger.info(`📊 Status updates started (every ${intervalMs}ms)`);
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): { webSockets: number; sseConnections: number } {
    return {
      webSockets: this.webSocketConnections.size,
      sseConnections: this.sseConnections.size
    };
  }
}

// Export singleton instance
export const adminUIBridge = new AdminUIBridge();
