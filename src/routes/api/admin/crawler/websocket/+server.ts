import { json, type RequestHandler } from "@sveltejs/kit";
import { getLogger } from "$lib/logging";
import { isAdmin } from "$lib/server/utils";
import { error } from "@sveltejs/kit";
import messageBusClient from "$lib/messaging/MessageBusClient";

const logger = getLogger(["backend", "api", "admin", "crawler", "websocket"]);

// Crawler WebSocket connections
const crawlerConnections = new Set<WebSocket>();
const connectionMetadata = new Map<WebSocket, { connectionId: string; userId?: string }>();

/**
 * Authenticate WebSocket connection for admin access
 */
async function authenticateWebSocketConnection(
  url: URL,
  headers: Headers,
  locals: any
): Promise<{ isAuthenticated: boolean; connectionId?: string; error?: string }> {
  // Check admin access
  const adminCheck = await isAdmin(locals);
  if (adminCheck) {
    return {
      isAuthenticated: true,
      connectionId: url.searchParams.get("connectionId") || `admin-${Date.now()}`
    };
  }

  return {
    isAuthenticated: false,
    error: "Admin access required for crawler WebSocket connection"
  };
}

/**
 * Remove connection from crawler tracking
 */
function removeCrawlerConnection(ws: WebSocket) {
  const metadata = connectionMetadata.get(ws);
  if (metadata) {
    const { connectionId } = metadata;
    
    crawlerConnections.delete(ws);
    connectionMetadata.delete(ws);
    
    logger.info(`Removed crawler WebSocket connection ${connectionId}`);
  }
}

/**
 * Broadcast message to all crawler WebSocket connections
 */
function broadcastToCrawlerClients(message: any) {
  if (crawlerConnections.size === 0) {
    logger.debug("No crawler WebSocket connections to broadcast to");
    return;
  }

  const messageStr = JSON.stringify(message);
  let broadcastCount = 0;

  crawlerConnections.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(messageStr);
        broadcastCount++;
      } catch (error) {
        logger.error("Error broadcasting to crawler WebSocket connection:", { error });
        removeCrawlerConnection(ws);
      }
    } else {
      removeCrawlerConnection(ws);
    }
  });

  logger.debug(`Broadcasted message to ${broadcastCount} crawler WebSocket connections`);
}

// Set up MessageBusClient event listeners for crawler events
console.log("WebSocket server checking MessageBusClient:", {
  messageBusClientExists: !!messageBusClient,
  messageBusClientType: typeof messageBusClient
});

if (messageBusClient) {
  console.log("MessageBusClient is available, setting up event listeners");
  
  // Listen for crawler status updates
  messageBusClient.onStatusUpdate((status) => {
    logger.debug("Received crawler status update via MessageBus", { status });
    console.log("Broadcasting status update to WebSocket clients:", status);
    broadcastToCrawlerClients({
      type: "statusUpdate",
      payload: status,
      timestamp: new Date().toISOString()
    });
  });

  // Listen for job updates
  messageBusClient.onJobUpdate((update) => {
    logger.debug("Received crawler job update via MessageBus", { update });
    console.log("Broadcasting job update to WebSocket clients:", update);
    broadcastToCrawlerClients({
      type: "jobUpdate",
      payload: update,
      timestamp: new Date().toISOString()
    });
  });

  // Listen for heartbeat events
  messageBusClient.onHeartbeat((payload) => {
    logger.debug("Received crawler heartbeat via MessageBus", { payload });
    console.log("Broadcasting heartbeat to WebSocket clients:", payload);
    broadcastToCrawlerClients({
      type: "heartbeat",
      payload,
      timestamp: new Date().toISOString()
    });
  });

  logger.info("Crawler WebSocket server initialized with MessageBus event listeners");
  console.log("WebSocket server: MessageBus event listeners configured");
} else {
  logger.warn("MessageBusClient not available - crawler WebSocket will not receive real-time updates");
  console.warn("WebSocket server: MessageBusClient is NULL - no real-time updates will be available");
}

/**
 * GET /api/admin/crawler/websocket - WebSocket upgrade for crawler monitoring
 */
export const GET: RequestHandler = async ({ request, url, locals }) => {
  // Check if this is a WebSocket upgrade request
  const upgradeHeader = request.headers.get("upgrade");
  const connectionHeader = request.headers.get("connection");

  if (upgradeHeader?.toLowerCase() !== "websocket" || 
      !connectionHeader?.toLowerCase().includes("upgrade")) {
    logger.warn("Invalid WebSocket upgrade request for crawler monitoring");
    return json({ error: "WebSocket upgrade required" }, { status: 400 });
  }

  // Authenticate the connection
  const authResult = await authenticateWebSocketConnection(url, request.headers, locals);
  
  if (!authResult.isAuthenticated) {
    logger.warn("Crawler WebSocket authentication failed", { error: authResult.error });
    return json({ error: authResult.error }, { status: 401 });
  }

  const connectionId = authResult.connectionId!;

  logger.info("Crawler WebSocket upgrade request authenticated", { connectionId });

  try {
    // In a real implementation, you would handle the WebSocket upgrade here
    // This is a placeholder response since SvelteKit doesn't directly support WebSocket upgrades
    
    logger.info("Crawler WebSocket connection established", { connectionId });
    
    return json({
      status: "connection_ready",
      connectionId,
      message: "Crawler WebSocket connection established",
      capabilities: {
        statusUpdates: true,
        jobUpdates: true,
        heartbeat: true,
        realTimeMessages: true
      }
    }, { status: 200 });

  } catch (err) {
    logger.error("Error establishing crawler WebSocket connection:", { error: err });
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    return json({ error: "Failed to establish WebSocket connection" }, { status: 500 });
  }
};

/**
 * POST /api/admin/crawler/websocket - Send message to crawler WebSocket connections
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  const adminCheck = await isAdmin(locals);
  
  if (!adminCheck) {
    logger.warn("Unauthorized attempt to send crawler WebSocket message");
    return json({ error: "Admin access required" }, { status: 401 });
  }

  let messagePayload: any;
  try {
    messagePayload = await request.json();
  } catch (error) {
    logger.error("Error parsing crawler WebSocket message:", { error });
    return json({ error: "Invalid request body" }, { status: 400 });
  }

  logger.info("Sending WebSocket message to crawler connections", { 
    messageType: messagePayload.type,
    connectionCount: crawlerConnections.size
  });

  try {
    // Add metadata to message
    const messageWithMetadata = {
      ...messagePayload,
      timestamp: new Date().toISOString(),
      serverGenerated: true
    };

    // Broadcast to all crawler connections
    broadcastToCrawlerClients(messageWithMetadata);

    const connectionCount = crawlerConnections.size;

    return json({
      status: "message_sent",
      message: `Message broadcasted to ${connectionCount} crawler connections`,
      connectionCount,
      timestamp: new Date().toISOString()
    }, { status: 200 });

  } catch (err) {
    logger.error("Error sending crawler WebSocket message:", { error: err });
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    return json({ error: "Internal server error" }, { status: 500 });
  }
};

// Export the broadcast function for use by other modules
export { broadcastToCrawlerClients };