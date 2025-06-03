import { db } from "$lib/server/db";
import { getAccounts } from "$lib/server/db/jobFactory";
import { handleNewAuthorization } from "$lib/server/job-manager";
import { ensureUserIsAuthenticated } from "$lib/server/utils";
import { TokenProvider, CrawlCommand, JobStatus } from "$lib/types";
import { forProvider } from "$lib/utils";
import { getLogger } from "@logtape/logtape";
import { redirect, type RequestHandler } from "@sveltejs/kit";
import AppSettings from "$lib/server/settings";
import { job } from "$lib/server/db/base-schema";
import { eq, and } from "drizzle-orm";

const logger = getLogger(["recheck", "server"]);

export const GET: RequestHandler = async ({ locals }) => {
  // Verify user is authenticated
  if (!ensureUserIsAuthenticated(locals)) {
    logger.warn("Unauthorized recheck attempt - user not authenticated");
    return redirect(301, "/");
  }

  const userId = locals.user!.id!;
  logger.info(`Processing recheck request for user ${userId}`);

  try {
    // Reset GROUP_PROJECT_DISCOVERY jobs
    logger.info(`Resetting GROUP_PROJECT_DISCOVERY jobs for user ${userId}`);
    try {
      const resetResult = await db
        .update(job)
        .set({
          status: JobStatus.queued,
          started_at: null,
          finished_at: null,
          updated_at: new Date(),
          resumeState: null,
          progress: null
        })
        .where(
          and(
            eq(job.userId, userId),
            eq(job.command, CrawlCommand.GROUP_PROJECT_DISCOVERY)
          )
        )
        .returning({ updatedId: job.id });

      logger.info(`Reset ${resetResult.length} GROUP_PROJECT_DISCOVERY jobs for user ${userId}`);
    } catch (e: any) {
      logger.error(`Failed to reset GROUP_PROJECT_DISCOVERY jobs for user ${userId}:`, { error: e });
      // Continue with other recheck operations even if this fails
    }

    // Get all accounts for the current user
    const accounts = await getAccounts(userId);
    let recheckCount = 0;
    
    // Process each GitLab account
    for (const acct of accounts) {
      if (!acct.id || !acct.provider || !acct.token || acct.provider === "credential") {
        continue;
      }
      
      // Only process GitLab accounts
      if (acct.provider.toLowerCase().indexOf("gitlab") < 0) {
        continue;
      }

      // Determine provider type and base URL
      type ProviderTypes = {
        provider: TokenProvider;
        baseUrl: string;
      };

      const opts = forProvider<ProviderTypes>(acct.provider, {
        gitlabCloud: () => {
          const baseUrl = AppSettings().auth.providers.gitlabCloud.baseUrl;
          return {
            provider: TokenProvider.gitlabCloud,
            baseUrl
          };
        },
        gitlabOnPrem: () => {
          const baseUrl = AppSettings().auth.providers.gitlab.baseUrl ?? "";
          return {
            provider: TokenProvider.gitlab,
            baseUrl
          };
        }
      });

      if (!opts || !opts.baseUrl) {
        logger.warn(`Skipping account ${acct.id} due to missing provider configuration`);
        continue;
      }

      const token = acct.token;
      if (!token) {
        logger.warn(`Skipping account ${acct.id} due to missing token`);
        continue;
      }

      // Trigger authorization scope job creation/check using the modern approach
      const apiUrl = `${opts.baseUrl}/api/graphql`;
      logger.info(`Initiating recheck for account ${acct.id} (${acct.provider})`);
      
      await handleNewAuthorization(userId, acct.id, opts.provider, apiUrl);
      recheckCount++;
    }

    logger.info(`Successfully initiated recheck for ${recheckCount} accounts for user ${userId}`);
  } catch (error) {
    logger.error(`Error during recheck for user ${userId}:`, { error });
  }

  // Redirect back to home page after completing the operation
  return redirect(301, "/");
};