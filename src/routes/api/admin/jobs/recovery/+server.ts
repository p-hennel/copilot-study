import { json, type RequestHandler } from '@sveltejs/kit';
import { getLogger } from '$lib/logging';
import { isAdmin } from '$lib/server/utils';
import { performComprehensiveJobRecovery, recoverFailedJobs, resetStuckJobs } from '$lib/server/job-recovery';

const logger = getLogger(['backend', 'api', 'jobs', 'recovery']);

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!isAdmin(locals)) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const requestData = await request.json().catch(() => ({})) as { type?: string };
    const { type = 'comprehensive' } = requestData;
    
    logger.info(`🚀 JOB-RECOVERY-API: Starting ${type} job recovery`, {
      userId: locals.user?.id,
      userEmail: locals.user?.email
    });

    let result;
    
    switch (type) {
      case 'failed':
        result = await recoverFailedJobs();
        break;
      case 'stuck':
        result = await resetStuckJobs();
        break;
      case 'comprehensive':
      default:
        result = await performComprehensiveJobRecovery();
        break;
    }

    logger.info(`✅ JOB-RECOVERY-API: ${type} recovery completed`, {
      result,
      userId: locals.user?.id
    });

    return json({
      success: true,
      type,
      result,
      message: `Job recovery completed: ${result.recoveredJobs} recovered, ${result.failedRecoveries} failed, ${result.skippedJobs} skipped`
    });

  } catch (error) {
    logger.error('❌ JOB-RECOVERY-API: Error during job recovery:', {
      error: error instanceof Error ? error.message : String(error),
      userId: locals.user?.id
    });

    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      message: 'Job recovery failed'
    }, { status: 500 });
  }
};

export const GET: RequestHandler = async ({ locals }) => {
  if (!isAdmin(locals)) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  return json({
    availableTypes: ['comprehensive', 'failed', 'stuck'],
    description: {
      comprehensive: 'Recovers both failed and stuck jobs',
      failed: 'Recovers only failed jobs marked as retryable',
      stuck: 'Resets only jobs stuck in running state'
    }
  });
};