import { auth } from "$lib/auth"
import { paraglideMiddleware } from "$lib/paraglide/server"
import type { Handle } from "@sveltejs/kit"
import { sequence } from "@sveltejs/kit/hooks"
import { svelteKitHandler } from "better-auth/svelte-kit"

import { initialLogger, prepareSocketLocation } from "$lib/startup/initialize"

prepareSocketLocation()

const logger = await initialLogger()

const paraglideHandle: Handle = ({ event, resolve }) =>
  paraglideMiddleware(event.request, ({ locale }) => {
    event.locals.locale = locale
    return resolve(event, {
      transformPageChunk: ({ html }) => html.replace("%lang%", locale)
    })
  })

const authHandle: Handle = ({ event, resolve }) => {
  if (event.url.pathname.includes('/api/internal/refresh-token') &&
      event.request.headers.get('x-request-source') === 'unix') {
    return resolve(event);
  }
  
  return svelteKitHandler({ event, resolve, auth });
}
const authHandle2: Handle = async ({ event, resolve }) => {
  if (event.url.pathname.includes('/api/internal/refresh-token') &&
      event.request.headers.get('x-request-source') === 'unix') {
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
  // Get the request source from the header we added
  const requestSource = event.request.headers.get('x-request-source') || 'unknown';
  
  // Add to locals for use in routes
  event.locals.requestSource = requestSource;
  event.locals.isSocketRequest = requestSource === 'unix';

  /*
  if (event.url.pathname.startsWith('/api/internal') && !event.locals.isSocketRequest && !isAdmin(event.locals)) {
    return new Response('Forbidden', { status: 403 });
  }
  */
  
  return await resolve(event);
}

//export const handle: Handle = sequence(corsHandle, paraglideHandle, authHandle, authHandle2, reqSourceHandle)
export const handle: Handle = sequence(corsHandle, paraglideHandle, authHandle, reqSourceHandle, authHandle2)