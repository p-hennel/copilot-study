
// Utility to remove locale from URLs for routing purposes
import { deLocalizeUrl } from "$lib/paraglide/runtime";

/**
 * Returns the pathname of a request URL with locale removed.
 * @param request - The incoming HTTP request
 * @returns The de-localized pathname
 */
export const reroute = (request: Request) => deLocalizeUrl(request.url).pathname;

// Placeholder for future transport logic (e.g., event bus, message passing)
export const transport = {};
