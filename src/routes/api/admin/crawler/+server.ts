import { json } from "@sveltejs/kit";
import { getLogger } from "$lib/logging";
import { isAdmin } from "$lib/server/utils";
import { jobService } from "$lib/server/socket/services/job-service.js";

const logger = getLogger(["backend", "api", "admin", "crawler"]);

export async function GET({ locals }: { locals: App.Locals }) {
  const adminCheck = await isAdmin(locals);
  if (!adminCheck) {
    logger.warn("Unauthorized attempt to access crawler API");
    return json({ error: "Admin access required" }, { status: 401 });
  }

  try {
    // Get real-time job statistics from database
    const jobStats = await jobService.getJobQueueStats();
    const runningCount = await jobService.getRunningJobsCount();
    
    const crawlerStatus = {
      // Core status
      state: runningCount > 0 ? 'running' : jobStats.queued > 0 ? 'queued' : 'idle',
      isRunning: runningCount > 0,
      paused: false, // TODO: Implement pause/resume functionality
      
      // Job counts
      queued: jobStats.queued,
      running: jobStats.running,
      processing: runningCount,
      completed: jobStats.completed,
      failed: jobStats.failed,
      
      // System info
      lastUpdate: new Date().toISOString(),
      systemStatus: runningCount > 0 ? 'processing' : 'idle'
    };
    
    logger.info("Crawler status requested", { status: crawlerStatus });
    return json(crawlerStatus);
    
  } catch (error) {
    logger.error("Error fetching crawler status:", { error });
    return json(
      { error: "Failed to fetch crawler status" }, 
      { status: 500 }
    );
  }
}
