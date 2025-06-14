import { auth } from "$lib/auth"
import { paraglideMiddleware } from "$lib/paraglide/server"
import type { Handle } from "@sveltejs/kit"
import { sequence } from "@sveltejs/kit/hooks"
import { svelteKitHandler } from "better-auth/svelte-kit"
import AppSettings, { type Settings } from "$lib/server/settings"
import { isAdmin, syncAdminRoles } from "$lib/server/utils" // Import syncAdminRoles function
import { configureLogging } from "$lib/logging"
import type { Logger } from "@logtape/logtape"
import doMigration from '$lib/server/db/migration'
import { existsSync } from "node:fs"
import path from "node:path"
import { mkdirSync } from "fs";
import { performStartupRecovery, setupPeriodicRecovery } from "$lib/server/startup-recovery";
import { isAuthorizedSocketRequest } from "$lib/server/direct-auth";

// Import direct communication manager instead of supervisor
import "$lib/server/direct-communication-manager";

// Set up socket path for external crawler connection
if (!process.env.SOCKET_PATH) {
  const socketDir = path.join(process.cwd(), "data.private", "config");
  process.env.SOCKET_PATH = path.join(socketDir, "api.sock");
  
  // Ensure socket directory exists
  if (!existsSync(socketDir)) {
    mkdirSync(socketDir, { recursive: true });
  }
}

const bunHomeData = path.join("/", "home", "bun", "data")
const logsDir = path.join(bunHomeData, "logs")
if (existsSync(bunHomeData) && !existsSync(logsDir)) {
  mkdirSync(logsDir)
}
const settings = AppSettings()
const logger: Logger = await configureLogging("backend", existsSync(logsDir) ? logsDir : process.cwd())

if (logger === null) {
  // Can't use logger here since it failed to initialize
  throw new Error("CRITICAL: Logger initialization failed. Cannot set up event listeners.")
}

logger.debug("bunHomeData", { bunHomeData })

try {
  if (settings) doMigration(settings.paths.database)
} catch (error) {
  logger.error("Error during migration:", { error })
}

// Perform startup job recovery after migration
try {
  setTimeout(async () => {
    await performStartupRecovery();
    setupPeriodicRecovery();
  }, 2000); // Run after admin roles sync
} catch (error) {
  logger.error("Error setting up job recovery:", { error })
}

try {
  setTimeout(syncAdminRoles, 1000)
} catch (error) { logger.error("CRITICAL: Failed to initialize logging or AppSettings"); logger.error(error as any) }

const paraglideHandle: Handle = ({ event, resolve }) =>
  paraglideMiddleware(event.request, ({ locale }) => {
    event.locals.locale = locale
    return resolve(event, {
      transformPageChunk: ({ html }) => html.replace("%lang%", locale)
    })
  })

const authHandle: Handle = ({ event, resolve }) => {
  // Enhanced auth bypass for direct socket requests
  if (event.url.pathname.includes('/api/internal/') &&
      isAuthorizedSocketRequest(event.request)) {
    return resolve(event);
  }
  
  return svelteKitHandler({ event, resolve, auth });
}

const authHandle2: Handle = async ({ event, resolve }) => {
  // Enhanced session bypass for direct socket requests
  if (event.url.pathname.includes('/api/internal/') &&
      isAuthorizedSocketRequest(event.request)) {
    return await resolve(event);
  }
  
  try {
    const session = await auth.api.getSession({ headers: event.request.headers })
    event.locals.session = session?.session
    event.locals.user = session?.user
  } catch (error) {
    logger.error("Error getting session:", { error })
    auth.api.signOut({ headers: event.request.headers })
  } finally {
    return await resolve(event)
  }
}

export const corsHandle: Handle = async ({ event, resolve }) => {
  if (event.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });
  }

  const response = await resolve(event);

  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  return response;
};

export async function reqSourceHandle({ event, resolve }: {event: any, resolve: any}) {
  // Get the request source from the header
  const requestSource = event.request.headers.get('x-request-source') || 'unknown';
  
  // Add to locals for use in routes
  event.locals.requestSource = requestSource;
  
  // Enhanced socket request detection using DirectSocketAuth
  event.locals.isSocketRequest = isAuthorizedSocketRequest(event.request);
  
  // Log socket requests for debugging
  if (event.locals.isSocketRequest) {
    logger.debug("Authorized socket request detected", {
      path: event.url.pathname,
      method: event.request.method,
      requestSource,
      clientId: event.request.headers.get('x-client-id')
    });
  }
  
  return await resolve(event);
}

// Updated handle sequence using the new authentication system
export const handle: Handle = sequence(corsHandle, paraglideHandle, authHandle, reqSourceHandle, authHandle2)