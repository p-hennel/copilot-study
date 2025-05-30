import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { refreshGitLabTokens } from '$lib/gitlabTokenRefresh';
import { db } from '$lib/server/db/index';
import { eq } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema';

export const POST: RequestHandler = async ({ request }) => {
  console.log('🔄 DEBUG: Token refresh API endpoint called');
  
  try {
    const body = await request.json();
    console.log('🔄 DEBUG: Request body:', JSON.stringify(body, null, 2));
    
    // Type check the request body
    if (typeof body !== 'object' || body === null) {
      console.log('❌ DEBUG: Invalid request body type');
      return json({ error: 'Invalid request body' }, { status: 400 });
    }
    
    const { providerId, accountId, userId, refreshToken } = body as {
      providerId?: string;
      accountId?: string;
      userId?: string;
      refreshToken?: string;
    };

    console.log('🔄 DEBUG: Extracted parameters:', { providerId, accountId, userId, hasRefreshToken: !!refreshToken });

    if (!providerId) {
      console.log('❌ DEBUG: Provider ID missing');
      return json({ error: 'Provider ID is required' }, { status: 400 });
    }

    try {
      console.log('🔄 DEBUG: Using GitLab token refresh for background token refresh...');
      
      // Handle GitLab providers specifically
      if (providerId === 'gitlab' || providerId === 'gitlab-cloud' || providerId === 'gitlab-onprem') {
        let targetUserId = userId;
        
        // If we don't have userId, try to find it from accountId or refreshToken
        if (!targetUserId) {
          if (accountId) {
            console.log('🔄 DEBUG: Looking up userId from accountId:', accountId);
            const accountResult = await db.query.account.findFirst({
              where: eq(schema.account.id, accountId),
              columns: { userId: true }
            });
            
            if (accountResult) {
              targetUserId = accountResult.userId;
              console.log('🔄 DEBUG: Found userId from accountId:', targetUserId);
            }
          } else if (refreshToken) {
            console.log('🔄 DEBUG: Looking up userId from refreshToken');
            const accountResult = await db.query.account.findFirst({
              where: eq(schema.account.refreshToken, refreshToken),
              columns: { userId: true, providerId: true }
            });
            
            if (accountResult) {
              targetUserId = accountResult.userId;
              console.log('🔄 DEBUG: Found userId from refreshToken:', targetUserId, 'provider:', accountResult.providerId);
            }
          } else {
            // If no specific user info is provided, try to find the most recent account for this provider
            console.log('🔄 DEBUG: No user identification provided, looking for most recent account with provider:', providerId);
            const mappedProviderId = providerId === 'gitlab' ? 'gitlab-cloud' : providerId;
            const accountResult = await db.query.account.findFirst({
              where: eq(schema.account.providerId, mappedProviderId),
              columns: { userId: true },
              orderBy: (accounts, { desc }) => [desc(accounts.createdAt)]
            });
            
            if (accountResult) {
              targetUserId = accountResult.userId;
              console.log('🔄 DEBUG: Found most recent userId for provider:', targetUserId);
            }
          }
        }
        
        if (!targetUserId) {
          console.log('❌ DEBUG: Could not determine target user ID');
          return json({ error: 'Could not determine target user ID for token refresh' }, { status: 400 });
        }
        
        // Map provider names to the correct format
        const mappedProviderId = providerId === 'gitlab' ? 'gitlab-cloud' : providerId;
        
        console.log('🔄 DEBUG: Refreshing GitLab tokens for user:', targetUserId, 'provider:', mappedProviderId);
        const refreshResult = await refreshGitLabTokens(targetUserId, mappedProviderId);
        
        if (refreshResult) {
          console.log('✅ DEBUG: GitLab token refresh successful');
          const responseData = {
            success: true,
            accessToken: refreshResult.accessToken,
            expiresAt: refreshResult.accessTokenExpiresAt.toISOString(),
            refreshToken: refreshResult.refreshToken,
            providerId: mappedProviderId
          };
          console.log('✅ DEBUG: Returning response data:', { ...responseData, accessToken: '***', refreshToken: '***' });
          return json(responseData);
        } else {
          console.error('❌ DEBUG: GitLab token refresh failed');
          return json({ error: 'Failed to refresh GitLab token' }, { status: 500 });
        }
      } else {
        console.log('❌ DEBUG: Unsupported provider for background refresh:', providerId);
        return json({ error: `Unsupported provider for background refresh: ${providerId}` }, { status: 400 });
      }
    } catch (refreshError) {
      console.error('❌ DEBUG: Error during token refresh:', refreshError);
      return json({
        error: `Failed to refresh token: ${refreshError instanceof Error ? refreshError.message : 'Unknown refresh error'}`
      }, { status: 500 });
    }
  } catch (error) {
    console.error('❌ DEBUG: Token refresh endpoint error:', error);
    return json({
      error: `Token refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    }, { status: 500 });
  }
};