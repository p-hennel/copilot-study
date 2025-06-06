import { json, type RequestHandler } from "@sveltejs/kit";
import { getLogger } from "$lib/logging";
import { isAdmin } from "$lib/server/utils";
import {
  getCachedStatus
} from "$lib/stores/crawler-cache";

const logger = getLogger(["backend", "api", "admin", "crawler", "status"]);

/**
 * GET /api/admin/crawler/status - Server-Sent Events endpoint for real-time crawler updates
 */
export const GET: RequestHandler = async ({ locals }) => {
  // Check admin access
  const adminCheck = await isAdmin(locals);
  if (!adminCheck) {
    logger.warn("Unauthorized attempt to access crawler status stream");
    return json({ error: "Admin access required" }, { status: 401 });
  }

  // Fallback: return current status as JSON including cached data
  logger.info("Returning current crawler status as JSON");
  
  const cachedData = getCachedStatus();
  const actuallyConnected = false // ?? false;
  const status = {
    messageBusConnected: actuallyConnected,
    timestamp: new Date().toISOString(),
    message: actuallyConnected ? "MessageBusClient connected" : "MessageBusClient not connected",
    cachedStatus: cachedData.status,
    lastHeartbeat: cachedData.lastHeartbeat?.toISOString() || null,
    lastStatusUpdate: cachedData.lastStatusUpdate?.toISOString() || null,
    isHealthy: cachedData.isHealthy,
    jobFailureLogs: cachedData.jobFailureLogs
  };

  return json(status);
};