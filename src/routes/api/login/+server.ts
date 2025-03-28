import { authClient } from "$lib/auth-client";
import { json } from "@sveltejs/kit";
import AppSettings from "$lib/server/settings";

async function respondAsJSON(result: any, locals: any) {
  const { data: session } = await authClient.getSession();
  locals.session = session?.session;
  locals.user = session?.user;
  console.warn(locals, session);
  return json({
    success: !!result.data && !result.error,
    token: result.data?.token,
    error: result.error
  });
}

export async function GET({ request, url, locals }) {
  const user = url.searchParams.get("user") || "";
  const pw = url.searchParams.get("pw") || "";

  const signIn = await authClient.signIn.email({
    email: user,
    password: pw
  });

  if (AppSettings.auth.admins.map(x => x.email.toLowerCase()).includes(user.toLowerCase())) {
    if (signIn.error?.code === "INVALID_EMAIL_OR_PASSWORD") {
      const signUp = await authClient.signUp.email({
        email: user,
        password: pw,
        name: "Admin"
      });
      return await respondAsJSON(signUp, locals);
    }
  }
  return await respondAsJSON(signIn, locals);
}
