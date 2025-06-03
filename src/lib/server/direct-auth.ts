// src/lib/server/direct-auth.ts - Connection-based authentication for direct communication
import { getLogger, type Logger } from "@logtape/logtape";

/**
 * DirectSocketAuth manages authorized connections from crawlz
 * Replaces the `locals.isSocketRequest` authentication method
 */
export class DirectSocketAuth {
  private authorizedClients = new Set<string>();
  private clientConnections = new Map<string, { connectedAt: number; lastActivity: number }>();
  private logger: Logger;
  private readonly CLIENT_TIMEOUT = 300000; // 5 minutes

  constructor() {
    this.logger = getLogger(["auth", "direct-socket"]);
    
    // Start periodic cleanup of stale connections
    setInterval(() => {
      this.cleanupStaleConnections();
    }, 60000); // Cleanup every minute
  }

  /**
   * Register an authorized client connection
   * @param clientId Unique identifier for the client (e.g., process ID or connection ID)
   */
  public registerClient(clientId: string): void {
    const now = Date.now();
    this.authorizedClients.add(clientId);
    this.clientConnections.set(clientId, {
      connectedAt: now,
      lastActivity: now
    });
    
    this.logger.info("Registered authorized client", {
      clientId,
      totalClients: this.authorizedClients.size
    });
  }

  /**
   * Unregister a client connection
   * @param clientId The client identifier to remove
   */
  public unregisterClient(clientId: string): void {
    this.authorizedClients.delete(clientId);
    this.clientConnections.delete(clientId);
    
    this.logger.info("Unregistered client", {
      clientId,
      totalClients: this.authorizedClients.size
    });
  }

  /**
   * Update the last activity time for a client
   * @param clientId The client identifier
   */
  public updateClientActivity(clientId: string): void {
    const connection = this.clientConnections.get(clientId);
    if (connection) {
      connection.lastActivity = Date.now();
    }
  }

  /**
   * Check if a request is from an authorized socket connection
   * This replaces the `locals.isSocketRequest` check
   * @param request The incoming request
   * @returns True if the request is from an authorized socket connection
   */
  public isAuthorizedSocketRequest(request: Request): boolean {
    // Check for direct socket communication headers
    const requestSource = request.headers.get('x-request-source');
    const clientId = request.headers.get('x-client-id');
    
    // CRITICAL FIX: Any request coming via Unix socket should bypass authentication
    // The socket connection itself is the authentication mechanism
    if (requestSource === 'unix') {
      this.logger.debug("Unix socket request detected - bypassing authentication", {
        clientId: clientId || 'unknown',
        requestSource,
        authorizedClients: this.authorizedClients.size
      });
      
      // Update activity for registered clients if clientId is provided
      if (clientId && this.authorizedClients.has(clientId)) {
        this.updateClientActivity(clientId);
      }
      
      return true; // Always authorize Unix socket requests
    }

    return false; // Non-socket requests are not authorized through this method
  }

  /**
   * Get information about authorized clients
   * @returns Array of client information
   */
  public getAuthorizedClients(): Array<{ clientId: string; connectedAt: number; lastActivity: number }> {
    return Array.from(this.clientConnections.entries()).map(([clientId, connection]) => ({
      clientId,
      connectedAt: connection.connectedAt,
      lastActivity: connection.lastActivity
    }));
  }

  /**
   * Check if any clients are currently connected
   * @returns True if there are authorized clients
   */
  public hasActiveClients(): boolean {
    return this.authorizedClients.size > 0;
  }

  /**
   * Clean up stale connections that haven't been active recently
   */
  private cleanupStaleConnections(): void {
    const now = Date.now();
    const staleClients: string[] = [];

    for (const [clientId, connection] of this.clientConnections.entries()) {
      if (now - connection.lastActivity > this.CLIENT_TIMEOUT) {
        staleClients.push(clientId);
      }
    }

    if (staleClients.length > 0) {
      this.logger.info("Cleaning up stale client connections", {
        staleClients,
        count: staleClients.length
      });

      for (const clientId of staleClients) {
        this.unregisterClient(clientId);
      }
    }
  }

  /**
   * Force cleanup of all connections (for shutdown)
   */
  public cleanup(): void {
    this.logger.info("Cleaning up all client connections", {
      clientCount: this.authorizedClients.size
    });
    
    this.authorizedClients.clear();
    this.clientConnections.clear();
  }
}

// Create and export singleton instance
const directSocketAuth = new DirectSocketAuth();
export default directSocketAuth;

/**
 * Helper function to check if a request is from an authorized socket connection
 * This function can be used in API endpoints to replace `locals.isSocketRequest`
 */
export function isAuthorizedSocketRequest(request: Request): boolean {
  return directSocketAuth.isAuthorizedSocketRequest(request);
}

/**
 * Helper function to register a client
 * This should be called when a new authorized connection is established
 */
export function registerAuthorizedClient(clientId: string): void {
  directSocketAuth.registerClient(clientId);
}

/**
 * Helper function to unregister a client
 * This should be called when a connection is closed
 */
export function unregisterAuthorizedClient(clientId: string): void {
  directSocketAuth.unregisterClient(clientId);
}