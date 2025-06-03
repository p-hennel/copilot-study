// src/lib/gitlabTokenRefresh.ts
import { getLogger } from "$lib/logging";
import AppSettings from "$lib/server/settings";
import { eq, and } from "drizzle-orm";
import * as schema from "$lib/server/db/schema";
import { db } from "$lib/server/db/index";

const logger = getLogger(["backend", "auth", "gitlab-refresh"]);

interface GitLabTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  created_at: number;
  scope?: string;
}

/**
 * Checks if a token is expired, with a 5-minute buffer
 * @param createdAt UNIX timestamp when token was created
 * @param expiresIn Token lifetime in seconds
 */
export function isTokenExpired(createdAt: number, expiresIn: number): boolean {
  const expirationTime = createdAt + expiresIn;
  const currentTime = Math.floor(Date.now() / 1000);
  // Add a 5-minute buffer to refresh tokens before they expire
  const bufferTime = 5 * 60; // 5 minutes in seconds
  
  return currentTime + bufferTime >= expirationTime;
}

/**
 * Refreshes GitLab OAuth tokens for a specific user and provider
 * @param userId User ID whose tokens need refresh
 * @param providerId GitLab provider ID ('gitlab-cloud' or 'gitlab-onprem')
 * @returns New tokens if successful, null otherwise
 */
export async function refreshGitLabTokens(
  userId: string,
  providerId: string
): Promise<{
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
} | null> {
  logger.info(`Attempting to refresh tokens for user ${userId} with provider ${providerId}`);
  
  try {
    // 1. Get current tokens from database
    const accountResult = await db.query.account.findFirst({
      where: and(
        eq(schema.account.userId, userId),
        eq(schema.account.providerId, providerId)
      )
    });
    
    if (!accountResult) {
      logger.error(`No account found for user ${userId} with provider ${providerId}`);
      return null;
    }
    
    // 🚨 EMERGENCY FIX: Enhanced refresh token validation
    const refreshToken = accountResult.refreshToken;
    logger.debug(`🚨 DATABASE CHECK: User ${userId}, Provider ${providerId}`, {
      hasAccount: !!accountResult,
      hasRefreshToken: !!refreshToken,
      hasAccessToken: !!accountResult.accessToken,
      accessTokenExpiry: accountResult.accessTokenExpiresAt,
      accountCreated: accountResult.createdAt,
      tokenLength: refreshToken ? refreshToken.length : 0
    });
    
    if (!refreshToken) {
      logger.error(`🚨 CRITICAL: No refresh token available for user ${userId} with provider ${providerId}`, {
        accountId: accountResult.id,
        accountIdField: accountResult.accountId,
        hasAccessToken: !!accountResult.accessToken,
        accountCreated: accountResult.createdAt
      });
      return null;
    }
    
    if (refreshToken.length < 10) {
      logger.error(`🚨 CRITICAL: Refresh token too short (${refreshToken.length} chars) for user ${userId} with provider ${providerId}`);
      return null;
    }
    
    // 2. Determine provider config
    const isCloud = providerId === 'gitlab-cloud';
    const gitlabConfig = isCloud 
      ? AppSettings().auth.providers.gitlabCloud 
      : AppSettings().auth.providers.gitlab;
    
    let tokenUrl: string;
    if (isCloud) {
      tokenUrl = `${gitlabConfig.baseUrl || 'https://gitlab.com'}/oauth/token`;
    } else {
      // Handle the potentially undefined tokenUrl
      if (gitlabConfig.baseUrl) {
        tokenUrl = `${gitlabConfig.baseUrl}/oauth/token`;
      } else {
        // Fallback if neither is available
        logger.error(`No baseUrl configured for provider ${providerId}`);
        return null;
      }
    }
    
    // 3. Prepare request parameters - ensure all values are strings
    const params = new URLSearchParams();
    params.append('client_id', gitlabConfig.clientId || '');
    params.append('client_secret', gitlabConfig.clientSecret || '');
    params.append('refresh_token', refreshToken);
    params.append('grant_type', 'refresh_token');
    params.append('redirect_uri', gitlabConfig.redirectURI);
    
    // 4. Make token refresh request
    logger.debug(`Making refresh request to: ${tokenUrl}`);
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    
    if (!response.ok) {
      let errorInfo: any;
      try {
        errorInfo = await response.json();
      } catch {
        errorInfo = await response.text();
      }
      
      logger.error(`Failed to refresh GitLab token. Status: ${response.status}`, { error: errorInfo });
      
      // Check if this is an invalid grant error
      if (errorInfo && typeof errorInfo === 'object' && 'error' in errorInfo && errorInfo.error === 'invalid_grant') {
        logger.warn(`Invalid grant error - user ${userId} needs to re-authenticate with ${providerId}`);
        // Update the account to mark tokens as invalid - without requiresReauth field
        await db.update(schema.account)
          .set({ 
            accessToken: null,
            refreshToken: null,
          })
          .where(and(
            eq(schema.account.userId, userId),
            eq(schema.account.providerId, providerId)
          ));
      }
      
      return null;
    }
    
    // 5. Process successful response
    const tokenData = await response.json() as GitLabTokenResponse;
    
    // Calculate expiration date
    const expiresAt = new Date((tokenData.created_at + tokenData.expires_in) * 1000);
    
    // 6. Update tokens in database - use the correct field names
    await db.update(schema.account)
      .set({
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        accessTokenExpiresAt: expiresAt,
      })
      .where(and(
        eq(schema.account.userId, userId),
        eq(schema.account.providerId, providerId)
      ));
    
    logger.info(`Successfully refreshed tokens for user ${userId} with provider ${providerId}`);
    
    return {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      accessTokenExpiresAt: expiresAt
    };
  } catch (error) {
    logger.error(`Error refreshing GitLab tokens for user ${userId}:`, { error });
    return null;
  }
}

/**
 * Gets fresh GitLab tokens for a user, refreshing if necessary
 * @param userId User ID
 * @param providerId GitLab provider ID ('gitlab-cloud' or 'gitlab-onprem')
 * @returns Valid tokens or null if unavailable
 */
export async function getValidGitLabTokens(
  userId: string,
  providerId: string
): Promise<{
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
} | null> {
  // 1. Get current tokens from database
  const accountResult = await db.query.account.findFirst({
    where: and(
      eq(schema.account.userId, userId),
      eq(schema.account.providerId, providerId)
    )
  });
  
  if (!accountResult) {
    logger.error(`No account found for user ${userId} with provider ${providerId}`);
    return null;
  }
  
  const { accessToken, refreshToken, accessTokenExpiresAt } = accountResult;
  
  if (!accessToken || !refreshToken) {
    logger.error(`Missing tokens for user ${userId} with provider ${providerId}`);
    return null;
  }
  
  // 2. Check if token is expired or will expire soon
  if (!accessTokenExpiresAt || new Date() >= new Date(accessTokenExpiresAt.getTime() - 5 * 60 * 1000)) {
    logger.info(`Access token expired or expiring soon for user ${userId}, refreshing...`);
    return refreshGitLabTokens(userId, providerId);
  }
  
  // 3. Return existing valid tokens
  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt
  };
}

/**
 * Example usage function that ensures fresh GitLab tokens before making API calls
 * @param userId User ID
 * @param providerId GitLab provider ID
 */
export async function makeGitLabApiCall(
  userId: string,
  providerId: string,
  apiPath: string
): Promise<any> {
  // 1. Get valid tokens
  const tokens = await getValidGitLabTokens(userId, providerId);
  
  if (!tokens) {
    throw new Error(`Unable to get valid GitLab tokens for user ${userId}`);
  }
  
  // 2. Determine the base URL
  const isCloud = providerId === 'gitlab-cloud';
  const baseUrl = isCloud 
    ? 'https://gitlab.com/api/v4'
    : `${AppSettings().auth.providers.gitlab.baseUrl}/api/v4`;
  
  // 3. Make API call with valid token
  const response = await fetch(`${baseUrl}/${apiPath}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${tokens.accessToken}`
    }
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitLab API call failed: ${error}`);
  }
  
  return response.json();
}