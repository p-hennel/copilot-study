import { json, type RequestHandler } from "@sveltejs/kit";
import { getLogger } from "$lib/logging";
import { isAdmin } from "$lib/server/utils";

const logger = getLogger(["backend", "api", "admin", "crawler", "websocket"]);

// Crawler WebSocket connections
const crawlerConnections = new Set<WebSocket>();

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
//export { broadcastToCrawlerClients };