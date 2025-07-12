import { createAuthClient } from "better-auth/client";
import {
  adminClient,
  apiKeyClient,
  genericOAuthClient,
  jwtClient
} from "better-auth/client/plugins";
import { getLogger } from "@logtape/logtape";
import { TokenProvider } from "./types";


// Central logger for authentication client operations
const logger = getLogger(["auth", "client"]);


/**
 * Shared authentication client instance with all plugins enabled.
 */
export const authClient = createAuthClient({
  plugins: [genericOAuthClient(), jwtClient(), adminClient(), apiKeyClient()]
});


/**
 * Credentials for email/password authentication.
 */
interface Credentials {
  email: string;
  password: string;
}


// Overload declarations for signIn
export async function signIn(provider: TokenProvider, nextUrl: string): Promise<void>;
export async function signIn(credentials: Credentials, nextUrl: string): Promise<void>;

/**
 * Signs in a user using either credentials or an OAuth2 provider.
 * @param arg - TokenProvider or Credentials
 * @param nextUrl - URL to redirect after sign-in
 */
export async function signIn(arg: TokenProvider | Credentials, nextUrl?: string): Promise<void> {
  try {
    if (typeof arg === "object" && "email" in arg && "password" in arg) {
      // Credentials flow using email & password sign-in
      await authClient.signIn.email({
        email: arg.email,
        password: arg.password,
        callbackURL: nextUrl,
        rememberMe: true // adjust as needed
      });
    } else {
      // Provider flow using a TokenProvider
      const provider = arg as TokenProvider;
      await authClient.signIn.oauth2({
        providerId: provider,
        callbackURL: nextUrl
      });
    }
  } catch (error) {
    logger.error("Error during sign in:", { error });
    throw error;
  }
}


/**
 * Links an external OAuth2 account to the current user session.
 * @param provider - The OAuth2 provider to link
 * @param nextUrl - URL to redirect after linking
 */
export async function linkAccount(provider: TokenProvider, nextUrl: string): Promise<void> {
  try {
    await authClient.oauth2.link({
      providerId: provider,
      callbackURL: nextUrl
    });
  } catch (error) {
    logger.error(`Error linking account with provider ${provider}:`, { error, provider });
    throw error;
  }
}
