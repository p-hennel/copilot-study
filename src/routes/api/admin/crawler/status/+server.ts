import { json, type RequestHandler } from "@sveltejs/kit";
import { getLogger } from "$lib/logging";
import { isAdmin } from "$lib/server/utils";
import { adminUIBridge } from "$lib/server/socket/services/admin-ui-bridge";
import { jobService } from "$lib/server/socket/services/job-service.js";
import { getDefaultSocketServer } from "$lib/server/socket/index.js";

const logger = getLogger(["backend", "api", "admin", "crawler", "status"]);

/**
 * GET /api/admin/crawler/status - Real-time crawler status with socket server integration
 */
export const GET: RequestHandler = async ({ locals, request }) => {
  // Check admin access
  const adminCheck = await isAdmin(locals);
  if (!adminCheck) {
    logger.warn("Unauthorized attempt to access crawler status stream");
    return json({ error: "Admin access required" }, { status: 401 });
  }

  // Check if this is an SSE request by looking at the Accept header
  const acceptHeader = request.headers.get('accept') || '';
  const isSSERequest = acceptHeader.includes('text/event-stream');
  
  // Log for debugging
  logger.info("Crawler status request", { 
    acceptHeader, 
    isSSERequest,
    userAgent: request.headers.get('user-agent')
  });

  if (isSSERequest) {
    // Handle Server-Sent Events for real-time updates
    logger.info("Starting SSE connection for crawler status");
    
    const connectionId = `sse-${Date.now()}-${Math.random().toString(36).substring(2)}`;
    
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Register SSE connection with admin UI bridge
          adminUIBridge.addSSEConnection(connectionId, new Response(), controller);
          
          // Get current status data
          const socketServer = await getDefaultSocketServer();
          const serverStatus = socketServer.getStatus();
          const connectionStats = socketServer.getConnectionStats();
          const jobStats = await jobService.getJobQueueStats();
          const runningCount = await jobService.getRunningJobsCount();
          
          // Send initial connection confirmation with full status
          const encoder = new TextEncoder();
          const initialMessage = {
            type: 'client_status',
            payload: {
              messageBusConnected: connectionStats.active > 0,
              timestamp: new Date().toISOString(),
              message: connectionStats.active > 0 ? 'Crawler connected' : 'No crawler connections',
              cachedStatus: {
                state: runningCount > 0 ? 'running' : jobStats.queued > 0 ? 'queued' : 'idle',
                queued: jobStats.queued,
                running: jobStats.running,
                processing: runningCount,
                completed: jobStats.completed,
                failed: jobStats.failed
              },
              lastHeartbeat: new Date().toISOString(),
              lastStatusUpdate: new Date().toISOString(),
              isHealthy: serverStatus.isRunning && connectionStats.active > 0,
              jobFailureLogs: []
            }
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(initialMessage)}\n\n`));
          
          logger.info(`SSE connection established: ${connectionId}`);
        } catch (error) {
          logger.error(`Error starting SSE connection: ${connectionId}`, { error });
        }
      },
      cancel() {
        // Clean up SSE connection
        adminUIBridge.removeSSEConnection(connectionId);
        logger.info(`SSE connection closed: ${connectionId}`);
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  } else {
    // Handle regular JSON request
    logger.info("Returning current crawler status as JSON");
    
    try {
      // Get socket server status
      const socketServer = await getDefaultSocketServer();
      const serverStatus = socketServer.getStatus();
      const connectionStats = socketServer.getConnectionStats();
      
      // Get job statistics
      const jobStats = await jobService.getJobQueueStats();
      const runningCount = await jobService.getRunningJobsCount();
      
      // Get admin UI bridge stats
      const bridgeStats = adminUIBridge.getConnectionStats();
      
      const status = {
        // Socket server status
        socketServerRunning: serverStatus.isRunning,
        crawlerConnections: connectionStats.active,
        totalConnections: connectionStats.total,
        
        // Admin UI connections
        adminConnections: {
          webSockets: bridgeStats.webSockets,
          sseConnections: bridgeStats.sseConnections
        },
        
        // Job statistics
        jobs: {
          queued: jobStats.queued,
          running: jobStats.running,
          processing: runningCount,
          completed: jobStats.completed,
          failed: jobStats.failed
        },
        
        // System status
        messageBusConnected: connectionStats.active > 0,
        systemStatus: runningCount > 0 ? 'processing' : jobStats.queued > 0 ? 'queued' : 'idle',
        timestamp: new Date().toISOString(),
        message: connectionStats.active > 0 ? 'Crawler connected' : 'No crawler connections',
        
        // Health indicators
        lastHeartbeat: new Date().toISOString(), // Real heartbeat would come from socket events
        lastStatusUpdate: new Date().toISOString(),
        isHealthy: serverStatus.isRunning && connectionStats.active > 0,
        
        // For backward compatibility
        cachedStatus: {
          state: runningCount > 0 ? 'running' : jobStats.queued > 0 ? 'queued' : 'idle',
          queued: jobStats.queued,
          running: jobStats.running,
          processing: runningCount,
          completed: jobStats.completed,
          failed: jobStats.failed
        },
        jobFailureLogs: [] // Real logs would come from admin UI bridge
      };

      return json(status);
      
    } catch (error) {
      logger.error("Error fetching crawler status:", { error });
      return json(
        { 
          error: "Failed to fetch crawler status",
          messageBusConnected: false,
          isHealthy: false,
          timestamp: new Date().toISOString()
        }, 
        { status: 500 }
      );
    }
  }
};