
import { auth } from "$lib/auth";
import { paraglideMiddleware } from "$lib/paraglide/server";
import type { Handle } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";
import { svelteKitHandler } from "better-auth/svelte-kit";
import { initialLogger, prepareSocketLocation } from "$lib/startup/initialize";

// Prepare the socket location for inter-process communication (if needed)
prepareSocketLocation();

// Initialize the logger for use in hooks
const logger = await initialLogger();

/**
 * SvelteKit handle for locale-aware routing using paraglide.
 * Injects the detected locale into event.locals and transforms the HTML output.
 */
const paraglideHandle: Handle = ({ event, resolve }) =>
  paraglideMiddleware(event.request, ({ locale }) => {
    event.locals.locale = locale;
    return resolve(event, {
      transformPageChunk: ({ html }) => html.replace("%lang%", locale)
    });
  });

/**
 * SvelteKit handle for authentication using better-auth.
 * Allows bypass for internal refresh-token requests from unix socket.
 */
const authHandle: Handle = ({ event, resolve }) => {
  if (
    event.url.pathname.includes('/api/internal/refresh-token') &&
    event.request.headers.get('x-request-source') === 'unix'
  ) {
    return resolve(event);
  }
  return svelteKitHandler({ event, resolve, auth });
};

/**
 * SvelteKit handle to attach session and user to event.locals.
 * Handles errors and ensures sign-out on session retrieval failure.
 */
const authHandle2: Handle = async ({ event, resolve }) => {
  if (
    event.url.pathname.includes('/api/internal/refresh-token') &&
    event.request.headers.get('x-request-source') === 'unix'
  ) {
    return await resolve(event);
  }
  try {
    const session = await auth.api.getSession({ headers: event.request.headers });
    event.locals.session = session?.session;
    event.locals.user = session?.user;
  } catch (error) {
    logger.error("Error getting session:", { error });
    auth.api.signOut({ headers: event.request.headers });
  } finally {
    return await resolve(event);
  }
};

/**
 * SvelteKit handle for CORS (Cross-Origin Resource Sharing).
 * Handles preflight OPTIONS requests and sets CORS headers on all responses.
 */
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

/**
 * SvelteKit handle to extract request source from headers and attach to event.locals.
 * Used to distinguish between socket and HTTP requests.
 */
export async function reqSourceHandle({ event, resolve }: { event: any; resolve: any }) {
  // Get the request source from the header we added
  const requestSource = event.request.headers.get('x-request-source') || 'unknown';

  // Add to locals for use in routes
  event.locals.requestSource = requestSource;
  event.locals.isSocketRequest = requestSource === 'unix';

  /*
  // Example: Restrict access to internal API routes unless from socket or admin
  if (
    event.url.pathname.startsWith('/api/internal') &&
    !event.locals.isSocketRequest &&
    !isAdmin(event.locals)
  ) {
    return new Response('Forbidden', { status: 403 });
  }
  */

  return await resolve(event);
}

// Compose all handles in the desired order for SvelteKit
export const handle: Handle = sequence(
  corsHandle,
  paraglideHandle,
  authHandle,
  reqSourceHandle,
  authHandle2
);