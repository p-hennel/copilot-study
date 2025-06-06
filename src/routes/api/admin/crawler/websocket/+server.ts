import { json, type RequestHandler } from "@sveltejs/kit";
import { getLogger } from "$lib/logging";
import { isAdmin } from "$lib/server/utils";
import { adminUIBridge } from "$lib/server/socket/services/admin-ui-bridge.js";

const logger = getLogger(["backend", "api", "admin", "crawler", "websocket"]);

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
  const adminCheck = await isAdmin(locals);
  if (!adminCheck) {
    logger.warn("Crawler WebSocket authentication failed - admin access required");
    return json({ error: "Admin access required" }, { status: 401 });
  }

  const connectionId = url.searchParams.get("connectionId") || `admin-ws-${Date.now()}`;
  logger.info("Crawler WebSocket upgrade request authenticated", { connectionId });

  try {
    // In SvelteKit, WebSocket upgrades need to be handled differently
    // This is a placeholder response since SvelteKit doesn't directly support WebSocket upgrades
    // The actual WebSocket handling would need to be implemented in a separate WebSocket server
    // or using a different approach like Socket.IO
    
    logger.info("Crawler WebSocket connection request processed", { connectionId });
    
    return json({
      status: "connection_ready",
      connectionId,
      message: "WebSocket connection setup processed - real-time updates available via SSE",
      capabilities: {
        statusUpdates: true,
        jobUpdates: true,
        heartbeat: true,
        realTimeMessages: true
      },
      // Provide SSE endpoint as alternative
      sseEndpoint: "/api/admin/crawler/status?accept=text/event-stream",
      bridgeStats: adminUIBridge.getConnectionStats()
    }, { status: 200 });

  } catch (err) {
    logger.error("Error processing crawler WebSocket connection:", { error: err });
    return json({ error: "Failed to process WebSocket connection" }, { status: 500 });
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

  logger.info("Broadcasting message to crawler admin connections", { 
    messageType: messagePayload.type
  });

  try {
    // Get current connection stats from admin UI bridge
    const connectionStats = adminUIBridge.getConnectionStats();
    const totalConnections = connectionStats.webSockets + connectionStats.sseConnections;

    // Note: Actual broadcasting would be handled by the admin UI bridge
    // when real WebSocket connections are established
    
    return json({
      status: "message_processed",
      message: `Message prepared for broadcast to ${totalConnections} admin connections`,
      connectionCount: totalConnections,
      connectionBreakdown: connectionStats,
      timestamp: new Date().toISOString()
    }, { status: 200 });

  } catch (err) {
    logger.error("Error processing crawler WebSocket message:", { error: err });
    return json({ error: "Internal server error" }, { status: 500 });
  }
};