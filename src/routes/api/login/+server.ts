import { authClient } from "$lib/auth-client"
import { json } from "@sveltejs/kit"
import AppSettings from "$lib/server/settings"
import { getLogger } from "$lib/logging" // Import logtape helper

const logger = getLogger(["backend", "api", "login"]) // Logger for this module

async function respondAsJSON(result: any, locals: any) {
  const { data: session } = await authClient.getSession()
  locals.session = session?.session
  locals.user = session?.user
  logger.warn("Login response details", { locals, session }) // Use logger
  return json({
    success: !!result.data && !result.error,
    token: result.data?.token,
    error: result.error
  })
}

export async function GET({ request, url, locals }) {
  const user = url.searchParams.get("user") || ""
  const pw = url.searchParams.get("pw") || ""

  const signIn = await authClient.signIn.email({
    email: user,
    password: pw
  })

  if (
    AppSettings()
      .auth.admins.map((x) => x.email.toLowerCase())
      .includes(user.toLowerCase())
  ) {
    if (signIn.error?.code === "INVALID_EMAIL_OR_PASSWORD") {
      const signUp = await authClient.signUp.email({
        email: user,
        password: pw,
        name: "Admin"
      })
      return await respondAsJSON(signUp, locals)
    }
  }
  return await respondAsJSON(signIn, locals)
}
