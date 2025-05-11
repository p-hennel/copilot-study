import { json } from "@sveltejs/kit";
import { getCrawlerStatus } from "$lib/server/supervisor";
export async function GET({ locals }: { locals: App.Locals }) {
  if (!locals.session || !locals.user?.id || locals.user.role !== "admin") {
    return json({ error: "Unauthorized!" }, { status: 401 });
  }

  return json({
    ...getCrawlerStatus()
  });
}
