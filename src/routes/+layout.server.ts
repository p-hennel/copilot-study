import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals }) => {
  // Return the user session data from locals
  // The layout component will receive this in its `data` prop
  return {
    user: locals.user,
    session: locals.session // Pass session too if needed
  };
};
