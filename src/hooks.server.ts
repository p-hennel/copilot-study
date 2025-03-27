import { sequence } from "@sveltejs/kit/hooks";
import type { Handle } from "@sveltejs/kit";
import { auth } from "$lib/auth";
import { svelteKitHandler } from "better-auth/svelte-kit";
import { paraglideMiddleware } from "$lib/paraglide/server";
import { configureLogging } from "$lib/logging";
import "$lib/messaging/MessageBusServer";

const paraglideHandle: Handle = ({ event, resolve }) =>
  paraglideMiddleware(event.request, ({ locale }) => {
    event.locals.locale = locale;
    return resolve(event, {
      transformPageChunk: ({ html }) => html.replace("%lang%", locale)
    });
  });

const authHandle: Handle = ({ event, resolve }) => svelteKitHandler({ event, resolve, auth });
const authHandle2: Handle = async ({ event, resolve }) => {
  // Get the session
  const session = await auth.api.getSession({
    headers: event.request.headers
  });
  // Set session and user to locals
  event.locals.session = session?.session;
  event.locals.user = session?.user;

  const response = await resolve(event);
  return response;
};

export const handle: Handle = sequence(paraglideHandle, authHandle, authHandle2);