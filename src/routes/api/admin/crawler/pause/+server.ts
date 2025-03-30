import { json } from "@sveltejs/kit"
import { pauseCrawler } from "../../../../../hooks.server"

export async function POST({ locals }: { locals: App.Locals }) {
  if (!locals.session || !locals.user?.id || locals.user.role !== "admin") {
    return json({ error: "Unauthorized!" }, { status: 401 })
  }

  pauseCrawler()

  return json({ success: true })
}
