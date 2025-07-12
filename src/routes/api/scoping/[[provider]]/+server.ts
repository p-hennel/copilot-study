import { db } from "$lib/server/db";
import { job as jobSchema } from "$lib/server/db/base-schema"; // Changed from tokenScopeJob to job
import { unauthorizedResponse } from "$lib/server/utils";
import { TokenProvider, CrawlCommand, JobStatus } from "$lib/types"; // Added CrawlCommand and JobStatus
import { json } from "@sveltejs/kit";
import { and, eq } from "drizzle-orm";
import { getLogger } from "@logtape/logtape";

// Logger for scoping API endpoint
const logger = getLogger(["routes","api","scoping","[[provider]]"]);

/**
 * API endpoint to get the status of a GROUP_PROJECT_DISCOVERY job for a given provider.
 * Returns job progress and completion status for the current user.
 * @param provider - The provider to check (gitlab, jira, etc.)
 * @param locals - SvelteKit locals (session, user)
 */
export async function GET({ params: { provider }, locals }: { params: { provider: string }, locals: any }) {
  if (!locals.session || !locals.user || !locals.user.id) return unauthorizedResponse();

  if (!provider || provider.length <= 0) return json(undefined, { status: 400 });

  provider = provider.toLowerCase();
  let _provider: TokenProvider;
  if (provider === "gitlab" || provider === "gitlab-cloud") {
    _provider = TokenProvider.gitlabCloud;
  } else if (provider === "gitlab-onprem") {
    _provider = TokenProvider.gitlab;
  } else if (provider === "jira") {
    _provider = TokenProvider.jira;
  } else if (provider === "jiraCloud") {
    _provider = TokenProvider.jiraCloud;
  } else {
    logger.info("unknown provider", {provider});
    return json(undefined, { status: 400 });
  }

  const jobRecord = await db.query.job.findFirst({
    columns: {
      provider: true,
      created_at: true,
      updated_at: true,
      status: true,
      progress: true,
      command: true
    },
    where: and(
      eq(jobSchema.userId, locals.user.id),
      eq(jobSchema.provider, _provider),
      eq(jobSchema.command, CrawlCommand.GROUP_PROJECT_DISCOVERY)
    )
  });

  if (!jobRecord) return json(undefined, { status: 404 });

  // Transform the jobRecord to the expected output structure
  const progressData = jobRecord.progress as { groupCount?: number, projectCount?: number, groupTotal?: number, projectTotal?: number } | null;

  const responseJob = {
    provider: jobRecord.provider,
    createdAt: jobRecord.created_at,
    updated_at: jobRecord.updated_at,
    isComplete: jobRecord.status === JobStatus.finished,
    groupCount: progressData?.groupCount || 0,
    projectCount: progressData?.projectCount || 0,
    groupTotal: progressData?.groupTotal || null,
    projectTotal: progressData?.projectTotal || null
  };

  return json(responseJob);
}
// Ensure the closing brace for the GET function is present if it was removed by the diff
