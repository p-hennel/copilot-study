import { AppSettings } from "$lib/server/settings";
import { error, json, text } from "@sveltejs/kit";
import { getLogger } from "@logtape/logtape";
import { DrizzleDatabaseRepairer } from "$lib/server/db/fixer";
import { getDb } from "$lib/server/db";
import path from "path";

// Logger for API init endpoint
const logger = getLogger(["routes","api","dbg"]);

export async function GET({ url }: { url: URL }) {
  try {
    const code = url.searchParams.get("code") || "";

    switch (code) {
      case "settings":
        return json({
          settings: AppSettings.getInstance().getSettings(),
          raw: AppSettings.getInstance().raw()
        });
      case "db-fix": {
        const repairer = new DrizzleDatabaseRepairer(getDb());
        const result = await repairer.repair();
        return json(result);
      }
      case "errors":
      case "logs": {
        const logFile = Bun.file(path.join(AppSettings.getInstance().getSettings().paths.logs, code === "errors" ? "backend.error.log" : "backend.log"))
        if (! await logFile.exists()) {
          return error(404, "File not found: " + AppSettings.getInstance().getSettings().paths.logs + " " + logFile.name);
        } else {
          return new Response(logFile)
        }
      }
      default:
        return error(401, "Not Authorized");
    }
  } catch (e: any) {
    logger.error(e);
    return text(`error: ${e}`);
  }
}
