import { redirect } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ url, locals }) => {
  const pathname = url.pathname;

  // Allow public access for sign-in and sign-up pages
  if (pathname.includes("/admin/sign-in") || pathname.includes("/admin/sign-up")) {
    return {};
  }

  // Check if session exists and if the user has the 'admin' role
  if (!locals.session || !locals.user || !locals.user.role || locals.user.role !== "admin") {
    // Redirect to sign-in if not authenticated or lacks admin role
    throw redirect(302, "/admin/sign-in");
  }

  return {};
};
