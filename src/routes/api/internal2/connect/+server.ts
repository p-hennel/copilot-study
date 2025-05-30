import { json, type RequestHandler } from "@sveltejs/kit";
import { getLogger } from "$lib/logging";
import AppSettings from "$lib/server/settings";
import { isAdmin } from "$lib/server/utils";

const logger = getLogger(["backend", "api", "internal2", "connect"]);

// WebSocket connection tracking
const connections = new Map<string, WebSocket>();

interface WebSocketConnectionRequest {
  connectionId?: string;
  clientType: "gitlab-crawler" | "web-client";
  version?: string;
}


/**
 * Authenticate WebSocket connection via query parameters or headers
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
 * Handle WebSocket upgrade request
 */
export const GET: RequestHandler = async ({ request, url, locals }) => {
  // Check if this is a WebSocket upgrade request
  const upgradeHeader = request.headers.get("upgrade");
  const connectionHeader = request.headers.get("connection");

  if (upgradeHeader?.toLowerCase() !== "websocket" || 
      !connectionHeader?.toLowerCase().includes("upgrade")) {
    logger.warn("Invalid WebSocket upgrade request received");
    return json({ error: "WebSocket upgrade required" }, { status: 400 });
  }

  // Authenticate the connection
  const authResult = await authenticateWebSocketConnection(url, request.headers, locals);
  
  if (!authResult.isAuthenticated) {
    logger.warn("WebSocket authentication failed", { error: authResult.error });
    return json({ error: authResult.error }, { status: 401 });
  }

  const connectionId = authResult.connectionId!;
  
  logger.info(`WebSocket upgrade request authenticated for connection ${connectionId}`);

  try {
    // In a real implementation, you would handle the WebSocket upgrade here
    // This is a placeholder since SvelteKit doesn't directly support WebSocket upgrades
    // You would typically use a separate WebSocket server or library
    
    logger.info(`WebSocket connection established for ${connectionId}`);
    
    return json({
      status: "connection_ready",
      connectionId,
      message: "WebSocket connection established",
      serverCapabilities: {
        messageQueuing: true,
        heartbeat: true,
        reconnection: true,
        protocolVersion: "1.0"
      }
    }, { status: 200 });

  } catch (error) {
    logger.error(`Error establishing WebSocket connection for ${connectionId}:`, { error });
    return json({ error: "Failed to establish WebSocket connection" }, { status: 500 });
  }
};

/**
 * Handle WebSocket connection info requests
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  const currentCrawlerApiToken = AppSettings().app?.CRAWLER_API_TOKEN;
  
  // Authentication check
  const adminCheck = await isAdmin(locals);
  if (!locals.isSocketRequest && !adminCheck) {
    if (!currentCrawlerApiToken) {
      logger.error("WebSocket connect endpoint: CRAWLER_API_TOKEN setting not set");
      return json({ error: "Endpoint disabled due to missing configuration" }, { status: 503 });
    }

    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      logger.warn("WebSocket connect: Missing or malformed Authorization header");
      return json({ error: "Invalid or missing authentication" }, { status: 401 });
    }

    const token = authHeader.substring("Bearer ".length);
    if (token !== currentCrawlerApiToken) {
      logger.warn("WebSocket connect: Invalid token provided");
      return json({ error: "Invalid authentication token" }, { status: 401 });
    }
  }

  let payload: WebSocketConnectionRequest;
  try {
    payload = await request.json() as WebSocketConnectionRequest;
  } catch (error) {
    logger.error("Error parsing WebSocket connection request:", { error });
    return json({ error: "Invalid request body" }, { status: 400 });
  }

  const { connectionId, clientType, version } = payload;

  logger.info("WebSocket connection info request", { 
    connectionId, 
    clientType, 
    version,
    activeConnections: connections.size
  });

  try {
    return json({
      status: "ready",
      connectionInfo: {
        connectionId: connectionId || `conn-${Date.now()}`,
        serverTime: new Date().toISOString(),
        activeConnections: connections.size,
        maxConnections: 100,
        supportedProtocols: ["gitlab-crawler-v1"],
        heartbeatInterval: 30000
      },
      endpoints: {
        websocket: "/api/internal2/connect",
        tasks: "/api/internal2/tasks",
        health: "/api/internal2/health"
      }
    }, { status: 200 });

  } catch (error) {
    logger.error("Error processing WebSocket connection info:", { error });
    return json({ error: "Internal server error" }, { status: 500 });
  }
};