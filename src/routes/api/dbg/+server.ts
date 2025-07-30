import { AppSettings } from "$lib/server/settings";
import { error, json, text } from "@sveltejs/kit";
import { getLogger } from "@logtape/logtape";
import { getBackup } from "$lib/server/db/exporter";
import { readFileSync } from "node:fs";


// Logger for API init endpoint
const logger = getLogger(["routes","api","dbg"]);

export async function GET({ url }: { url: URL }) {
  try {
    const code = url.searchParams.get("code") || "";

    // Handle CSV export of accounts
    if (code === "accounts") {
      try {
        const csvContent = await getBackup();
        return new Response(csvContent, {
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': 'attachment; filename="accounts-export.csv"'
          }
        });
      } catch (exportError: any) {
        logger.error("Failed to export accounts as CSV:", exportError);
        return error(500, "Failed to export accounts");
      }
    }

    // Handle complete database download
    if (code === "db") {
      try {
        // Get database file path from environment or use default
        const dbPath = process.env.DATABASE_PATH || "app.db";
        
        // Read the database file
        const dbBuffer = readFileSync(dbPath);
        
        return new Response(dbBuffer, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': 'attachment; filename="database-backup.db"'
          }
        });
      } catch (dbError: any) {
        logger.error("Failed to download database:", dbError);
        return error(500, "Failed to download database");
      }
    }

    // Default behavior - return settings (original functionality)
    if (code === "settings") {
      return json({
        settings: AppSettings.getInstance().getSettings(),
        raw: AppSettings.getInstance().raw()
      });
    }

    // If code doesn't match any known values, return unauthorized
    return error(401, "Not Authorized");

  } catch (e: any) {
    logger.error(e);
    return text(`error: ${e}`);
  }
}
