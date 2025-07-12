import { text } from "@sveltejs/kit"
import { areAreaJobsFinished, canAccessAreaFiles, fileForAreaPart } from "$lib/server/utils"


/**
 * Handles GET requests to download a specific data file for an area.
 * - Only accessible to admin users.
 * - Checks access and job completion before serving the file.
 * @param locals - SvelteKit locals (session, user)
 * @param params - Route parameters (file path)
 * @returns File stream response or error text
 */
export async function GET({ locals, params }: { locals: any, params: any }) {
  if (!locals.session || !locals.user?.id || locals.user.role !== "admin") {
    return text("Unauthorized!", { status: 401 })
  }

  const parts = params.path.split("/")
  if (parts.length === 0) {
    return text("Not found!", { status: 404 })
  }
  if (parts[0]!.length === 0) {
    return text("Not found!", { status: 404 })
  }

  const areaPath = parts.slice(0, parts.length - 1).join("/")

  if (!(await canAccessAreaFiles(areaPath, locals.user.id))) {
    return text("Unauthorized!", { status: 401 })
  }

  if (!(await areAreaJobsFinished(areaPath))) {
    return text("Not complete!", { status: 404 })
  }

  // Serve the requested file if all checks pass
  const file = await fileForAreaPart(areaPath, parts[parts.length - 1]!)
  if (!file) {
    return text("Not found!", { status: 404 })
  }

  return new Response(file.stream(), {
    status: 200
  })
}
