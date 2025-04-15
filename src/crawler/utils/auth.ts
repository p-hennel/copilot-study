/**
 * Authentication utilities for GitLab API
 * 
 * @packageDocumentation
 */

import { Gitlab } from '@gitbeaker/node';
import type { AuthConfig } from '../types/config-types';

/**
 * Result of a token refresh operation
 */
export interface TokenRefreshResult {
  /**
   * New access token
   */
  accessToken: string;
  
  /**
   * New refresh token (if provided)
   */
  refreshToken?: string;
  
  /**
   * Expiration date for the new token
   */
  expiresAt?: Date;
}

/**
 * Expected structure of the response from GitLab's /oauth/token endpoint
 */
interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  created_at?: number;
  error?: string; // For error responses
  error_description?: string;
}

/**
 * Refresh an OAuth token using the refresh token flow
 * 
 * @param gitlabUrl - GitLab instance URL
 * @param authConfig - Authentication configuration
 * @returns Token refresh result
 * @throws Error if refresh fails
 */
export async function refreshOAuthToken(
  gitlabUrl: string,
  authConfig: AuthConfig
): Promise<TokenRefreshResult> {
  if (!authConfig.refreshToken || !authConfig.clientId || !authConfig.clientSecret) {
    throw new Error('Cannot refresh token: refresh token or client credentials not provided');
  }
  
  try {
    // Call GitLab OAuth endpoint to refresh token
    const response = await fetch(`${gitlabUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: authConfig.refreshToken,
        client_id: authConfig.clientId,
        client_secret: authConfig.clientSecret
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' })) as OAuthTokenResponse;
      throw new Error(`Token refresh failed: ${errorData.error_description || errorData.error || response.statusText}`);
    }
    
    const data = await response.json() as OAuthTokenResponse;
    
    // Calculate expiration time
    let expiresAt: Date | undefined = undefined;
    if (data.expires_in) {
      const now = new Date();
      expiresAt = new Date(now.getTime() + data.expires_in * 1000);
    }
    
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt
    };
  } catch (error) {
    throw new Error(`Failed to refresh token: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Create a GitLab API client instance
 * 
 * @param gitlabUrl - GitLab instance URL
 * @param token - OAuth token
 * @returns GitLab API client
 */
export function createGitLabClient(gitlabUrl: string, token: string): InstanceType<typeof Gitlab> {
  return new Gitlab({
    host: gitlabUrl,
    token: token
  });
}


/**
 * Checks if a specific AuthConfig's token needs refreshing and performs the refresh if necessary.
 * Updates the provided AuthConfig object in place and returns it.
 * Invokes the tokenRefreshCallback within the AuthConfig if refresh is successful.
 *
 * @param authConfig - The authentication configuration for the specific job/token.
 * @param gitlabUrl - GitLab instance URL.
 * @param bufferMinutes - Buffer time in minutes before expiration to trigger refresh.
 * @returns The potentially updated AuthConfig object.
 * @throws Error if refresh is attempted and fails.
 */
export async function refreshJobToken(
  authConfig: AuthConfig,
  gitlabUrl: string,
  bufferMinutes: number = 5
): Promise<AuthConfig> {
  // Can only refresh if we have a refresh token and client credentials
  if (!authConfig.refreshToken || !authConfig.clientId || !authConfig.clientSecret) {
    // Cannot refresh, return original config
    return authConfig;
  }

  if (tokenNeedsRefresh(authConfig.tokenExpiresAt, bufferMinutes)) {
    console.log(`Token for job needs refresh (Expires: ${authConfig.tokenExpiresAt}). Refreshing...`); // TODO: Replace console.log with proper logger if available here
    try {
      const result = await refreshOAuthToken(gitlabUrl, authConfig);

      // Update the passed AuthConfig object in place
      authConfig.oauthToken = result.accessToken;
      authConfig.refreshToken = result.refreshToken || authConfig.refreshToken; // Keep old refresh token if new one isn't provided
      authConfig.tokenExpiresAt = result.expiresAt;

      console.log(`Token for job refreshed successfully. New expiry: ${authConfig.tokenExpiresAt}`); // TODO: Replace console.log

      // Notify callback if provided within this specific authConfig
      if (authConfig.tokenRefreshCallback) {
        try {
          authConfig.tokenRefreshCallback(result.accessToken);
        } catch (callbackError) {
          console.error(`Error in job-specific tokenRefreshCallback: ${callbackError}`); // TODO: Replace console.error
        }
      }
      return authConfig; // Return the updated config
    } catch (error) {
      console.error(`Failed to refresh job-specific token: ${error}`); // TODO: Replace console.error
      // Re-throw the error to be handled by the job processing logic
      throw error;
    }
  }

  // No refresh needed, return original config
  return authConfig;
}

/**
 * Check if a token needs to be refreshed
 * 
 * @param expiresAt - Token expiration date
 * @param bufferMinutes - Buffer time in minutes before expiration
 * @returns Whether the token needs refresh
 */
export function tokenNeedsRefresh(expiresAt?: Date, bufferMinutes: number = 5): boolean {
  if (!expiresAt) return false;
  
  const now = new Date();
  const bufferTime = bufferMinutes * 60 * 1000;
  const refreshTime = new Date(expiresAt.getTime() - bufferTime);
  
  return now >= refreshTime;
}