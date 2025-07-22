import { AppSettings } from "$lib/server/settings";
import { error, json, text } from "@sveltejs/kit";
import { getLogger } from "@logtape/logtape";


// Logger for API init endpoint
const logger = getLogger(["routes","api","dbg"]);

export async function GET({ url }: { url: URL }) {
  try {
    const code = url.searchParams.get("code") || "";

    if (code !== "settings") {
      return error(401, "Not Authorized");
    }

    return json({
      settings: AppSettings.getInstance().getSettings(),
      raw: AppSettings.getInstance().raw()
    })

  } catch (e: any) {
    logger.error(e);
    return text(`error: ${e}`);
  }
}
