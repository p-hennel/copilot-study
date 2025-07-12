
import AppSettings from "$lib/server/settings";
import { dev } from "$app/environment";
import type { LayoutServerLoad } from './$types';

/**
 * Loads layout-level data for all pages.
 * Provides user, session, and dev mode info to the layout component.
 * @param locals - SvelteKit locals (user, session)
 * @returns Data for layout rendering
 */
export const load: LayoutServerLoad = async ({locals}) => {
  return {
    user: locals.user,
    session: locals.session, // Pass session too if needed
    isDev: AppSettings().dev || dev
  };
};
