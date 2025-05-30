import { json, type RequestHandler } from "@sveltejs/kit";
import { getLogger } from "$lib/logging";
import { isAdmin } from "$lib/server/utils";
import messageBusClient from "$lib/messaging/MessageBusClient";

const logger = getLogger(["backend", "api", "admin", "crawler", "status"]);

/**
 * GET /api/admin/crawler/status - Server-Sent Events endpoint for real-time crawler updates
 */
export const GET: RequestHandler = async ({ request, locals }) => {
  // Check admin access
  const adminCheck = await isAdmin(locals);
  if (!adminCheck) {
    logger.warn("Unauthorized attempt to access crawler status stream");
    return json({ error: "Admin access required" }, { status: 401 });
  }

  // Check if this is an SSE request
  const accept = request.headers.get("accept");
  if (accept?.includes("text/event-stream")) {
    logger.info("Starting SSE stream for crawler status");

    // Create SSE stream
    const stream = new ReadableStream({
      start(controller) {
        // Send initial connection message
        const data = JSON.stringify({ 
          type: "connection", 
          payload: { status: "connected", timestamp: new Date().toISOString() }
        });
        controller.enqueue(`data: ${data}\n\n`);

        // Send current MessageBusClient status
        const clientStatus = {
          type: "client_status",
          payload: {
            connected: !!messageBusClient,
            timestamp: new Date().toISOString()
          }
        };
        controller.enqueue(`data: ${JSON.stringify(clientStatus)}\n\n`);

        if (messageBusClient) {
          logger.info("MessageBusClient available, setting up event listeners");

          // Listen for status updates
          const onStatusUpdate = (status: any) => {
            logger.debug("Broadcasting status update via SSE", { status });
            const data = JSON.stringify({
              type: "statusUpdate",
              payload: status,
              timestamp: new Date().toISOString()
            });
            try {
              controller.enqueue(`data: ${data}\n\n`);
            } catch (error) {
              logger.error("Error sending SSE status update:", { error });
            }
          };

          // Listen for job updates
          const onJobUpdate = (update: any) => {
            logger.debug("Broadcasting job update via SSE", { update });
            const data = JSON.stringify({
              type: "jobUpdate",
              payload: update,
              timestamp: new Date().toISOString()
            });
            try {
              controller.enqueue(`data: ${data}\n\n`);
            } catch (error) {
              logger.error("Error sending SSE job update:", { error });
            }
          };

          // Listen for heartbeat events
          const onHeartbeat = (payload: any) => {
            logger.debug("Broadcasting heartbeat via SSE", { payload });
            const data = JSON.stringify({
              type: "heartbeat",
              payload,
              timestamp: new Date().toISOString()
            });
            try {
              controller.enqueue(`data: ${data}\n\n`);
            } catch (error) {
              logger.error("Error sending SSE heartbeat:", { error });
            }
          };

          // Listen for connection events
          const onConnected = () => {
            logger.info("MessageBusClient connected - notifying SSE clients");
            const data = JSON.stringify({
              type: "connection",
              payload: { status: "connected", timestamp: new Date().toISOString() }
            });
            try {
              controller.enqueue(`data: ${data}\n\n`);
            } catch (error) {
              logger.error("Error sending SSE connection event:", { error });
            }
          };

          const onDisconnected = () => {
            logger.warn("MessageBusClient disconnected - notifying SSE clients");
            const data = JSON.stringify({
              type: "connection",
              payload: { status: "disconnected", timestamp: new Date().toISOString() }
            });
            try {
              controller.enqueue(`data: ${data}\n\n`);
            } catch (error) {
              logger.error("Error sending SSE disconnection event:", { error });
            }
          };

          // Attach event listeners
          messageBusClient.onStatusUpdate(onStatusUpdate);
          messageBusClient.onJobUpdate(onJobUpdate);
          messageBusClient.onHeartbeat(onHeartbeat);
          messageBusClient.on("connected", onConnected);
          messageBusClient.on("disconnected", onDisconnected);

          // Clean up when client disconnects
          request.signal?.addEventListener('abort', () => {
            logger.info("SSE client disconnected, cleaning up listeners");
            if (messageBusClient) {
              messageBusClient.off("statusUpdate", onStatusUpdate);
              messageBusClient.off("jobUpdate", onJobUpdate);
              messageBusClient.off("heartbeat", onHeartbeat);
              messageBusClient.off("connected", onConnected);
              messageBusClient.off("disconnected", onDisconnected);
            }
          });

        } else {
          logger.warn("MessageBusClient not available for SSE stream");
          const data = JSON.stringify({
            type: "error",
            payload: { message: "MessageBusClient not available", timestamp: new Date().toISOString() }
          });
          controller.enqueue(`data: ${data}\n\n`);
        }
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Cache-Control"
      }
    });
  }

  // Fallback: return current status as JSON
  logger.info("Returning current crawler status as JSON");
  
  const status = {
    connected: !!messageBusClient,
    timestamp: new Date().toISOString(),
    message: messageBusClient ? "MessageBusClient available" : "MessageBusClient not available"
  };

  return json(status);
};