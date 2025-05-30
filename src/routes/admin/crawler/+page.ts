import { authClient } from "$lib/auth-client";
import { fetchAdminData } from "$lib/utils/admin-fetch";
import { getCachedStatus } from "$lib/stores/crawler-cache";

export async function load(event) {
  const token = authClient.getSession().then((response) => response.data?.session.token);
  
  // Get cached data for immediate display
  const cachedStatus = getCachedStatus();

  return {
    crawler: fetchAdminData(event.fetch, "crawler", token, { description: "Loading crawler status..." }),
    sessiontoken: token,
    cached: {
      status: cachedStatus.status,
      lastHeartbeat: cachedStatus.lastHeartbeat?.toISOString() || null,
      lastStatusUpdate: cachedStatus.lastStatusUpdate?.toISOString() || null,
      jobFailureLogs: cachedStatus.jobFailureLogs,
      isHealthy: cachedStatus.isHealthy,
      sseConnected: cachedStatus.sseConnected,
      messageBusConnected: cachedStatus.messageBusConnected
    }
  };
}