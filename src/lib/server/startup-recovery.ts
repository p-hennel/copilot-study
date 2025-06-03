import { getLogger } from "$lib/logging";
import { performComprehensiveJobRecovery } from "$lib/server/job-recovery";

const logger = getLogger(["backend", "startup-recovery"]);

/**
 * Performs job recovery on application startup
 * This addresses the requirement to restore failed jobs when the system restarts
 */
export async function performStartupRecovery(): Promise<void> {
  try {
    logger.info("🚀 STARTUP-RECOVERY: Beginning automatic job recovery on application startup");
    
    // Wait a few seconds for the database to be fully ready
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const result = await performComprehensiveJobRecovery();
    
    if (result.recoveredJobs > 0 || result.failedRecoveries > 0) {
      logger.info("📊 STARTUP-RECOVERY: Recovery completed with results", {
        recovered: result.recoveredJobs,
        failed: result.failedRecoveries,
        skipped: result.skippedJobs,
        errorCount: result.errors.length
      });
      
      if (result.errors.length > 0) {
        logger.warn("⚠️ STARTUP-RECOVERY: Some recovery operations had errors:", {
          errors: result.errors.slice(0, 5) // Log first 5 errors to avoid spam
        });
      }
    } else {
      logger.info("✅ STARTUP-RECOVERY: No jobs required recovery");
    }
    
  } catch (error) {
    logger.error("❌ STARTUP-RECOVERY: Failed to perform startup job recovery:", {
      error: error instanceof Error ? error.message : String(error)
    });
    // Don't throw - startup should continue even if recovery fails
  }
}

/**
 * Sets up periodic job recovery (every 30 minutes)
 */
export function setupPeriodicRecovery(): void {
  const RECOVERY_INTERVAL = 30 * 60 * 1000; // 30 minutes
  
  logger.info("⏰ PERIODIC-RECOVERY: Setting up periodic job recovery", {
    intervalMinutes: RECOVERY_INTERVAL / (60 * 1000)
  });
  
  setInterval(async () => {
    try {
      logger.debug("🔄 PERIODIC-RECOVERY: Running scheduled job recovery");
      const result = await performComprehensiveJobRecovery();
      
      if (result.recoveredJobs > 0) {
        logger.info("📈 PERIODIC-RECOVERY: Recovered jobs during scheduled run", {
          recovered: result.recoveredJobs,
          failed: result.failedRecoveries
        });
      }
    } catch (error) {
      logger.error("❌ PERIODIC-RECOVERY: Error during scheduled recovery:", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }, RECOVERY_INTERVAL);
}