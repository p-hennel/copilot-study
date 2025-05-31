import { json, type RequestHandler } from "@sveltejs/kit";
import { getLogger } from "$lib/logging";
import { isAdmin } from "$lib/server/utils";
import messageBusClient from "$lib/messaging/MessageBusClient";
import {
  updateCrawlerStatus,
  updateMessageBusConnection,
  updateHeartbeat,
  addJobFailureLog,
  getCachedStatus
} from "$lib/stores/crawler-cache";

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

        // Send current MessageBusClient status and cached data
        const cachedData = getCachedStatus();
        const actuallyConnected = messageBusClient?.isConnected() ?? false;
        const clientStatus = {
          type: "client_status",
          payload: {
            messageBusConnected: actuallyConnected,
            timestamp: new Date().toISOString(),
            cachedStatus: cachedData.status,
            lastHeartbeat: cachedData.lastHeartbeat?.toISOString() || null,
            lastStatusUpdate: cachedData.lastStatusUpdate?.toISOString() || null,
            isHealthy: cachedData.isHealthy,
            jobFailureLogs: cachedData.jobFailureLogs
          }
        };
        controller.enqueue(`data: ${JSON.stringify(clientStatus)}\n\n`);
        
        // Update cache with actual connection status
        updateMessageBusConnection(actuallyConnected);

        // Add periodic health status broadcast
        const healthBroadcastInterval = setInterval(() => {
          const currentCachedData = getCachedStatus();
          const currentlyConnected = messageBusClient?.isConnected() ?? false;
          const healthStatus = {
            type: "health_check",
            payload: {
              messageBusConnected: currentlyConnected,
              lastHeartbeat: currentCachedData.lastHeartbeat?.toISOString() || null,
              isHealthy: currentCachedData.isHealthy,
              timestamp: new Date().toISOString()
            }
          };
          
          try {
            controller.enqueue(`data: ${JSON.stringify(healthStatus)}\n\n`);
            logger.debug("Sent health broadcast via SSE", healthStatus);
          } catch (error) {
            logger.error("Error sending health broadcast:", { error });
            clearInterval(healthBroadcastInterval);
          }
        }, 60000); // Every 60 seconds - reduced frequency to avoid flickering

        if (messageBusClient) {
          logger.info("MessageBusClient available, setting up event listeners");

          // Listen for status updates
          const onStatusUpdate = (status: any) => {
            logger.debug("Broadcasting status update via SSE", { status });
            
            // Update cache
            updateCrawlerStatus(status);
            
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
            logger.info("DEBUG SSE: Broadcasting job failure logs via SSE", failureData);
            
            // Update cache
            addJobFailureLog(failureData);
            
            const data = JSON.stringify({
              type: "jobFailure",
              payload: failureData,
              timestamp: new Date().toISOString()
            });
            logger.info("DEBUG SSE: Sending failure data: {data}", { data });
            try {
              controller.enqueue(`data: ${data}\n\n`);
              logger.info("DEBUG SSE: Successfully enqueued failure data");
            } catch (error) {
              logger.error("Error sending SSE job failure:", { error });
              logger.error("DEBUG SSE: Error sending job failure: {error}", { error });
            }
          };

          // Listen for heartbeat events
          const onHeartbeat = (payload: any) => {
            logger.debug("Broadcasting heartbeat via SSE", { payload });
            
            // Update cache with heartbeat
            const timestamp = payload?.timestamp || new Date().toISOString();
            updateHeartbeat(timestamp);
            
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
            logger.info("🔄 DEBUG SSE: *** TOKEN REFRESH REQUEST RECEIVED ***");
            logger.info("🔄 DEBUG SSE: Request data: {data}", { data: JSON.stringify(requestData, null, 2) });
            logger.info("Received token refresh request via SSE MessageBusClient", { requestData });
            
            if (!messageBusClient) {
              logger.error('❌ DEBUG SSE: MessageBusClient became null during token refresh processing');
              return;
            }
            
            try {
              const { requestId, providerId, accountId, userId } = requestData;
              logger.info("🔄 DEBUG SSE: Extracted request parameters:", { requestId, providerId, accountId, userId });
              
              // Call our internal token refresh API with session cookies
              logger.info("🔄 DEBUG SSE: Making fetch request to localhost:3000/api/internal/refresh-token");
              
              // Get session cookie from the current request context
              const sessionCookie = request.headers.get('cookie');
              logger.info("🔄 DEBUG SSE: Session cookie available: {available}", { available: !!sessionCookie });
              
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
              
              logger.info("🔄 DEBUG SSE: Fetch response status: {status} {statusText}", { status: response.status, statusText: response.statusText });
              
              if (response.ok) {
                const tokenData = await response.json() as {
                  success?: boolean;
                  accessToken?: string;
                  expiresAt?: string;
                  refreshToken?: string;
                  providerId?: string;
                };
                logger.info('✅ DEBUG SSE: Token refresh successful, token data:', tokenData);
                logger.info('✅ DEBUG SSE: Sending response to crawler with requestId:', requestId);
                
                // Send successful response back to crawler
                if (messageBusClient) {
                  messageBusClient.sendTokenRefreshResponse(requestId, {
                    success: true,
                    accessToken: tokenData.accessToken,
                    expiresAt: tokenData.expiresAt,
                    refreshToken: tokenData.refreshToken,
                    providerId: tokenData.providerId
                  });
                  logger.info('✅ DEBUG SSE: Response sent to crawler successfully');
                } else {
                  logger.error('❌ DEBUG SSE: MessageBusClient became null when sending response');
                }
              } else {
                logger.info("❌ DEBUG SSE: Fetch response not OK, reading error data...");
                const errorData = await response.json() as {
                  error?: string;
                };
                logger.error('❌ DEBUG SSE: Token refresh failed with error data:', errorData);
                
                // Send error response back to crawler
                if (messageBusClient) {
                  logger.info('❌ DEBUG SSE: Sending error response to crawler');
                  messageBusClient.sendTokenRefreshResponse(requestId, {
                    success: false,
                    error: errorData.error || 'Token refresh failed'
                  });
                  logger.info('❌ DEBUG SSE: Error response sent to crawler');
                }
              }
            } catch (error) {
              logger.error('❌ DEBUG SSE: Exception in token refresh processing: {error}', { error });
              logger.error("Token refresh processing error:", { error });
              
              // Send error response back to crawler
              if (messageBusClient) {
                logger.info('❌ DEBUG SSE: Sending exception error response to crawler');
                messageBusClient.sendTokenRefreshResponse(requestData.requestId, {
                  success: false,
                  error: error instanceof Error ? error.message : 'Unknown error during token refresh'
                });
                logger.info('❌ DEBUG SSE: Exception error response sent to crawler');
              }
            }
          };

          // Listen for connection events
          const onConnected = () => {
            logger.info("MessageBusClient connected - notifying SSE clients");
            
            // Update cache
            updateMessageBusConnection(true);
            
            const data = JSON.stringify({
              type: "connection",
              payload: {
                status: "connected",
                component: "messageBus",
                timestamp: new Date().toISOString()
              }
            });
            try {
              controller.enqueue(`data: ${data}\n\n`);
            } catch (error) {
              logger.error("Error sending SSE connection event:", { error });
            }
          };

          const onDisconnected = () => {
            logger.warn("MessageBusClient disconnected - notifying SSE clients");
            
            // Update cache
            updateMessageBusConnection(false);
            
            const data = JSON.stringify({
              type: "connection",
              payload: {
                status: "disconnected",
                component: "messageBus",
                timestamp: new Date().toISOString()
              }
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

          logger.info("🔧 DEBUG SSE: Token refresh handler attached to MessageBusClient");

          // Clean up when client disconnects
          request.signal?.addEventListener('abort', () => {
            logger.info("SSE client disconnected, cleaning up listeners");
            
            // Clear health broadcast interval
            if (healthBroadcastInterval) {
              clearInterval(healthBroadcastInterval);
            }
            
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

  // Fallback: return current status as JSON including cached data
  logger.info("Returning current crawler status as JSON");
  
  const cachedData = getCachedStatus();
  const actuallyConnected = messageBusClient?.isConnected() ?? false;
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