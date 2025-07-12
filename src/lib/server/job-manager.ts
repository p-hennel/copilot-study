import { getLogger } from "$lib/logging";
import { db } from "$lib/server/db";
import AppSettings from "$lib/server/settings";
import {
  area as areaSchema,
  job as jobSchema,
  account as accountSchema
} from "$lib/server/db/schema";
import { forProvider } from "$lib/utils";
import { AreaType, CrawlCommand, JobStatus, TokenProvider } from "$lib/types";
import type { JobInsert } from "$lib/server/db/base-schema"; // Corrected import path for Job
import { and, desc, eq, or } from "drizzle-orm"; // Removed isNull
import { monotonicFactory } from "ulid";

const logger = getLogger(["backend", "job-manager"]);
const ulid = monotonicFactory();
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

interface InitiateGitLabDiscoveryArgs {
  gitlabGraphQLUrl: string;
  userId: string; // User who owns this authorization in our system
  providerId: string; // e.g., "gitlab"
  authorizationDbId: string; // PK of the 'account' table entry for this PAT
}

/**
 * Initiates the GitLab discovery process for a given authorization.
 * Creates or updates a job for group/project discovery.
 */
export async function initiateGitLabDiscovery(args: InitiateGitLabDiscoveryArgs): Promise<void> {
  // 'pat' is no longer used directly in this function, the worker will fetch it.
  const { gitlabGraphQLUrl, userId, providerId, authorizationDbId } = args;
  logger.info(
    `Initiating GitLab discovery for authorization ID ${authorizationDbId} (User: ${userId}, Provider: ${providerId})`
  );

  let currentDiscoveryJobId: string | undefined = undefined;

  try {
    // Check for recent completed jobs for this authorization
    const recentCompletedJob = await db.query.job.findFirst({
      where: and(
        eq(jobSchema.accountId, authorizationDbId),
        eq(jobSchema.command, CrawlCommand.GROUP_PROJECT_DISCOVERY),
        eq(jobSchema.status, JobStatus.finished)
      ),
      orderBy: [desc(jobSchema.updated_at)]
    });

    if (recentCompletedJob && recentCompletedJob.updated_at) {
      const jobAgeMs = Date.now() - new Date(recentCompletedJob.updated_at).getTime();
      if (jobAgeMs < FORTY_EIGHT_HOURS_MS) {
        logger.info(
          `Recent completed GROUP_PROJECT_DISCOVERY job ${recentCompletedJob.id} (updated: ${new Date(recentCompletedJob.updated_at).toISOString()}) found for authorization ${authorizationDbId}. Skipping new discovery run.`
        );
        return; // Return early
      }
      logger.info(
        `Found completed GROUP_PROJECT_DISCOVERY job ${recentCompletedJob.id} for authorization ${authorizationDbId}, but it's older than 48 hours (age: ${jobAgeMs / (60 * 60 * 1000)}h). Proceeding with new/reset job.`
      );
    }

    // Check if a GROUP_PROJECT_DISCOVERY job already exists for this authorization to reset, or create a new one
    const existingJobToReset = await db.query.job.findFirst({
      where: and(
        eq(jobSchema.accountId, authorizationDbId),
        eq(jobSchema.command, CrawlCommand.GROUP_PROJECT_DISCOVERY)
      ),
      orderBy: [desc(jobSchema.updated_at)] // Get the most recent one to reset
    });

    if (existingJobToReset) {
      logger.info(
        `Found existing GROUP_PROJECT_DISCOVERY job ${existingJobToReset.id} for authorization ${authorizationDbId}. Resetting and reusing.`
      );
      await db
        .update(jobSchema)
        .set({
          status: JobStatus.queued,
          resumeState: {}, // Reset cursors
          progress: { // Reset counts and totals
            groupCount: 0,
            projectCount: 0,
            groupTotal: null,
            projectTotal: null
          },
          gitlabGraphQLUrl, // Update in case it changed.
          provider: providerId as TokenProvider, // Ensure provider is also updated
          accountId: authorizationDbId, // Ensure accountId is also updated
          userId, // Ensure userId is also updated
        })
        .where(eq(jobSchema.id, existingJobToReset.id));
      currentDiscoveryJobId = existingJobToReset.id;
    } else {
      currentDiscoveryJobId = ulid();
      const newDiscoveryJobData: JobInsert = {
        id: currentDiscoveryJobId,
        command: CrawlCommand.GROUP_PROJECT_DISCOVERY,
        userId,
        created_at: new Date(),
        provider: providerId as TokenProvider,
        accountId: authorizationDbId, // Account for PAT
        gitlabGraphQLUrl,
        status: JobStatus.queued,
        resumeState: {}, // Store cursors here
        progress: { // Store counts and totals here
          groupCount: 0,
          projectCount: 0,
          groupTotal: null,
          projectTotal: null
        },
        full_path: null, // Not applicable for this command type
        started_at: null,
        finished_at: null,
        branch: null,
        to: null,
        spawned_from: null,
        updated_at: new Date(),
      };
      logger.warn("NEW JOB", { newDiscoveryJobData })
      await db.insert(jobSchema).values(newDiscoveryJobData);
      logger.info(`Created new GROUP_PROJECT_DISCOVERY job ${currentDiscoveryJobId} for authorization ${authorizationDbId}`);
    }

    /*
    await startJob({
      jobId: currentDiscoveryJobId,
      fullPath: null, // GROUP_PROJECT_DISCOVERY is not tied to a specific GitLab path
      command: CrawlCommand.GROUP_PROJECT_DISCOVERY,
      accountId: authorizationDbId // Account ID for PAT fetching by worker
    });
    */

    logger.info(
      `GROUP_PROJECT_DISCOVERY job ${currentDiscoveryJobId} for Authorization: ${authorizationDbId}`
    );
  } catch (error) {
    logger.error(`❌ JOB-MANAGER: Error initiating GitLab discovery or creating/starting job for authorization ${authorizationDbId}:`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      authorizationDbId,
      currentDiscoveryJobId
    });
    
    if (currentDiscoveryJobId) {
      try {
        // Set more detailed failure information for better diagnostics
        const errorMessage = error instanceof Error ? error.message : String(error);
        await db.update(jobSchema)
          .set({
            status: JobStatus.failed,
            progress: {
              error: errorMessage,
              errorType: 'job_manager_initialization_failure',
              timestamp: new Date().toISOString(),
              retryable: true // Mark as retryable for potential recovery
            },
            finished_at: new Date()
          })
          .where(eq(jobSchema.id, currentDiscoveryJobId));
        logger.info(`✅ JOB-MANAGER: Marked GROUP_PROJECT_DISCOVERY job ${currentDiscoveryJobId} as failed with detailed error info.`);
      } catch (dbError) {
        logger.error(`❌ JOB-MANAGER: Failed to update job ${currentDiscoveryJobId} to failed status:`, {
          dbError: dbError instanceof Error ? dbError.message : String(dbError),
          originalError: error instanceof Error ? error.message : String(error)
        });
      }
    }
    
    // Don't throw the error to prevent cascading failures
    logger.warn(`🔄 JOB-MANAGER: Job initialization failed but will not cause system failure for authorization ${authorizationDbId}`);
  }
}

export async function triggerDiscoveryForAccount(userId: string, accountId: string, provider: TokenProvider): Promise<void> {
  type ProviderTypes = {
    provider: TokenProvider;
    baseUrl: string;
  };

  const opts = forProvider<ProviderTypes>(provider, {
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

  if (!opts || !opts.baseUrl) return;

  const apiUrl = `${opts.baseUrl}/api/graphql`;

  await initiateGitLabDiscovery({
      gitlabGraphQLUrl: apiUrl,
      userId,
      providerId: provider,
      authorizationDbId: accountId
    });
}

/**
 * Handles actions when a new authorization is successfully created or updated in the system.
 * This function is the new entry point for triggering GitLab discovery.
 * @param userId The internal system User ID.
 * @param authorizationDbId The unique ID of the authorization record in the database (e.g., from the 'account' table).
 * @param providerId The identifier for the provider (e.g., "gitlab", "gitlab-onprem").
 * @param gitlabGraphQLUrl The GraphQL endpoint for the GitLab instance.
 */
export async function handleNewAuthorization(
  userId: string,
  authorizationDbId: string, // Renamed from accountId for clarity, this is the PK of the 'account' table
  providerId: string,
  gitlabGraphQLUrl: string // New parameter: GitLab GraphQL URL
): Promise<void> {
  logger.info(
    `Handling new authorization: UserID=${userId}, AuthDBID=${authorizationDbId}, Provider=${providerId}`
  );

  try {
    // The logic for initiating discovery is now directly handled by 'initiateGitLabDiscovery',
    // which creates a 'GROUP_PROJECT_DISCOVERY' job.

    await initiateGitLabDiscovery({
      gitlabGraphQLUrl,
      userId,
      providerId,
      authorizationDbId
    });

    logger.info(`Successfully processed new authorization for AuthDBID ${authorizationDbId} and initiated discovery.`);
  } catch (error) {
    logger.error(`Error in handleNewAuthorization for AuthDBID ${authorizationDbId}:`, { error });
  }
}

/**
 * Maps area types and discovered data to actual crawler JobType enum values
 */
const getJobTypesForArea = (areaType: AreaType): CrawlCommand[] => {
  if (areaType === AreaType.group) {
    return [
      CrawlCommand.group, // Maps to GROUP_DETAILS in crawler
      CrawlCommand.groupMembers, // Maps to GROUP_MEMBERS in crawler
      CrawlCommand.groupProjects, // Maps to GROUP_PROJECTS in crawler
      CrawlCommand.groupIssues, // Maps to GROUP_ISSUES in crawler
    ];
  }

  if (areaType === AreaType.project) {
    return [
      CrawlCommand.project, // Maps to PROJECT_DETAILS in crawler
      CrawlCommand.issues, // Maps to PROJECT_ISSUES in crawler
      CrawlCommand.mergeRequests, // Maps to PROJECT_MERGE_REQUESTS in crawler
      CrawlCommand.branches, // Maps to PROJECT_BRANCHES in crawler
      CrawlCommand.pipelines, // Maps to PROJECT_PIPELINES in crawler
    ];
  }

  return [];
};

/**
 * Handles creation of jobs when a new area (group or project) is created/discovered.
 * Updated to create jobs that match what the crawler actually implements.
 * @param areaPath The full path of the group or project
 * @param areaType The type of area (group or project)
 * @param areaId The GitLab ID of the area
 * @param accountId The account ID to use for crawling
 * @param spawningJobId Optional ID of the job that triggered this area handling
 */
export async function handleNewArea(
  areaPath: string,
  areaType: AreaType,
  areaId: string,
  accountId: string,
  spawningJobId?: string,
  parentGitlabGraphQLUrl?: string, // New optional parameter
  parentProvider?: TokenProvider // New optional parameter
): Promise<void> {
  logger.info(`Handling new area: ${areaPath} (${areaType}) with ID ${areaId}${spawningJobId ? ` (spawned by job ${spawningJobId})` : ''}`);

  try {
    // First, check if area already exists in the database
    const existingArea = await db.query.area.findFirst({
      where: eq(areaSchema.full_path, areaPath)
    });

    // If area doesn't exist, create it
    if (!existingArea) {
      logger.info(`Creating new area record for ${areaPath}`);
      await db.insert(areaSchema).values({
        full_path: areaPath,
        gitlab_id: areaId,
        name: areaPath.split('/').pop(), // Extract name from path
        type: areaType
      });
    }

    let effectiveGitlabGraphQLUrl = parentGitlabGraphQLUrl;
    let effectiveProvider = parentProvider;

    if (spawningJobId && !effectiveGitlabGraphQLUrl) {
      // Fetch parent job to get gitlabGraphQLUrl and provider if not directly provided
      const parentJob = await db.query.job.findFirst({
        where: eq(jobSchema.id, spawningJobId),
        with: {
          usingAccount: true // Ensure account is loaded to get provider if needed
        }
      });

      if (parentJob) {
        effectiveGitlabGraphQLUrl = parentJob.gitlabGraphQLUrl ?? undefined;
        effectiveProvider = parentJob.provider ?? undefined;
      }
    }

    // If still no GitLab URL, construct it from AppSettings using the effectiveProvider
    if (!effectiveGitlabGraphQLUrl && effectiveProvider) {
      const opts = forProvider<{ provider: TokenProvider; baseUrl: string }>(effectiveProvider, {
        gitlabCloud: () => ({
          provider: TokenProvider.gitlabCloud,
          baseUrl: AppSettings().auth.providers.gitlabCloud.baseUrl
        }),
        gitlabOnPrem: () => ({
          provider: TokenProvider.gitlab,
          baseUrl: AppSettings().auth.providers.gitlab.baseUrl ?? ""
        })
      });

      if (opts && opts.baseUrl) {
        effectiveGitlabGraphQLUrl = `${opts.baseUrl}/api/graphql`;
      }
    }

    // Create appropriate jobs based on area type
    const jobsToCreate = [];
    const commandsForArea = getJobTypesForArea(areaType);

    logger.info(`Creating jobs for ${areaType} area ${areaPath}: ${commandsForArea.join(', ')}`);

    for (const command of commandsForArea) {
      // Check if a job of this type already exists for this area
      const existingJob = await db.query.job.findFirst({
        where: and(
          eq(jobSchema.full_path, areaPath),
          eq(jobSchema.command, command),
          or(
            eq(jobSchema.status, JobStatus.queued),
            eq(jobSchema.status, JobStatus.running)
          )
        )
      });

      if (!existingJob) {
        logger.debug(`[JobManager] Creating new job for area ${areaPath} with command ${command}. effectiveGitlabGraphQLUrl: ${effectiveGitlabGraphQLUrl}, effectiveProvider: ${effectiveProvider}`);
        jobsToCreate.push({
          id: ulid(),
          accountId,
          full_path: areaPath,
          command, // Use the actual CrawlCommand enum value that matches crawler JobType
          status: JobStatus.queued,
          spawned_from: spawningJobId,
          gitlabGraphQLUrl: effectiveGitlabGraphQLUrl, // Use the determined URL
          userId: undefined, // parentJob is not in scope, so set to undefined or fetch from context if available
          provider: effectiveProvider, // Use the determined provider
        });
      } else {
        logger.debug(`Job of type ${command} already exists for area ${areaPath}, skipping`);
      }
    }

    // Insert all new jobs
    if (jobsToCreate.length > 0) {
      logger.info(`Creating ${jobsToCreate.length} new jobs for area ${areaPath}`);
      logger.debug(`[JobManager] Jobs to create:`, { jobsToCreate });
      // TEMP DEBUG LOGGING: Output parent-child relationship and gitlabGraphQLUrl for each job
      for (const job of jobsToCreate) {
        logger.info(
          `[TEMP DIAG] Job creation: id=${job.id}, parentJobId=${job.spawned_from}, gitlabGraphQLUrl=${job.gitlabGraphQLUrl}`
        );
      }
      await db.insert(jobSchema).values(jobsToCreate);

      /*
      for (const jobData of jobsToCreate) {
        await startJob({
          jobId: jobData.id,
          fullPath: jobData.full_path,
          command: jobData.command,
          accountId: jobData.accountId
        });
      }
      */
      logger.info(`Successfully created ${jobsToCreate.length} jobs for area ${areaPath}`);
    } else {
      logger.info(`No new jobs needed for area ${areaPath} - all necessary jobs already exist`);
    }
  } catch (error) {
    logger.error(`Error handling new area ${areaPath}:`, { error });
  }
}

/**
 * Processes an IPC message about a new area being discovered
 * @param message The IPC message with area information
 */
export async function handleIpcAreaDiscovery(message: any): Promise<void> {
  if (!message || typeof message !== 'object') {
    logger.error('Invalid IPC message received');
    return;
  }

  const { areaPath, areaType, areaId, accountId } = message;

  if (!areaPath || !areaType || !areaId || !accountId) {
    logger.error('Missing required fields in IPC area discovery message', { message });
    return;
  }

  // Validate area type
  if (areaType !== AreaType.group && areaType !== AreaType.project) {
    logger.error(`Invalid area type: ${areaType}`, { message });
    return;
  }

  // Fetch the most recent GROUP_PROJECT_DISCOVERY job for this account to get gitlabGraphQLUrl and provider
  const discoveryJob = await db.query.job.findFirst({
    where: and(
      eq(jobSchema.accountId, accountId),
      eq(jobSchema.command, CrawlCommand.GROUP_PROJECT_DISCOVERY)
    ),
    orderBy: [desc(jobSchema.created_at)]
  });

  let effectiveGitlabGraphQLUrl: string | undefined;
  let effectiveProvider: TokenProvider | undefined;

  if (discoveryJob) {
    effectiveGitlabGraphQLUrl = discoveryJob.gitlabGraphQLUrl ?? undefined;
    effectiveProvider = discoveryJob.provider ?? undefined;
  } else {
    // Fallback: if no discovery job found, try to construct from AppSettings based on provider from account
    const accountRecord = await db.query.account.findFirst({
      where: eq(accountSchema.id, accountId),
    });

    if (accountRecord && accountRecord.providerId) {
      const opts = forProvider<{ provider: TokenProvider; baseUrl: string }>(accountRecord.providerId as TokenProvider, {
        gitlabCloud: () => ({
          provider: TokenProvider.gitlabCloud,
          baseUrl: AppSettings().auth.providers.gitlabCloud.baseUrl
        }),
        gitlabOnPrem: () => ({
          provider: TokenProvider.gitlab,
          baseUrl: AppSettings().auth.providers.gitlab.baseUrl ?? ""
        })
      });

      if (opts && opts.baseUrl) {
        effectiveGitlabGraphQLUrl = `${opts.baseUrl}/api/graphql`;
        effectiveProvider = accountRecord.providerId as TokenProvider;
      }
    }
  }

  if (!effectiveGitlabGraphQLUrl || !effectiveProvider) {
    logger.error(`Could not determine GitLab URL or provider for account ${accountId} during IPC area discovery.`);
    return;
  }

  await handleNewArea(
    areaPath,
    areaType,
    areaId,
    accountId,
    undefined, // spawningJobId is not relevant for direct IPC calls for IPC discovery
    effectiveGitlabGraphQLUrl,
    effectiveProvider
  );
}
