import { createAuthClient } from "better-auth/client";
import {
  genericOAuthClient,
  jwtClient,
  adminClient,
  apiKeyClient
} from "better-auth/client/plugins";
import { TokenProvider } from "./utils";

export const authClient = createAuthClient({
  plugins: [genericOAuthClient(), jwtClient(), adminClient(), apiKeyClient()]
});

interface Credentials {
  email: string;
  password: string;
}

// Overload declarations:
export async function signIn(provider: TokenProvider, nextUrl: string): Promise<void>;
export async function signIn(credentials: Credentials, nextUrl: string): Promise<void>;

// Implementation:
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
      if (provider === TokenProvider.gitlabCloud) {
        // For GitLab (using Social sign-in)
        await authClient.signIn.social({
          provider,
          callbackURL: nextUrl
        });
      } else {
        // For Jira (using Generic OAuth)
        await authClient.signIn.oauth2({
          providerId: provider, // Make sure your genericOAuth plugin is configured with these IDs
          callbackURL: nextUrl
        });
      }
    }
  } catch (error) {
    console.error("Error during sign in:", error);
    throw error;
  }
}

export async function linkAccount(provider: TokenProvider, nextUrl: string): Promise<void> {
  try {
    // For GitLab, use the social linking method
    if (provider === TokenProvider.gitlabCloud) {
      await authClient.linkSocial({
        provider, // Social provider (e.g., 'gitlab')
        callbackURL: nextUrl
      });
    } else {
      // For Jira providers, use Generic OAuth linking
      await authClient.oauth2.link({
        providerId: provider, // Ensure your Generic OAuth plugin is configured with these IDs
        callbackURL: nextUrl
      });
    }
  } catch (error) {
    console.error(`Error linking account with provider ${provider}:`, error);
    throw error;
  }
}
