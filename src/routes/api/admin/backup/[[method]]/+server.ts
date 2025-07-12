import { json } from "@sveltejs/kit";
import { sendBackupMail, sendBackupMailViaAPI } from "$lib/server/db/exporter";
import AppSettings from "$lib/server/settings";


// Default backup method and allowed methods
const defaultMethod: string = "api";
const methods = [defaultMethod, "smtp"]


/**
 * GET endpoint to trigger a backup via API or SMTP.
 * Only accessible by admin users.
 * @param locals - SvelteKit locals (session, user)
 * @param params - Route parameters (method)
 */
export async function GET({ locals, params }: { params: any, locals: any }) {
  if (!locals.session || !locals.user?.id || locals.user.role !== "admin") {
    return json({ error: "Unauthorized!" }, { status: 401 });
  }

  let method: string = params.method || "";
  method = method.toLowerCase();

  if (methods.indexOf(method) < 0) {
    method = defaultMethod
  }

  switch (method) {
    case "api":
      await sendBackupMailViaAPI(AppSettings().email.subject.replace("AUTOMATED", "MANUAL"));
      return json({ success: true });
    case "smtp":
      await sendBackupMail(AppSettings().email.subject.replace("AUTOMATED", "MANUAL"));
      return json({ success: true });
    default:
      return json({ error: "Invalid/unimplemented method!" }, { status: 400 });
  }
}
