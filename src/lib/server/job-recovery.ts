import { getLogger } from "$lib/logging";
import { db } from "$lib/server/db";
import { job as jobSchema } from "$lib/server/db/schema";
import { account } from "$lib/server/db/auth-schema";
import { JobStatus } from "$lib/types";
import { eq, and, or, sql } from "drizzle-orm";
import { startJob } from "$lib/server/supervisor";

const logger = getLogger(["backend", "job-recovery"]);

/**
 * Interface for recovery result reporting
 */
interface JobRecoveryResult {
  recoveredJobs: number;
  failedRecoveries: number;
  skippedJobs: number;
  errors: string[];
}

/**
 * Recovers failed jobs that are marked as retryable
 * This addresses the job queue recovery requirement
 */
export async function recoverFailedJobs(): Promise<JobRecoveryResult> {
  const result: JobRecoveryResult = {
    recoveredJobs: 0,
    failedRecoveries: 0,
    skippedJobs: 0,
    errors: []
  };

  try {
    logger.info("🔄 JOB-RECOVERY: Starting failed job recovery process");

    // Find failed jobs that are marked as retryable
    const failedJobs = await db.query.job.findMany({
      where: and(
        eq(jobSchema.status, JobStatus.failed),
        or(
          // Jobs with retryable flag in progress
          sql`json_extract(${jobSchema.progress}, '$.retryable') = true`,
          // Jobs failed due to DataType mapping issues (now fixed)
          sql`json_extract(${jobSchema.progress}, '$.error') LIKE '%Unknown DataType mapping%'`,
          // Jobs failed due to missing account data (may be recoverable)
          sql`json_extract(${jobSchema.progress}, '$.error') LIKE '%Missing account data%'`,
          // Jobs failed due to token issues (may have been refreshed)
          sql`json_extract(${jobSchema.progress}, '$.error') LIKE '%Missing access token%'`
        )
      ),
      limit: 50 // Process in batches to avoid overwhelming the system
    });

    logger.info(`📊 JOB-RECOVERY: Found ${failedJobs.length} potentially recoverable failed jobs`);

    for (const failedJob of failedJobs) {
      try {
        // Validate job can be recovered
        if (!failedJob.accountId) {
          logger.warn(`⚠️ JOB-RECOVERY: Job ${failedJob.id} missing accountId, skipping`);
          result.skippedJobs++;
          continue;
        }

        // Check if account still exists and is valid
        const accountRecord = await db.query.account.findFirst({
          where: eq(account.id, failedJob.accountId)
        });

        if (!accountRecord || !accountRecord.accessToken) {
          logger.warn(`⚠️ JOB-RECOVERY: Job ${failedJob.id} has invalid/missing account, skipping`);
          result.skippedJobs++;
          continue;
        }

        // Reset job to queued status with recovery metadata
        const recoveryProgress = {
          ...(typeof failedJob.progress === 'object' ? failedJob.progress : {}),
          recoveryAttempt: new Date().toISOString(),
          previousError: typeof failedJob.progress === 'object' && failedJob.progress ? 
            (failedJob.progress as any).error : 'Unknown error',
          retryable: false // Remove retryable flag to prevent infinite retries
        };

        await db.update(jobSchema)
          .set({
            status: JobStatus.queued,
            finished_at: null,
            progress: recoveryProgress,
            updated_at: new Date()
          })
          .where(eq(jobSchema.id, failedJob.id));

        logger.info(`✅ JOB-RECOVERY: Recovered job ${failedJob.id} (${failedJob.command})`);
        result.recoveredJobs++;

        // Attempt to start the job immediately if possible
        try {
          await startJob({
            jobId: failedJob.id,
            fullPath: failedJob.full_path,
            command: failedJob.command,
            accountId: failedJob.accountId
          });
          logger.info(`🚀 JOB-RECOVERY: Started recovered job ${failedJob.id}`);
        } catch (startError) {
          logger.warn(`⚠️ JOB-RECOVERY: Failed to immediately start recovered job ${failedJob.id}:`, { 
            error: startError instanceof Error ? startError.message : String(startError)
          });
          // Job is still queued, so it will be picked up later
        }

      } catch (error) {
        logger.error(`❌ JOB-RECOVERY: Failed to recover job ${failedJob.id}:`, { 
          error: error instanceof Error ? error.message : String(error)
        });
        result.failedRecoveries++;
        result.errors.push(`Job ${failedJob.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    logger.info(`📈 JOB-RECOVERY: Recovery complete. Recovered: ${result.recoveredJobs}, Failed: ${result.failedRecoveries}, Skipped: ${result.skippedJobs}`);
    return result;

  } catch (error) {
    logger.error(`❌ JOB-RECOVERY: Critical error during job recovery:`, { 
      error: error instanceof Error ? error.message : String(error)
    });
    result.errors.push(`Critical error: ${error instanceof Error ? error.message : String(error)}`);
    return result;
  }
}

/**
 * Resets jobs that are stuck in running state (connection lost scenarios)
 */
export async function resetStuckJobs(): Promise<JobRecoveryResult> {
  const result: JobRecoveryResult = {
    recoveredJobs: 0,
    failedRecoveries: 0,
    skippedJobs: 0,
    errors: []
  };

  try {
    logger.info("🔄 JOB-RECOVERY: Checking for stuck running jobs");

    // Find jobs that have been running for more than 2 hours without updates
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    
    const stuckJobs = await db.query.job.findMany({
      where: and(
        eq(jobSchema.status, JobStatus.running),
        sql`${jobSchema.updated_at} < ${twoHoursAgo.toISOString()}`
      ),
      limit: 20
    });

    logger.info(`📊 JOB-RECOVERY: Found ${stuckJobs.length} potentially stuck running jobs`);

    for (const stuckJob of stuckJobs) {
      try {
        await db.update(jobSchema)
          .set({
            status: JobStatus.queued,
            started_at: null,
            progress: {
              ...(typeof stuckJob.progress === 'object' ? stuckJob.progress : {}),
              resetReason: 'stuck_job_recovery',
              resetTimestamp: new Date().toISOString(),
              previousStatus: 'running'
            },
            updated_at: new Date()
          })
          .where(eq(jobSchema.id, stuckJob.id));

        logger.info(`✅ JOB-RECOVERY: Reset stuck job ${stuckJob.id} from running to queued`);
        result.recoveredJobs++;

      } catch (error) {
        logger.error(`❌ JOB-RECOVERY: Failed to reset stuck job ${stuckJob.id}:`, { 
          error: error instanceof Error ? error.message : String(error)
        });
        result.failedRecoveries++;
      }
    }

    return result;

  } catch (error) {
    logger.error(`❌ JOB-RECOVERY: Critical error during stuck job reset:`, { 
      error: error instanceof Error ? error.message : String(error)
    });
    result.errors.push(`Critical error: ${error instanceof Error ? error.message : String(error)}`);
    return result;
  }
}

/**
 * Comprehensive job recovery that handles both failed and stuck jobs
 */
export async function performComprehensiveJobRecovery(): Promise<JobRecoveryResult> {
  logger.info("🚀 JOB-RECOVERY: Starting comprehensive job recovery");

  const failedResult = await recoverFailedJobs();
  const stuckResult = await resetStuckJobs();

  const combinedResult: JobRecoveryResult = {
    recoveredJobs: failedResult.recoveredJobs + stuckResult.recoveredJobs,
    failedRecoveries: failedResult.failedRecoveries + stuckResult.failedRecoveries,
    skippedJobs: failedResult.skippedJobs + stuckResult.skippedJobs,
    errors: [...failedResult.errors, ...stuckResult.errors]
  };

  logger.info(`🎯 JOB-RECOVERY: Comprehensive recovery complete`, {
    totalRecovered: combinedResult.recoveredJobs,
    totalFailed: combinedResult.failedRecoveries,
    totalSkipped: combinedResult.skippedJobs,
    errorCount: combinedResult.errors.length
  });

  return combinedResult;
}