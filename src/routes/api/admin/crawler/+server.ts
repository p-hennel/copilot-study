import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getLogger } from "$lib/logging";
import { isAdmin } from '$lib/server/utils';
import directCommunicationManager from '$lib/server/direct-communication-manager';

const logger = getLogger(["api", "admin", "crawler"]);

export const GET: RequestHandler = async ({ locals }) => {
  logger.debug("Admin crawler status request received");

  // Check if user is admin
  if (!(await isAdmin(locals))) {
    logger.warn("Non-admin user attempted to access crawler status", {
      userId: locals.user?.id,
      userEmail: locals.user?.email
    });
    return json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    // Get status from DirectCommunicationManager
    const isConnected = directCommunicationManager.isConnected();
    const authorizedClients = directCommunicationManager.getAuthorizedClients();
    const hasActiveClients = directCommunicationManager.hasActiveClients();

    // Build comprehensive status object
    const crawlerStatus = {
      connected: isConnected,
      connectionMethod: "direct_socket",
      lastHeartbeat: hasActiveClients ? Date.now() : null, // Simplified for now
      clients: authorizedClients.map(client => ({
        ...client,
        uptime: Date.now() - client.connectedAt,
        lastActivityAgo: Date.now() - client.lastActivity,
        status: Date.now() - client.lastActivity < 60000 ? 'active' : 'stale'
      })),
      totalClients: authorizedClients.length,
      activeClients: authorizedClients.filter(client => 
        Date.now() - client.lastActivity < 60000
      ).length,
      systemStatus: {
        communicationSystem: "DirectCommunicationManager",
        authenticationSystem: "DirectSocketAuth",
        socketPath: process.env.SOCKET_PATH || "not configured",
        migrationComplete: true
      },
      // Legacy compatibility fields
      isRunning: isConnected,
      lastCommunication: hasActiveClients ? new Date() : null,
      errors: [],
      warnings: isConnected ? [] : ["Crawler not connected - waiting for connection"]
    };

    logger.debug("Returning crawler status:", {
      connected: isConnected,
      totalClients: authorizedClients.length,
      activeClients: crawlerStatus.activeClients
    });

    return json(crawlerStatus);

  } catch (error) {
    logger.error("Error getting crawler status:", { error });
    return json({ 
      error: "Failed to get crawler status",
      connected: false,
      connectionMethod: "direct_socket", 
      systemStatus: {
        communicationSystem: "DirectCommunicationManager",
        authenticationSystem: "DirectSocketAuth",
        error: error instanceof Error ? error.message : String(error)
      }
    }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ request, locals }) => {
  logger.debug("Admin crawler action request received");

  // Check if user is admin
  if (!(await isAdmin(locals))) {
    logger.warn("Non-admin user attempted to perform crawler action", {
      userId: locals.user?.id,
      userEmail: locals.user?.email
    });
    return json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const requestBody = await request.json() as { action?: string };
    const { action } = requestBody;
    
    logger.info("Admin crawler action requested:", { 
      action, 
      userId: locals.user?.id 
    });

    switch (action) {
      case 'ping':
      case 'heartbeat': {
        // Send a heartbeat through the direct communication system
        try {
          directCommunicationManager.sendHeartbeat({
            source: 'admin_panel',
            userId: locals.user?.id,
            timestamp: Date.now()
          });
          
          logger.info("Heartbeat sent via DirectCommunicationManager", {
            userId: locals.user?.id,
            connected: directCommunicationManager.isConnected()
          });
          
          return json({ 
            success: true, 
            message: "Heartbeat sent via direct communication",
            connected: directCommunicationManager.isConnected(),
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          logger.error("Failed to send heartbeat:", { error });
          return json({ 
            success: false, 
            error: "Failed to send heartbeat",
            details: error instanceof Error ? error.message : String(error)
          }, { status: 500 });
        }
      }

      case 'status': {
        // Return detailed status information
        const isConnected = directCommunicationManager.isConnected();
        const authorizedClients = directCommunicationManager.getAuthorizedClients();
        
        return json({
          success: true,
          status: {
            connected: isConnected,
            connectionMethod: "direct_socket",
            clients: authorizedClients,
            totalClients: authorizedClients.length,
            systemHealth: {
              communicationManager: "operational",
              authenticationSystem: "operational",
              socketConnection: isConnected ? "connected" : "disconnected"
            }
          }
        });
      }

      case 'disconnect': {
        // For safety, we don't allow disconnecting the crawler from admin panel
        // The crawler should manage its own connection lifecycle
        logger.warn("Admin attempted to disconnect crawler - action blocked for safety", {
          userId: locals.user?.id
        });
        
        return json({
          success: false,
          error: "Disconnect action not permitted",
          message: "Crawler connection is managed automatically. Use crawler-side controls to disconnect."
        }, { status: 400 });
      }

      default: {
        logger.warn("Unknown crawler action requested:", { action, userId: locals.user?.id });
        return json({ 
          success: false, 
          error: "Unknown action",
          availableActions: ['ping', 'heartbeat', 'status']
        }, { status: 400 });
      }
    }

  } catch (error) {
    logger.error("Error processing crawler action:", { error });
    return json({ 
      success: false, 
      error: "Failed to process crawler action",
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
};
