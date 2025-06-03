import { json } from "@sveltejs/kit";
import { resumeCrawler } from "$lib/server/direct-communication-manager";

export async function POST({ locals }: { locals: App.Locals }) {
  if (!locals.session || !locals.user?.id || locals.user.role !== "admin") {
    return json({ error: "Unauthorized!" }, { status: 401 });
  }

  resumeCrawler();

  return json({ success: true });
}
