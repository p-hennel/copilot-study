import { json } from '@sveltejs/kit';
import { getFolderSizeWithAvailableSpace } from '$lib/utils/folder-size';
import { getLogger } from "@logtape/logtape";
import AppSettings from '$lib/server/settings';

const logger = getLogger(["api", "admin", "storage"]);

export async function GET() {
  try {
    // Calculate storage for the project directory
    const storageData = await getFolderSizeWithAvailableSpace(AppSettings().paths.dataRoot, {
      maxCacheAge: 10 * 60 * 1000, // 10 minutes cache
      includeHidden: false
    });
    
    logger.info("Storage data calculated via API", { 
      used: storageData.used, 
      available: storageData.available,
      total: storageData.total
    });
    
    return json(storageData);
  } catch (error) {
    logger.error("Failed to calculate storage data via API: {error}", { error });
    
    // Return fallback data on error
    return json({
      used: 0,
      available: 0,
      total: 0,
      error: "Failed to calculate storage data"
    }, { status: 500 });
  }
}