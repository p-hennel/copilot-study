import type { 
  TokenRefreshRequestMessage, 
  TokenRefreshResponseMessage,
  WebAppMessage 
} from '../types/messages.js';
import type { SocketConnection } from '../types/connection.js';
import type { DatabaseManager } from '../persistence/database-manager.js';
import { JobRepository } from '../persistence/job-repository.js';
import { JobStatus } from '../../../types.js';
import { formatTimestamp } from '../utils/index.js';

/**
 * Handle token refresh requests from crawler
 * 
 * Handles:
 * - Process token_refresh_request messages from crawler
 * - Coordinate with OAuth2 refresh logic in web application
 * - Send token_refresh_response back to crawler
 * - Handle token refresh failures and job state management
 * - Manage credential expiration scenarios
 */
export class TokenRefreshHandler {
  private jobRepository: JobRepository;
  private tokenRefreshService: TokenRefreshService | null = null;

  constructor(private dbManager: DatabaseManager) {
    this.jobRepository = new JobRepository(dbManager);
  }

  /**
   * Set the token refresh service for OAuth2 operations
   */
  setTokenRefreshService(service: TokenRefreshService): void {
    this.tokenRefreshService = service;
  }

  /**
   * Handle token refresh request from crawler
   */
  async handleTokenRefreshRequest(
    connection: SocketConnection,
    message: TokenRefreshRequestMessage
  ): Promise<void> {
    if (!message.job_id) {
      console.error('Token refresh request missing job_id');
      await this.sendTokenRefreshResponse(connection, 'unknown', false, 'Missing job ID');
      return;
    }

    try {
      console.log(`Processing token refresh request for job ${message.job_id}:`, {
        tokenExpired: message.data.current_token_expired,
        lastRequest: message.data.last_successful_request,
        errorDetails: message.data.error_details
      });

      // Get job details
      const job = await this.jobRepository.getJob(message.job_id);
      if (!job) {
        console.error(`Job not found for token refresh: ${message.job_id}`);
        await this.sendTokenRefreshResponse(connection, message.job_id, false, 'Job not found');
        return;
      }

      // Update job status to indicate credential issues
      await this.jobRepository.updateJobStatus(
        message.job_id, 
        JobStatus.waiting_credential_renewal,
        { errorMessage: `Token expired: ${message.data.error_details}` }
      );

      // Attempt token refresh
      const refreshResult = await this.refreshToken(job, message.data);
      
      if (refreshResult.success && refreshResult.newToken) {
        // Send successful refresh response
        await this.sendTokenRefreshResponse(
          connection, 
          message.job_id, 
          true, 
          undefined,
          refreshResult.newToken,
          refreshResult.expiresAt
        );

        // Update job status back to running
        await this.jobRepository.updateJobStatus(
          message.job_id, 
          JobStatus.credential_renewed
        );

        console.log(`Token refresh successful for job ${message.job_id}`);
      } else {
        // Send failure response
        await this.sendTokenRefreshResponse(
          connection, 
          message.job_id, 
          false, 
          refreshResult.error || 'Token refresh failed'
        );

        // Mark job as failed due to credential issues
        await this.jobRepository.updateJobStatus(
          message.job_id, 
          JobStatus.credential_expired,
          { 
            finishedAt: new Date(),
            errorMessage: `Token refresh failed: ${refreshResult.error}`
          }
        );

        console.error(`Token refresh failed for job ${message.job_id}: ${refreshResult.error}`);
      }

    } catch (error) {
      console.error(`Error handling token refresh for ${message.job_id}:`, error);
      
      // Send error response to crawler
      await this.sendTokenRefreshResponse(
        connection, 
        message.job_id, 
        false, 
        `Internal error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );

      // Mark job as failed
      try {
        await this.jobRepository.markJobFailed(
          message.job_id,
          `Token refresh error: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      } catch (failError) {
        console.error(`Failed to mark job as failed:`, failError);
      }
    }
  }

  /**
   * Refresh OAuth2 token for a job
   */
  private async refreshToken(
    job: import('../types/database.js').Job,
    requestData: TokenRefreshRequestMessage['data']
  ): Promise<TokenRefreshResult> {
    if (!this.tokenRefreshService) {
      return {
        success: false,
        error: 'Token refresh service not configured'
      };
    }

    try {
      // Extract relevant information for token refresh
      const refreshContext: TokenRefreshContext = {
        accountId: job.accountId,
        userId: job.userId || undefined,
        provider: job.provider || 'gitlab-onprem',
        gitlabHost: job.gitlabGraphQLUrl || 'https://gitlab.com',
        jobId: job.id,
        errorDetails: requestData.error_details,
        lastSuccessfulRequest: requestData.last_successful_request
      };

      // Delegate to the token refresh service
      const result = await this.tokenRefreshService.refreshToken(refreshContext);
      
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Token refresh failed'
      };
    }
  }

  /**
   * Send token refresh response to crawler
   */
  private async sendTokenRefreshResponse(
    connection: SocketConnection,
    jobId: string,
    success: boolean,
    errorMessage?: string,
    newToken?: string,
    expiresAt?: string
  ): Promise<void> {
    try {
      const response: TokenRefreshResponseMessage = {
        type: 'token_refresh_response',
        timestamp: formatTimestamp(),
        job_id: jobId,
        data: {
          access_token: newToken || '',
          expires_at: expiresAt,
          refresh_successful: success
        }
      };

      // If refresh failed, add error details
      if (!success && errorMessage) {
        (response.data as any).error_message = errorMessage;
      }

      await connection.send(response as WebAppMessage);
      
      console.log(`Sent token refresh response for job ${jobId}: ${success ? 'success' : 'failed'}`);
    } catch (error) {
      console.error(`Error sending token refresh response for job ${jobId}:`, error);
    }
  }

  /**
   * Handle proactive token refresh (before expiration)
   */
  async proactiveTokenRefresh(
    connection: SocketConnection,
    jobId: string,
    accountId: string
  ): Promise<boolean> {
    if (!this.tokenRefreshService) {
      console.warn('Proactive token refresh requested but service not configured');
      return false;
    }

    try {
      const job = await this.jobRepository.getJob(jobId);
      if (!job) {
        console.error(`Job not found for proactive refresh: ${jobId}`);
        return false;
      }

      const refreshContext: TokenRefreshContext = {
        accountId,
        userId: job.userId || undefined,
        provider: job.provider || 'gitlab-onprem',
        gitlabHost: job.gitlabGraphQLUrl || 'https://gitlab.com',
        jobId,
        proactive: true
      };

      const result = await this.tokenRefreshService.refreshToken(refreshContext);
      
      if (result.success && result.newToken) {
        // Send updated token to crawler proactively
        await this.sendTokenRefreshResponse(
          connection,
          jobId,
          true,
          undefined,
          result.newToken,
          result.expiresAt
        );
        
        console.log(`Proactive token refresh successful for job ${jobId}`);
        return true;
      } else {
        console.warn(`Proactive token refresh failed for job ${jobId}: ${result.error}`);
        return false;
      }
    } catch (error) {
      console.error(`Error in proactive token refresh for job ${jobId}:`, error);
      return false;
    }
  }

  /**
   * Get token refresh statistics for monitoring
   */
  async getTokenRefreshStatistics(accountId?: string): Promise<TokenRefreshStatistics> {
    try {
      // Get jobs with credential-related statuses
      const credentialJobs = await Promise.all([
        this.jobRepository.getJobsByStatus(JobStatus.credential_expired, accountId),
        this.jobRepository.getJobsByStatus(JobStatus.waiting_credential_renewal, accountId),
        this.jobRepository.getJobsByStatus(JobStatus.credential_renewed, accountId)
      ]);

      return {
        expired_credentials: credentialJobs[0].length,
        pending_renewals: credentialJobs[1].length,
        successful_renewals: credentialJobs[2].length,
        total_credential_issues: credentialJobs[0].length + credentialJobs[1].length
      };
    } catch (error) {
      console.error('Error getting token refresh statistics:', error);
      return {
        expired_credentials: 0,
        pending_renewals: 0,
        successful_renewals: 0,
        total_credential_issues: 0
      };
    }
  }
}

// Interface for external token refresh service
export interface TokenRefreshService {
  refreshToken(context: TokenRefreshContext): Promise<TokenRefreshResult>;
  validateToken?(token: string, context: TokenRefreshContext): Promise<boolean>;
  getTokenExpiration?(token: string): Promise<Date | null>;
}

// Token refresh context
export interface TokenRefreshContext {
  accountId: string;
  userId?: string;
  provider: string;
  gitlabHost: string;
  jobId: string;
  errorDetails?: string;
  lastSuccessfulRequest?: string;
  proactive?: boolean;
}

// Token refresh result
export interface TokenRefreshResult {
  success: boolean;
  newToken?: string;
  expiresAt?: string;
  error?: string;
  requiresUserAction?: boolean;
}

// Type definitions
interface TokenRefreshStatistics {
  expired_credentials: number;
  pending_renewals: number;
  successful_renewals: number;
  total_credential_issues: number;
}