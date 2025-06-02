import { auth } from "$lib/auth";
import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

// Handle GET requests to /logout
export const GET: RequestHandler = async (event) => {
  // Use better-auth's signOut method, passing required context
  await auth.api.signOut({
    // Pass necessary properties from the event object
    headers: event.request.headers
  });

  // Redirect to the homepage after logout
  throw redirect(303, "/");
};
