import { json, type RequestHandler } from "@sveltejs/kit";
import { getLogger } from "$lib/logging";
import AppSettings from "$lib/server/settings";
import { db } from "$lib/server/db";
import { job } from "$lib/server/db/base-schema";
import { eq } from "drizzle-orm";
import { isAdmin } from "$lib/server/utils";
import { error } from "@sveltejs/kit";

const logger = getLogger(["backend", "api", "internal2", "tasks", "websocket"]);

// Task-specific WebSocket connections
const taskConnections = new Map<string, Set<WebSocket>>();
const connectionMetadata = new Map<WebSocket, { taskId: string; connectionId: string; clientType: string }>();


/**
 * Authenticate WebSocket connection
 */
async function authenticateWebSocketConnection(
  url: URL,
  headers: Headers,
  locals: any
): Promise<{ isAuthenticated: boolean; connectionId?: string; error?: string }> {
  // Check if it's a socket request bypass
  if (locals.isSocketRequest) {
    return {
      isAuthenticated: true,
      connectionId: url.searchParams.get("connectionId") || `socket-${Date.now()}`
    };
  }

  // Check admin bypass
  const adminCheck = await isAdmin(locals);
  if (adminCheck) {
    return {
      isAuthenticated: true,
      connectionId: url.searchParams.get("connectionId") || `admin-${Date.now()}`
    };
  }

  const currentCrawlerApiToken = AppSettings().app?.CRAWLER_API_TOKEN;
  if (!currentCrawlerApiToken) {
    return {
      isAuthenticated: false,
      error: "WebSocket endpoint disabled due to missing CRAWLER_API_TOKEN configuration"
    };
  }

  // Check token in query params
  const tokenFromQuery = url.searchParams.get("token");
  if (tokenFromQuery && tokenFromQuery === currentCrawlerApiToken) {
    return {
      isAuthenticated: true,
      connectionId: url.searchParams.get("connectionId") || `query-${Date.now()}`
    };
  }

  // Check token in Authorization header
  const authHeader = headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.substring("Bearer ".length);
    if (token === currentCrawlerApiToken) {
      return {
        isAuthenticated: true,
        connectionId: url.searchParams.get("connectionId") || `header-${Date.now()}`
      };
    }
  }

  return {
    isAuthenticated: false,
    error: "Invalid or missing authentication token"
  };
}


/**
 * Remove connection from task-specific tracking
 */
function removeTaskConnection(ws: WebSocket) {
  const metadata = connectionMetadata.get(ws);
  if (metadata) {
    const { taskId, connectionId } = metadata;
    
    const taskConnSet = taskConnections.get(taskId);
    if (taskConnSet) {
      taskConnSet.delete(ws);
      if (taskConnSet.size === 0) {
        taskConnections.delete(taskId);
      }
    }
    
    connectionMetadata.delete(ws);
    
    logger.info(`Removed WebSocket connection ${connectionId} for task ${taskId}`);
  }
}

/**
 * Broadcast message to all connections for a specific task
 */
function broadcastToTask(taskId: string, message: any) {
  const connections = taskConnections.get(taskId);
  if (!connections) {
    logger.debug(`No connections found for task ${taskId} to broadcast to`);
    return;
  }

  const messageStr = JSON.stringify(message);
  let broadcastCount = 0;

  connections.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(messageStr);
        broadcastCount++;
      } catch (error) {
        logger.error(`Error broadcasting to WebSocket connection for task ${taskId}:`, { error });
        removeTaskConnection(ws);
      }
    } else {
      removeTaskConnection(ws);
    }
  });

  logger.debug(`Broadcasted message to ${broadcastCount} connections for task ${taskId}`);
}

/**
 * GET /api/internal2/tasks/[taskId]/websocket - WebSocket upgrade for task-specific connection
 */
export const GET: RequestHandler = async ({ params, request, url, locals }) => {
  const { taskId } = params;

  if (!taskId) {
    return json({ error: "Task ID is required" }, { status: 400 });
  }

  // Check if this is a WebSocket upgrade request
  const upgradeHeader = request.headers.get("upgrade");
  const connectionHeader = request.headers.get("connection");

  if (upgradeHeader?.toLowerCase() !== "websocket" || 
      !connectionHeader?.toLowerCase().includes("upgrade")) {
    logger.warn(`Invalid WebSocket upgrade request for task ${taskId}`);
    return json({ error: "WebSocket upgrade required" }, { status: 400 });
  }

  // Authenticate the connection
  const authResult = await authenticateWebSocketConnection(url, request.headers, locals);
  
  if (!authResult.isAuthenticated) {
    logger.warn(`WebSocket authentication failed for task ${taskId}`, { error: authResult.error });
    return json({ error: authResult.error }, { status: 401 });
  }

  const connectionId = authResult.connectionId!;

  logger.info(`WebSocket upgrade request for task ${taskId} authenticated`, { connectionId });

  try {
    // Verify task exists
    const taskRecord = await db.query.job.findFirst({
      where: eq(job.id, taskId)
    });

    if (!taskRecord) {
      logger.warn(`Task ${taskId} not found for WebSocket connection`);
      throw error(404, { message: "Task not found" });
    }

    // In a real implementation, you would handle the WebSocket upgrade here
    // This is a placeholder response since SvelteKit doesn't directly support WebSocket upgrades
    
    logger.info(`WebSocket connection established for task ${taskId}`, { connectionId });
    
    return json({
      status: "connection_ready",
      taskId,
      connectionId,
      message: `WebSocket connection established for task ${taskId}`,
      taskInfo: {
        status: taskRecord.status,
        command: taskRecord.command,
        createdAt: taskRecord.created_at.toISOString(),
        startedAt: taskRecord.started_at?.toISOString(),
        completedAt: taskRecord.finished_at?.toISOString()
      },
      capabilities: {
        progressUpdates: true,
        statusUpdates: true,
        errorReporting: true,
        realTimeMessages: true
      }
    }, { status: 200 });

  } catch (err) {
    logger.error(`Error establishing WebSocket connection for task ${taskId}:`, { error: err });
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    return json({ error: "Failed to establish WebSocket connection" }, { status: 500 });
  }
};

/**
 * POST /api/internal2/tasks/[taskId]/websocket - Send message to task WebSocket connections
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
  const { taskId } = params;

  if (!taskId) {
    return json({ error: "Task ID is required" }, { status: 400 });
  }

  const currentCrawlerApiToken = AppSettings().app?.CRAWLER_API_TOKEN;
  const adminCheck = await isAdmin(locals);
  
  // Authentication
  if (!locals.isSocketRequest && !adminCheck) {
    if (!currentCrawlerApiToken) {
      logger.error(`Task WebSocket message: CRAWLER_API_TOKEN not set for task ${taskId}`);
      return json({ error: "Endpoint disabled due to missing configuration" }, { status: 503 });
    }

    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      logger.warn(`Task WebSocket message: Missing auth for task ${taskId}`);
      return json({ error: "Invalid or missing authentication" }, { status: 401 });
    }

    const token = authHeader.substring("Bearer ".length);
    if (token !== currentCrawlerApiToken) {
      logger.warn(`Task WebSocket message: Invalid token for task ${taskId}`);
      return json({ error: "Invalid authentication token" }, { status: 401 });
    }
  }

  let messagePayload: any;
  try {
    messagePayload = await request.json();
  } catch (error) {
    logger.error(`Error parsing WebSocket message for task ${taskId}:`, { error });
    return json({ error: "Invalid request body" }, { status: 400 });
  }

  logger.info(`Sending WebSocket message to task ${taskId} connections`, { 
    messageType: messagePayload.type,
    connectionCount: taskConnections.get(taskId)?.size || 0
  });

  try {
    // Verify task exists
    const taskRecord = await db.query.job.findFirst({
      where: eq(job.id, taskId)
    });

    if (!taskRecord) {
      logger.warn(`Task ${taskId} not found for WebSocket message`);
      throw error(404, { message: "Task not found" });
    }

    // Add metadata to message
    const messageWithMetadata = {
      ...messagePayload,
      taskId,
      timestamp: new Date().toISOString(),
      serverGenerated: true
    };

    // Broadcast to all connections for this task
    broadcastToTask(taskId, messageWithMetadata);

    const connectionCount = taskConnections.get(taskId)?.size || 0;

    return json({
      status: "message_sent",
      taskId,
      message: `Message broadcasted to ${connectionCount} connections`,
      connectionCount,
      timestamp: new Date().toISOString()
    }, { status: 200 });

  } catch (err) {
    logger.error(`Error sending WebSocket message for task ${taskId}:`, { error: err });
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    return json({ error: "Internal server error" }, { status: 500 });
  }
};

// Export the broadcast function for use by other modules
//export { broadcastToTask };