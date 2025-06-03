// src/lib/server/direct-communication-manager.ts - Direct communication manager
// Replaces supervisor.ts functionality with direct socket communication

import { eq } from "drizzle-orm";
import { db } from "$lib/server/db";
import { job as jobSchema } from "$lib/server/db/schema";
import { JobStatus } from "$lib/types";
import { getLogger } from "@logtape/logtape";
import directCommunicationClient from "$lib/messaging/DirectCommunicationClient";
import directSocketAuth, { registerAuthorizedClient, unregisterAuthorizedClient } from "$lib/server/direct-auth";

const logger = getLogger(["backend", "direct-communication-manager"]);

/**
 * Reset all running jobs to queued status when crawler connection is lost
 */
async function resetRunningJobsOnDisconnect(): Promise<void> {
  try {
    logger.info("Direct communication lost - resetting running jobs to queued status");
    
    const result = await db
      .update(jobSchema)
      .set({
        status: JobStatus.queued,
        started_at: null, // Reset start time since job will need to restart
        updated_at: new Date() // Ensure updated_at is properly set
      })
      .where(eq(jobSchema.status, JobStatus.running));
    
    if (result.rowsAffected > 0) {
      logger.info(`Successfully reset ${result.rowsAffected} running jobs to queued status`);
    } else {
      logger.info("No running jobs found to reset");
    }
  } catch (error) {
    logger.error("Failed to reset running jobs to queued status:", { error });
  }
}

/**
 * DirectCommunicationManager manages direct communication with crawlz
 * Replaces the supervisor.ts functionality
 */
export class DirectCommunicationManager {
  private initialized = false;
  private logger = getLogger(["backend", "direct-communication-manager"]);

  constructor() {
    this.logger.debug("DirectCommunicationManager constructor");
  }

  /**
   * Initialize the direct communication system
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.debug("DirectCommunicationManager already initialized");
      return;
    }

    this.logger.info("Initializing DirectCommunicationManager...");

    try {
      // Set up event listeners for the direct communication client
      this.setupEventListeners();
      
      this.initialized = true;
      this.logger.info("✅ DirectCommunicationManager initialized successfully");
    } catch (error) {
      this.logger.error("❌ Failed to initialize DirectCommunicationManager:", { error });
      throw error;
    }
  }

  /**
   * Set up event listeners for direct communication
   */
  private setupEventListeners(): void {
    this.logger.debug("Setting up DirectCommunicationManager event listeners...");

    // Remove any existing listeners to prevent duplicates
    directCommunicationClient.removeAllListeners();

    // Connection management
    directCommunicationClient.onConnected(() => {
      this.logger.info("✅ Direct connection to crawlz established");
      // Register the crawler as an authorized client
      registerAuthorizedClient("external-crawler");
    });

    directCommunicationClient.onDisconnected(() => {
      this.logger.warn("❌ Direct connection to crawlz lost");
      // Unregister the crawler client
      unregisterAuthorizedClient("external-crawler");
      // Reset running jobs to queued when connection is lost
      resetRunningJobsOnDisconnect();
    });

    directCommunicationClient.on("error", (error) => {
      this.logger.error("DirectCommunicationClient Error:", { error });
    });

    // Heartbeat monitoring
    directCommunicationClient.onHeartbeat((payload: unknown) => {
      if (
        typeof payload === "object" &&
        payload !== null &&
        "timestamp" in payload &&
        typeof payload.timestamp === "number"
      ) {
        this.logger.debug("Received heartbeat", { timestamp: payload.timestamp });
      } else {
        this.logger.warn("Received heartbeat with invalid or missing timestamp:", { payload });
      }
    });

    // Job request handling
    directCommunicationClient.onJobRequest(async (requestData) => {
      this.logger.debug("JOB REQUEST HANDLER TRIGGERED");
      this.logger.debug("Job request data:", { requestData });
      
      try {
        // Use the existing job fetching logic from the /api/internal/jobs/open endpoint
        this.logger.debug('Fetching jobs via internal endpoint...');
        
        const response = await fetch('http://localhost:3000/api/internal/jobs/open', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'x-request-source': 'unix',
            'x-client-id': 'external-crawler'
          }
        });

        if (response.ok) {
          const jobs = await response.json();
          
          // Check if response is an error object
          if (jobs && typeof jobs === 'object' && 'error' in jobs) {
            this.logger.warn('Job fetching returned error response:', { errorResponse: jobs });
            
            // Send error response back to crawler
            const errorJobs = jobs as { error: string; message?: string };
            directCommunicationClient.sendJobErrorToCrawler(
              errorJobs.message || errorJobs.error || 'Job provisioning failed',
              requestData.requestId
            );
            return;
          }
          
          this.logger.debug('Jobs fetched successfully via socket request:', {
            jobCount: Array.isArray(jobs) ? jobs.length : 0
          });
          
          // Send job response back to crawler
          const jobsArray = Array.isArray(jobs) ? jobs : [];
          directCommunicationClient.sendJobResponseToCrawler(jobsArray);
          this.logger.debug('Job response sent to crawler successfully');
        } else {
          const responseText = await response.text().catch(() => 'Unable to read response');
          this.logger.warn(`Job fetching failed with status ${response.status}: ${response.statusText}`, {
            responseBody: responseText
          });
          
          // Send error response back to crawler
          directCommunicationClient.sendJobErrorToCrawler(
            `Job fetching failed: ${response.status} ${response.statusText}`,
            requestData.requestId
          );
        }
      } catch (error) {
        this.logger.error('Exception in job request processing:', { error });
        
        // Send error response back to crawler
        directCommunicationClient.sendJobErrorToCrawler(
          error instanceof Error ? error.message : 'Unknown error during job request',
          requestData.requestId
        );
      }
    });

    // Progress update handling
    directCommunicationClient.onProgressUpdate(async (progressData) => {
      this.logger.debug("PROGRESS UPDATE HANDLER TRIGGERED");
      this.logger.debug("Progress update data:", { progressData });
      
      try {
        // Handle the crawler's actual payload structure
        // Ensure we don't override existing properties with spread operator
        const payload = {
          ...progressData, // Include all fields from progressData first
          // Only override if not already present
          status: progressData.status || 'processing',
          timestamp: progressData.timestamp || new Date().toISOString()
        };
        
        this.logger.debug('Processing progress update via internal endpoint...', { 
          taskId: payload.taskId, 
          status: payload.status,
          hasAreas: !!progressData.areas,
          areasCount: progressData.areas?.length
        });
        
        // Forward to internal progress API with correct payload structure
        const response = await fetch('http://localhost:3000/api/internal/jobs/progress', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-request-source': 'unix',
            'x-client-id': 'external-crawler'
          },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          this.logger.debug('Progress update processed successfully via socket');
        } else {
          const errorText = await response.text();
          this.logger.warn(`Progress update failed with status ${response.status}: ${response.statusText}`, {
            error: errorText,
            payload: payload
          });
        }
      } catch (error) {
        this.logger.error('Exception in progress update processing:', { error });
      }
    });

    // Token refresh request handling
    directCommunicationClient.onTokenRefreshRequest(async (requestData) => {
      this.logger.debug("TOKEN REFRESH HANDLER TRIGGERED");
      this.logger.debug("Handler received data:", { requestData });
      this.logger.info("Received token refresh request via DirectCommunication", { requestData });
      
      try {
        const { requestId, providerId, accountId, userId } = requestData;
        this.logger.debug("Extracted request parameters:", { requestId, providerId, accountId, userId });
        
        // Call our internal token refresh API
        this.logger.debug("Making fetch request to localhost:3000/api/internal/refresh-token");
        
        const response = await fetch('http://localhost:3000/api/internal/refresh-token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-request-source': 'unix',
            'x-request-id': requestId,
            'x-client-id': 'external-crawler'
          },
          body: JSON.stringify({
            providerId,
            accountId,
            userId
          })
        });
        
        this.logger.debug("Fetch response details:", {
          requestId,
          status: response.status,
          statusText: response.statusText
        });
        
        if (response.ok) {
          const tokenData = await response.json() as {
            success?: boolean;
            accessToken?: string;
            expiresAt?: string;
            refreshToken?: string;
            providerId?: string;
          };
          this.logger.debug('Token refresh successful', { tokenData: { ...tokenData, accessToken: '***', refreshToken: '***' } });
          
          // Send successful response back to crawler
          directCommunicationClient.sendTokenRefreshResponse(requestId, {
            success: true,
            accessToken: tokenData.accessToken,
            expiresAt: tokenData.expiresAt,
            refreshToken: tokenData.refreshToken,
            providerId: tokenData.providerId
          });
          this.logger.debug('Response sent to crawler successfully');
        } else {
          this.logger.debug("Fetch response not OK, reading error data...");
          const errorData = await response.json() as {
            error?: string;
          };
          this.logger.error('Token refresh failed with error data:', { errorData });
          
          // Send error response back to crawler
          directCommunicationClient.sendTokenRefreshResponse(requestId, {
            success: false,
            error: errorData.error || 'Token refresh failed'
          });
          this.logger.debug('Error response sent to crawler');
        }
      } catch (error) {
        this.logger.error('Exception in token refresh processing:', { error });
        
        // Send error response back to crawler
        directCommunicationClient.sendTokenRefreshResponse(requestData.requestId, {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error during token refresh'
        });
        this.logger.debug('Exception error response sent to crawler');
      }
    });

    this.logger.debug("DirectCommunicationManager event listeners setup completed");
  }

  /**
   * Get the connection status
   */
  public isConnected(): boolean {
    return directCommunicationClient.isConnected();
  }

  /**
   * Get information about authorized clients
   */
  public getAuthorizedClients(): Array<{ clientId: string; connectedAt: number; lastActivity: number }> {
    return directSocketAuth.getAuthorizedClients();
  }

  /**
   * Check if there are any active crawler connections
   */
  public hasActiveClients(): boolean {
    return directSocketAuth.hasActiveClients();
  }

  /**
   * Send a heartbeat (for testing/monitoring)
   */
  public sendHeartbeat(payload?: any): void {
    directCommunicationClient.sendHeartbeat(payload);
  }

  /**
   * Cleanup resources
   */
  public cleanup(): void {
    this.logger.info("Cleaning up DirectCommunicationManager");
    
    try {
      directCommunicationClient.removeAllListeners();
      directCommunicationClient.disconnect();
      directSocketAuth.cleanup();
      
      this.initialized = false;
      this.logger.info("✅ DirectCommunicationManager cleanup completed");
    } catch (error) {
      this.logger.error("❌ Error during DirectCommunicationManager cleanup:", { error });
    }
  }
}

// Create and export singleton instance
const directCommunicationManager = new DirectCommunicationManager();
export default directCommunicationManager;

// Export utility functions for backward compatibility
export function getCrawlerStatus(): any {
  return {
    connected: directCommunicationManager.isConnected(),
    clients: directCommunicationManager.getAuthorizedClients(),
    hasActiveClients: directCommunicationManager.hasActiveClients()
  };
}

export function getLastHeartbeat(): number {
  // For compatibility - would need to track this if needed
  return Date.now();
}

/**
 * Start a job - sends command via direct communication
 * Replaces supervisor.ts startJob function
 */
export async function startJob(params: any): Promise<boolean> {
  logger.info("Starting job via DirectCommunicationClient", { params });
  
  try {
    // Send job start command via direct communication
    directCommunicationClient.sendCommandToCrawler({
      type: "START_JOB",
      ...params
    });
    return true;
  } catch (error) {
    logger.error("Failed to start job via DirectCommunicationClient:", { error });
    return false;
  }
}

/**
 * Pause crawler - sends command via direct communication
 * Replaces supervisor.ts pauseCrawler function
 */
export function pauseCrawler(): boolean {
  logger.info("Pausing crawler via DirectCommunicationClient");
  
  try {
    directCommunicationClient.sendCommandToCrawler({
      type: "PAUSE_CRAWLER"
    });
    return true;
  } catch (error) {
    logger.error("Failed to pause crawler via DirectCommunicationClient:", { error });
    return false;
  }
}

/**
 * Resume crawler - sends command via direct communication
 * Replaces supervisor.ts resumeCrawler function
 */
export function resumeCrawler(): boolean {
  logger.info("Resuming crawler via DirectCommunicationClient");
  
  try {
    directCommunicationClient.sendCommandToCrawler({
      type: "RESUME_CRAWLER"
    });
    return true;
  } catch (error) {
    logger.error("Failed to resume crawler via DirectCommunicationClient:", { error });
    return false;
  }
}

// Initialize the manager when this module is imported
directCommunicationManager.initialize().catch((error) => {
  logger.error("❌ Failed to initialize DirectCommunicationManager:", { error });
});