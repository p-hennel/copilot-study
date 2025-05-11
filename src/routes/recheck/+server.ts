import { db } from "$lib/server/db";
import { account } from "$lib/server/db/auth-schema";
import { job } from "$lib/server/db/base-schema"; // area and getLogger are no longer used here
// Group, Project, fetchAllGroupsAndProjects, AreaType are no longer used here
import { initiateGitLabDiscovery } from "$lib/server/job-manager";
import AppSettings from "$lib/server/settings";
import { getLogger } from "@logtape/logtape"; // Import getLogger
import { redirect, type RequestHandler } from "@sveltejs/kit";
import { eq } from "drizzle-orm";

export const GET: RequestHandler = async ({ locals }) => { // Removed unused 'fetch'
  if (true) // || !locals.session || !locals.user || !locals.user.id)
    return redirect(301, "/");
  const _job = (
    await db
      .select({
        id: job.id,
        status: job.status,
        progress: job.progress,
        token: account.accessToken,
        tokenExpiresAt: account.accessTokenExpiresAt,
        refresher: account.refreshToken,
        refreshTokenExpiresAt: account.refreshTokenExpiresAt,
        authorizationDbId: account.id, // This is the account.id, to be used as authorizationDbId
        providerId: account.providerId // Assuming account table has providerId
      })
      .from(job)
      .innerJoin(account, eq(account.id, job.accountId))
      .where(eq(account.userId, locals.user.id)) // Ensure locals.user.id is valid
      .limit(1)
  ).at(0);

  // Ensure _job is defined before trying to access its properties
  if (_job) {
    // All logic depending on _job is now inside this block
    // Use _job directly as its type is narrowed within this block.

    // _job is defined in this block.
    // _job is defined in this block.
    if (typeof _job.progress === "string") { // Check if progress is a string
      try {
        // Since _job is defined, and _job.progress is checked as string, this should be safe.
        _job.progress = JSON.parse(_job.progress) as any;
      } catch (e) {
        const errorLogger = getLogger(["recheck", "progress-parse-error"]);
        // Use non-null assertion for _job.progress if TS still complains, though typeof check should suffice.
        errorLogger.error("Failed to parse job progress JSON", { progress: _job.progress!, error: e });
      }
    }

    const userId = locals.user?.id;
    // The properties of _job are accessed after _job itself is confirmed to be defined.
    // The if condition below checks for their specific truthiness (non-null, non-empty string etc.)
    if (userId && _job.token && _job.refresher && _job.authorizationDbId && _job.providerId) {
      const gitlabGraphQLUrl = `${AppSettings().auth.providers.gitlab.baseUrl}/api/graphql`;
      // All parameters for initiateGitLabDiscovery are confirmed to be truthy (and thus correctly typed) here.
      await initiateGitLabDiscovery({
        pat: _job.token,
        gitlabGraphQLUrl,
        userId: userId,
        providerId: _job.providerId,
        authorizationDbId: _job.authorizationDbId
      });
    } else {
      const logger = getLogger(["recheck", "initiate-discovery-missing-data"]);
      logger.warn("Could not initiate discovery due to missing data fields.", {
        userIdExists: !!userId,
        // Use non-null assertions if TS still complains about _job being possibly undefined here,
        // though it's inside the `if (_job)` block.
        tokenExists: !!_job.token,
        refresherExists: !!_job.refresher,
        authDbIdExists: !!_job.authorizationDbId,
        providerIdExists: !!_job.providerId
      });
    }
  } else {
    const logger = getLogger(["recheck", "job-not-found"]);
    logger.warn("No job found for the current user to recheck.");
  }

  return redirect(301, "/");
};
