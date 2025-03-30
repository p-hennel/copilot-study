import { auth } from "$lib/auth";
import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

// Handle GET requests to /logout
export const GET: RequestHandler = async (event) => {
  // Use better-auth's signOut method, passing required context
  await auth.api.signOut({
    // Pass necessary properties from the event object
    headers: event.request.headers,
    cookies: event.cookies
    // Add other properties if required by signOut's specific InputContext type
  });

  // Redirect to the homepage after logout
  throw redirect(303, "/");
};

// Optionally, handle POST if you prefer form submission,
// but GET is simpler for a direct link click.
// export const POST: RequestHandler = async ({ cookies }) => {
//   await auth.api.signOut({ cookies });
//   throw redirect(303, '/');
// };
