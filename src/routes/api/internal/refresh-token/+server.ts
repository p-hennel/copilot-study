import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { refreshGitLabTokens } from '$lib/gitlabTokenRefresh';
import { db } from '$lib/server/db/index';
import { eq } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema';
import { getLogger } from "@logtape/logtape";
import { isAdmin } from '$lib/server/utils';
import { isAuthorizedSocketRequest } from '$lib/server/direct-auth';

const logger = getLogger(["api", "internal", "refresh-token"]);

export const POST: RequestHandler = async ({ request, locals }) => {
  // 🔍 VALIDATION: Log request details
  const requestId = request.headers.get('x-request-id');
  const requestSource = request.headers.get('x-request-source');
  const clientId = request.headers.get('x-client-id');
  
  logger.debug('🔍 VALIDATION: Token refresh API endpoint called', {
    requestId,
    requestSource,
    clientId,
    hasLocals: !!locals,
    localsUser: locals?.user?.id,
    timestamp: Date.now()
  });

  // Enhanced authentication using DirectSocketAuth
  const isAuthorizedSocket = isAuthorizedSocketRequest(request);
  const isAdminUser = await isAdmin(locals);
  
  if (isAuthorizedSocket) {
    logger.debug('🔍 VALIDATION: Authorized socket request detected, bypassing other auth checks:', {
      requestId,
      requestSource,
      clientId
    });
  } else if (isAdminUser) {
    logger.debug('🔍 VALIDATION: Admin user authenticated for external request:', {
      requestId,
      isAdmin: isAdminUser,
      hasUser: !!locals?.user,
      userId: locals?.user?.id
    });
  } else {
    logger.error('🔍 VALIDATION: Unauthorized token refresh request', {
      requestId,
      requestSource,
      clientId,
      hasLocals: !!locals,
      hasUser: !!locals?.user,
      isAuthorizedSocket,
      isAdminUser
    });
    return json({ error: "Unauthorized!" }, { status: 401 });
  }

  // Log authentication method used
  if (isAuthorizedSocket) {
    logger.info('Token refresh authenticated via authorized socket connection', {
      requestId,
      clientId,
      requestSource
    });
  } else if (isAdminUser) {
    logger.info('Token refresh authenticated via admin session', {
      requestId,
      userId: locals.user?.id
    });
  }

  logger.debug('Token refresh API endpoint authenticated successfully');
  
  try {
    const body = await request.json();
    logger.debug('Request body:', { body });
    
    // Type check the request body
    if (typeof body !== 'object' || body === null) {
      logger.error('Invalid request body type');
      return json({ error: 'Invalid request body' }, { status: 400 });
    }
    
    const { providerId, accountId, userId, refreshToken } = body as {
      providerId?: string;
      accountId?: string;
      userId?: string;
      refreshToken?: string;
    };

    logger.debug('Extracted parameters:', { providerId, accountId, userId, hasRefreshToken: !!refreshToken });

    if (!providerId) {
      logger.error('Provider ID missing');
      return json({ error: 'Provider ID is required' }, { status: 400 });
    }

    try {
      logger.debug('Using GitLab token refresh for background token refresh...');
      
      // Handle GitLab providers specifically
      if (providerId === 'gitlab' || providerId === 'gitlab-cloud' || providerId === 'gitlab-onprem') {
        let targetUserId = userId;
        
        // If we don't have userId, try to find it from accountId or refreshToken
        if (!targetUserId) {
          if (accountId) {
            logger.debug('Looking up userId from accountId:', { accountId });
            const accountResult = await db.query.account.findFirst({
              where: eq(schema.account.id, accountId),
              columns: { userId: true }
            });
            
            if (accountResult) {
              targetUserId = accountResult.userId;
              logger.debug('Found userId from accountId:', { targetUserId });
            }
          } else if (refreshToken) {
            logger.debug('Looking up userId from refreshToken');
            const accountResult = await db.query.account.findFirst({
              where: eq(schema.account.refreshToken, refreshToken),
              columns: { userId: true, providerId: true }
            });
            
            if (accountResult) {
              targetUserId = accountResult.userId;
              logger.debug('Found userId from refreshToken:', { targetUserId, providerId: accountResult.providerId });
            }
          } else {
            // If no specific user info is provided, try to find the most recent account for this provider
            logger.debug('No user identification provided, looking for most recent account with provider:', { providerId });
            const mappedProviderId = providerId === 'gitlab' ? 'gitlab-cloud' : providerId;
            const accountResult = await db.query.account.findFirst({
              where: eq(schema.account.providerId, mappedProviderId),
              columns: { userId: true },
              orderBy: (accounts, { desc }) => [desc(accounts.createdAt)]
            });
            
            if (accountResult) {
              targetUserId = accountResult.userId;
              logger.debug('Found most recent userId for provider:', { targetUserId });
            }
          }
        }
        
        if (!targetUserId) {
          logger.error('Could not determine target user ID');
          return json({ error: 'Could not determine target user ID for token refresh' }, { status: 400 });
        }
        
        // Map provider names to the correct format
        const mappedProviderId = providerId === 'gitlab' ? 'gitlab-cloud' : providerId;
        
        logger.debug('Refreshing GitLab tokens for user:', { targetUserId, providerId: mappedProviderId });
        const refreshResult = await refreshGitLabTokens(targetUserId, mappedProviderId);
        
        if (refreshResult) {
          logger.debug('GitLab token refresh successful');
          const responseData = {
            success: true,
            accessToken: refreshResult.accessToken,
            expiresAt: refreshResult.accessTokenExpiresAt.toISOString(),
            refreshToken: refreshResult.refreshToken,
            providerId: mappedProviderId
          };
          logger.debug('Returning response data:', { ...responseData, accessToken: '***', refreshToken: '***' });
          return json(responseData);
        } else {
          logger.error('GitLab token refresh failed');
          return json({ error: 'Failed to refresh GitLab token' }, { status: 500 });
        }
      } else {
        logger.error('Unsupported provider for background refresh:', { providerId });
        return json({ error: `Unsupported provider for background refresh: ${providerId}` }, { status: 400 });
      }
    } catch (refreshError) {
      logger.error('Error during token refresh:', { error: refreshError });
      return json({
        error: `Failed to refresh token: ${refreshError instanceof Error ? refreshError.message : 'Unknown refresh error'}`
      }, { status: 500 });
    }
  } catch (error) {
    logger.error('Token refresh endpoint error:', { error });
    return json({
      error: `Token refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    }, { status: 500 });
  }
};