// src/routes/api/internal/refresh-token/+server.ts
import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getLogger } from '$lib/logging';
import AppSettings from '$lib/server/settings';

const logger = getLogger(["api", "refresh-token"]);

/**
 * Directly refreshes a token without requiring a user ID
 * This provides backward compatibility with the previous implementation
 */
async function refreshTokenDirectly(refreshToken: string, providerId: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  createdAt?: number;
} | null> {
  try {
    // Determine provider config
    const isCloud = providerId === 'gitlab-cloud';
    const gitlabConfig = isCloud 
      ? AppSettings().auth.providers.gitlabCloud 
      : AppSettings().auth.providers.gitlab;
    
    if (!gitlabConfig) {
      logger.error(`GitLab provider (${providerId}) configuration not found`);
      return null;
    }

    let tokenUrl: string;
    if (isCloud) {
      tokenUrl = `${gitlabConfig.baseUrl || 'https://gitlab.com'}/oauth/token`;
    } else {
      if (gitlabConfig.baseUrl) {
        tokenUrl = `${gitlabConfig.baseUrl}/oauth/token`;
      } else {
        logger.error(`No baseUrl configured for provider ${providerId}`);
        return null;
      }
    }
    
    // Prepare request parameters
    const params = new URLSearchParams();
    params.append('client_id', gitlabConfig.clientId || '');
    params.append('client_secret', gitlabConfig.clientSecret || '');
    params.append('refresh_token', refreshToken);
    params.append('grant_type', 'refresh_token');
    params.append('redirect_uri', gitlabConfig.redirectURI);
    
    // Make token refresh request
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
      return null;
    }
    
    // Process successful response
    const tokenData = await response.json() as {
      access_token: string;
      token_type: string;
      expires_in: number;
      refresh_token: string;
      created_at: number;
    };
    
    return {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      createdAt: tokenData.created_at
    };
  } catch (error) {
    logger.error(`Error refreshing token directly`, { error });
    return null;
  }
}

export const POST: RequestHandler = async ({locals, request}) => {
  // 1. Verify that event.locals.isSocketRequest is true
  if (!locals.isSocketRequest) {
    return json({ error: 'Forbidden. This endpoint is for socket requests only.' }, { status: 403 });
  }

  let requestBody;
  let refreshToken: string|null = null;
  let providerId: string|null = null;
  try {
    requestBody = await request.json();
    if (requestBody === null || typeof requestBody !== 'object') {
      return json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if ("requestBody" in requestBody) {
      requestBody = requestBody.requestBody as any;
    }
    if ("refreshToken" in requestBody) refreshToken = requestBody.refreshToken as string;
    if ("providerId" in requestBody) providerId = requestBody.providerId as string;
  } catch (e) {
    // Fix: Proper error logging format
    logger.error('Failed to parse JSON body', { error: e });
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof refreshToken !== 'string' || typeof providerId !== 'string') {
    return json({ error: 'Missing or invalid refresh_token or providerId in request body' }, { status: 400 });
  }

  if (!refreshToken || !providerId) {
    return json({ error: 'refresh_token and providerId are required' }, { status: 400 });
  }

  try {
    // Use our direct token refresh function for backward compatibility
    const refreshed = await refreshTokenDirectly(refreshToken, providerId);

    if (refreshed && refreshed.accessToken) {
      // Format the response as expected by the client
      const response = {
        access_token: refreshed.accessToken,
        refresh_token: refreshed.refreshToken,
        expires_in: refreshed.expiresIn,
        created_at: refreshed.createdAt
      };
      
      logger.info(`Successfully refreshed token for provider ${providerId}`);
      return json(response, { status: 200 });
    } else {
      return json({ 
        error: 'Failed to refresh token. Invalid refresh token or provider issue.'
      }, { status: 401 });
    }
  } catch (error) {
    // Fix: Proper error logging format
    logger.error('Token refresh error', { error });
    return json({ error: 'Internal server error during token refresh.' }, { status: 500 });
  }
};