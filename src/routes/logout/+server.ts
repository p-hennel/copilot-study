import { auth } from "$lib/auth";
import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";


/**
 * Handles GET requests to /logout.
 * Signs out the user using better-auth and redirects to the homepage.
 * @param event - SvelteKit request event
 */
export const GET: RequestHandler = async (event) => {
  await auth.api.signOut({
    headers: event.request.headers
  });
  // Redirect to homepage after logout
  throw redirect(303, "/");
};
