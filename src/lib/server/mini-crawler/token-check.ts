/**
 * OAuth Token Manager
 *
 * This utility handles checking and refreshing OAuth tokens automatically.
 */

export interface TokenSet {
  accessToken: string
  refreshToken: string
  expiresAt?: number // Optional timestamp when the token expires
}

export interface TokenResponse {
  access_token: string
  refresh_token?: string // Some APIs don't return a new refresh token
  expires_in?: number // Time in seconds until token expires
}

/**
 * Configuration options for the token manager
 */
export interface TokenManagerOptions {
  /** URL for verifying if an access token is valid */
  verifyUrl: string
  /** URL for refreshing an access token using a refresh token */
  refreshUrl: string
  /** Additional headers to include in API requests */
  headers?: Record<string, string>
  /** Client ID for the OAuth application */
  clientId?: string
  /** Client secret for the OAuth application */
  clientSecret?: string
}

/**
 * Check if an access token is still valid by making a request to the verification endpoint
 */
export async function verifyAccessToken(accessToken: string, options: TokenManagerOptions, _fetch: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await _fetch(options.verifyUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...options.headers
      }
    })

    return response.ok // If status code is 2xx, token is valid
  } catch (error) {
    console.error("Error verifying access token:", error)
    return false // Assume token is invalid if verification fails
  }
}

/**
 * Refresh an access token using a refresh token
 */
export async function refreshAccessToken(
  refreshToken: string,
  options: TokenManagerOptions,
  _fetch: typeof fetch = fetch
): Promise<TokenResponse | null> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      ...options.headers
    }

    // Add authorization if client credentials are provided
    if (options.clientId && options.clientSecret) {
      const credentials = Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64")
      headers["Authorization"] = `Basic ${credentials}`
    }

    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })

    // Add client_id to body params if provided but no secret
    if (options.clientId && !options.clientSecret) {
      params.append("client_id", options.clientId)
    }

    const response = await _fetch(options.refreshUrl, {
      method: "POST",
      headers,
      body: params
    })

    if (!response.ok) {
      console.error(response.text())
      //throw new Error(`Failed to refresh token: ${response.statusText}`)
      return null
    } else {
      const data = await response.json()
      return data as TokenResponse
    }
  } catch (error) {
    console.error("Error refreshing token:", error)
    return null
  }
}

/**
 * Manages OAuth tokens by checking validity and refreshing when needed
 *
 * @param accessToken - The current access token
 * @param refreshToken - The refresh token to use if access token needs refreshing
 * @param options - Configuration options for the token manager
 * @returns A Promise resolving to the updated TokenSet or null if refresh fails
 */
export async function manageOAuthToken(
  accessToken: string,
  refreshToken: string,
  options: TokenManagerOptions,
  _fetch: typeof fetch = fetch
): Promise<TokenSet | null> {
  // Check if the current access token is valid
  const isValid = await verifyAccessToken(accessToken, options, _fetch)

  // If access token is valid, return the current tokens
  if (isValid) {
    return {
      accessToken,
      refreshToken
    }
  }

  // If access token is invalid, try to refresh it
  const refreshedTokens = await refreshAccessToken(refreshToken, options, _fetch)

  if (!refreshedTokens) {
    return null // Token refresh failed
  }

  // Calculate token expiration time if provided
  let expiresAt: number | undefined
  if (refreshedTokens.expires_in) {
    expiresAt = Date.now() + refreshedTokens.expires_in * 1000
  }

  // Return the new tokens
  return {
    accessToken: refreshedTokens.access_token,
    // If a new refresh token was provided, use it; otherwise, keep using the old one
    refreshToken: refreshedTokens.refresh_token ?? refreshToken,
    expiresAt
  }
}

/**
  Example usage:

  const tokenManager = async () => {
    const currentTokens = {
      accessToken: "current-access-token",
      refreshToken: "current-refresh-token"
    };

    const options = {
      verifyUrl: "https://api.example.com/oauth/verify",
      refreshUrl: "https://api.example.com/oauth/token",
      clientId: "your-client-id",
      clientSecret: "your-client-secret"
    };

    const updatedTokens = await manageOAuthToken(
      currentTokens.accessToken,
      currentTokens.refreshToken,
      options
    );

    if (updatedTokens) {
      // Save the updated tokens for later use
      saveTokens(updatedTokens);
      return updatedTokens.accessToken;
    } else {
      // Handle failed token refresh (e.g., redirect to login)
      throw new Error("Failed to refresh token");
    }
  };
*/
