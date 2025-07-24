import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { eq } from 'drizzle-orm';
import { job } from '$lib/server/db/base-schema';
import { JobStatus } from '@copima/lib-common';
import { getLogger } from '@logtape/logtape';


// Logger for admin jobs reset endpoint
const logger = getLogger(['api', 'admin', 'jobs', 'reset']);


/**
 * POST endpoint to reset all failed jobs to queued status.
 * Only accessible by admin users.
 * @param locals - SvelteKit locals (session, user)
 */
export async function POST({ locals }: RequestEvent) {
  if (!locals.session || !locals.user?.id || locals.user.role !== 'admin') {
	return json({ error: 'Unauthorized!' }, { status: 401 });
  }

  try {
	const result = await db
	  .update(job)
	  .set({
		status: JobStatus.queued,
		finished_at: null,
		updated_at: new Date()
	  })
	  .where(eq(job.status, JobStatus.failed))
	  .returning();

	logger.info(`Admin reset {count} failed jobs`, {
	  admin: locals.user.email,
	  count: result.length
	});

	return json({
	  success: true,
	  message: `${result.length} failed jobs have been reset to 'queued'.`,
	  resetCount: result.length
	});
  } catch (error) {
	logger.error('Error resetting failed jobs:', { error });
	return json({ error: 'Failed to reset jobs' }, { status: 500 });
  }
}