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

          // Listen for job failure logs
          const onJobFailure = (failureData: any) => {
            logger.info("DEBUG: Received job failure data from MessageBusClient", { failureData });
            console.log("DEBUG SSE: Broadcasting job failure logs via SSE", failureData);
            const data = JSON.stringify({
              type: "jobFailure",
              payload: failureData,
              timestamp: new Date().toISOString()
            });
            console.log("DEBUG SSE: Sending failure data:", data);
            try {
              controller.enqueue(`data: ${data}\n\n`);
              console.log("DEBUG SSE: Successfully enqueued failure data");
            } catch (error) {
              logger.error("Error sending SSE job failure:", { error });
              console.error("DEBUG SSE: Error sending job failure:", error);
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

          // Listen for token refresh requests and handle them
          const onTokenRefreshRequest = async (requestData: any) => {
            console.log("🔄 DEBUG SSE: *** TOKEN REFRESH REQUEST RECEIVED ***");
            console.log("🔄 DEBUG SSE: Request data:", JSON.stringify(requestData, null, 2));
            logger.info("Received token refresh request via SSE MessageBusClient", { requestData });
            
            if (!messageBusClient) {
              console.error('❌ DEBUG SSE: MessageBusClient became null during token refresh processing');
              return;
            }
            
            try {
              const { requestId, providerId, accountId, userId } = requestData;
              console.log("🔄 DEBUG SSE: Extracted request parameters:", { requestId, providerId, accountId, userId });
              
              // Call our internal token refresh API with session cookies
              console.log("🔄 DEBUG SSE: Making fetch request to localhost:3000/api/internal/refresh-token");
              
              // Get session cookie from the current request context
              const sessionCookie = request.headers.get('cookie');
              console.log("🔄 DEBUG SSE: Session cookie available:", !!sessionCookie);
              
              const response = await fetch('http://localhost:3000/api/internal/refresh-token', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Cookie': sessionCookie || ''
                },
                body: JSON.stringify({
                  providerId,
                  accountId,
                  userId
                })
              });
              
              console.log("🔄 DEBUG SSE: Fetch response status:", response.status, response.statusText);
              
              if (response.ok) {
                const tokenData = await response.json() as {
                  success?: boolean;
                  accessToken?: string;
                  expiresAt?: string;
                  refreshToken?: string;
                  providerId?: string;
                };
                console.log('✅ DEBUG SSE: Token refresh successful, token data:', tokenData);
                console.log('✅ DEBUG SSE: Sending response to crawler with requestId:', requestId);
                
                // Send successful response back to crawler
                if (messageBusClient) {
                  messageBusClient.sendTokenRefreshResponse(requestId, {
                    success: true,
                    accessToken: tokenData.accessToken,
                    expiresAt: tokenData.expiresAt,
                    refreshToken: tokenData.refreshToken,
                    providerId: tokenData.providerId
                  });
                  console.log('✅ DEBUG SSE: Response sent to crawler successfully');
                } else {
                  console.error('❌ DEBUG SSE: MessageBusClient became null when sending response');
                }
              } else {
                console.log("❌ DEBUG SSE: Fetch response not OK, reading error data...");
                const errorData = await response.json() as {
                  error?: string;
                };
                console.error('❌ DEBUG SSE: Token refresh failed with error data:', errorData);
                
                // Send error response back to crawler
                if (messageBusClient) {
                  console.log('❌ DEBUG SSE: Sending error response to crawler');
                  messageBusClient.sendTokenRefreshResponse(requestId, {
                    success: false,
                    error: errorData.error || 'Token refresh failed'
                  });
                  console.log('❌ DEBUG SSE: Error response sent to crawler');
                }
              }
            } catch (error) {
              console.error('❌ DEBUG SSE: Exception in token refresh processing:', error);
              logger.error("Token refresh processing error:", { error });
              
              // Send error response back to crawler
              if (messageBusClient) {
                console.log('❌ DEBUG SSE: Sending exception error response to crawler');
                messageBusClient.sendTokenRefreshResponse(requestData.requestId, {
                  success: false,
                  error: error instanceof Error ? error.message : 'Unknown error during token refresh'
                });
                console.log('❌ DEBUG SSE: Exception error response sent to crawler');
              }
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
          messageBusClient.onJobFailure(onJobFailure);
          messageBusClient.onHeartbeat(onHeartbeat);
          messageBusClient.onTokenRefreshRequest(onTokenRefreshRequest);
          messageBusClient.on("connected", onConnected);
          messageBusClient.on("disconnected", onDisconnected);

          console.log("🔧 DEBUG SSE: Token refresh handler attached to MessageBusClient");

          // Clean up when client disconnects
          request.signal?.addEventListener('abort', () => {
            logger.info("SSE client disconnected, cleaning up listeners");
            if (messageBusClient) {
              messageBusClient.off("statusUpdate", onStatusUpdate);
              messageBusClient.off("jobUpdate", onJobUpdate);
              messageBusClient.off("jobFailure", onJobFailure);
              messageBusClient.off("heartbeat", onHeartbeat);
              messageBusClient.off("tokenRefreshRequest", onTokenRefreshRequest);
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