import { createAuthClient } from "better-auth/client";
import {
  adminClient,
  apiKeyClient,
  genericOAuthClient,
  jwtClient
} from "better-auth/client/plugins";
import { TokenProvider } from "./types";

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
      await authClient.signIn.oauth2({
        providerId: provider,
        callbackURL: nextUrl
      });
    }
  } catch (error) {
    console.error("Error during sign in:", error);
    throw error;
  }
}

export async function linkAccount(provider: TokenProvider, nextUrl: string): Promise<void> {
  try {
    await authClient.oauth2.link({
      providerId: provider,
      callbackURL: nextUrl
    });
  } catch (error) {
    console.error(`Error linking account with provider ${provider}:`, error);
    throw error;
  }
}
