import { json } from "@sveltejs/kit";
import { sendBackupMail } from "$lib/server/db/exporter";
import AppSettings from "$lib/server/settings";

export async function GET({ locals }) {
  if (!locals.session || !locals.user?.id || locals.user.role !== "admin") {
    // No need to log unauthorized attempts unless debugging specific issues
    return json({ error: "Unauthorized!" }, { status: 401 });
  }

  await sendBackupMail(AppSettings().email.subject.replace("AUTOMATED", "MANUAL"));
  return json({ success: true });
}
