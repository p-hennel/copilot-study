import { AppSettings } from "$lib/server/settings";
import { error, json, text } from "@sveltejs/kit";
import { getLogger } from "@logtape/logtape";
import { DrizzleDatabaseRepairer } from "$lib/server/db/fixer";
import { getDb } from "$lib/server/db";
import path from "path";
import { open, exists } from 'node:fs/promises'
import { account } from "$lib/server/db/auth-schema";

// Logger for API init endpoint
const logger = getLogger(["routes","api","dbg"]);

const toFileResponse = async (filePath: string) => {
  if (!(await exists(filePath))) {
    return error(404, "File not found: " + filePath);
  }

  const fileHandle = await open(filePath);
  // @ts-expect-error: @types/node doesn't know this yet
  const fileStream = fileHandle.readableWebStream({ autoClose: true }) as BodyInit
  return new Response(fileStream, {
      status: 200,
      headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition':
              // Use filename* instead of filename to support non-ASCII characters
              `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(filePath))}`,
      },
  })
}

export async function GET({ url }: { url: URL }) {
  try {
    const code = url.searchParams.get("code") || "";

    switch (code) {
      case "settings":
        return json({
          settings: AppSettings.getInstance().getSettings(),
          raw: AppSettings.getInstance().raw()
        });
      case "settings-file":
        return toFileResponse(AppSettings.getInstance().filePath);
      case "db-fix": {
        const repairer = new DrizzleDatabaseRepairer(getDb());
        const result = await repairer.repair();
        return json(result);
      }
      case "accounts": {
        const db = getDb();
        const accounts = await db.select().from(account)
        return json({ accounts });
      }
      case "db-file": {
        const filePath = AppSettings.getInstance().getSettings().paths.database?.replace("file://", "").replace("sqlite://", "") || "";
        return toFileResponse(filePath);
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
