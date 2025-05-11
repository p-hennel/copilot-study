import { getLogger } from "$lib/logging";
import { db } from "$lib/server/db";
import {
  area as areaSchema,
  job as jobSchema,
  tokenScopeJob as tokenScopeJobSchema
  // account as accountSchema // No longer directly used here to fetch PAT
} from "$lib/server/db/schema";
import { AreaType, CrawlCommand, JobStatus, TokenProvider } from "$lib/types";
import { and, desc, eq, or } from "drizzle-orm"; // Removed isNull
import { monotonicFactory } from "ulid";
import { startJob } from "../../hooks.server";

const logger = getLogger(["backend", "job-manager"]);
const ulid = monotonicFactory();
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

interface InitiateGitLabDiscoveryArgs {
  pat: string;
  gitlabGraphQLUrl: string;
  userId: string; // User who owns this authorization in our system
  providerId: string; // e.g., "gitlab"
  authorizationDbId: string; // PK of the 'account' table entry for this PAT
}

/**
 * Initiates the GitLab discovery process for a given authorization.
 * Creates or updates a tokenScopeJob and then calls fetchAllGroupsAndProjects.
 */
export async function initiateGitLabDiscovery(args: InitiateGitLabDiscoveryArgs): Promise<void> {
  // 'pat' is no longer used directly in this function, the worker will fetch it.
  const { gitlabGraphQLUrl, userId, providerId, authorizationDbId } = args;
  logger.info(
    `Initiating GitLab discovery for authorization ID ${authorizationDbId} (User: ${userId}, Provider: ${providerId})`
  );

  try {
    let currentScopeJobId: string;

    // Check for recent completed jobs for this authorization
    const recentCompletedJob = await db.query.tokenScopeJob.findFirst({
      where: and(
        eq(tokenScopeJobSchema.authorizationId, authorizationDbId),
        eq(tokenScopeJobSchema.isComplete, true)
      ),
      orderBy: [desc(tokenScopeJobSchema.updated_at)]
    });

    if (recentCompletedJob && recentCompletedJob.updated_at) {
      const jobAgeMs = Date.now() - recentCompletedJob.updated_at.getTime();
      if (jobAgeMs < FORTY_EIGHT_HOURS_MS) {
        logger.info(
          `Recent completed tokenScopeJob ${recentCompletedJob.id} (updated: ${recentCompletedJob.updated_at.toISOString()}) found for authorization ${authorizationDbId}. Skipping new discovery run.`
        );
        return; // Return early
      }
      logger.info(
        `Found completed tokenScopeJob ${recentCompletedJob.id} for authorization ${authorizationDbId}, but it's older than 48 hours (age: ${jobAgeMs / (60 * 60 * 1000)}h). Proceeding with new/reset job.`
      );
    }

    // Check if a tokenScopeJob already exists for this authorization to reset, or create a new one
    const existingTokenScopeJobToReset = await db.query.tokenScopeJob.findFirst({
      where: eq(tokenScopeJobSchema.authorizationId, authorizationDbId),
      orderBy: [desc(tokenScopeJobSchema.updated_at)] // Get the most recent one to reset
    });

    if (existingTokenScopeJobToReset) {
      logger.info(
        `Found existing tokenScopeJob ${existingTokenScopeJobToReset.id} for authorization ${authorizationDbId}. Resetting and reusing.`
      );
      await db
        .update(tokenScopeJobSchema)
        .set({
          isComplete: false,
          groupCursor: null,
          projectCursor: null,
          groupCount: 0,
          projectCount: 0,
          groupTotal: null,
          projectTotal: null,
          gitlabGraphQLUrl, // Update in case it changed
          // updated_at is handled by $onUpdate
        })
        .where(eq(tokenScopeJobSchema.id, existingTokenScopeJobToReset.id));
      currentScopeJobId = existingTokenScopeJobToReset.id;
    } else {
      currentScopeJobId = ulid();
      await db.insert(tokenScopeJobSchema).values({
        id: currentScopeJobId,
        userId,
        provider: providerId as TokenProvider, // Ensure providerId matches TokenProvider enum values
        accountId: authorizationDbId, // This is the system's account ID, linking to account.id PK
        authorizationId: authorizationDbId, // Explicit link to the specific authorization record (account.id PK)
        gitlabGraphQLUrl,
        isComplete: false,
        groupCursor: null,
        projectCursor: null,
        groupCount: 0,
        projectCount: 0
        // groupTotal and projectTotal default to null or are not set if not available
      });
      logger.info(`Created new tokenScopeJob ${currentScopeJobId} for authorization ${authorizationDbId}`);
    }

    // Create and start the GROUP_PROJECT_DISCOVERY job
    const discoveryJobId = ulid();
    const newJob = {
      id: discoveryJobId,
      accountId: authorizationDbId, // This is the PK of the 'account' table, used to fetch PAT etc.
      full_path: currentScopeJobId, // Link to the tokenScopeJob
      command: CrawlCommand.GROUP_PROJECT_DISCOVERY,
      status: JobStatus.queued,
      // Add other necessary job parameters if any, e.g., payload with pat, gitlabGraphQLUrl if not derivable
      // For now, assuming the worker for GROUP_PROJECT_DISCOVERY can fetch PAT and URL using authorizationDbId
      // and can use currentScopeJobId (as full_path) to update the tokenScopeJob.
      // The `userId` and `providerId` are available in the `tokenScopeJob` record via `currentScopeJobId`.
      // The `pat` and `gitlabGraphQLUrl` are available in the `account` record via `authorizationDbId`.
    };

    await db.insert(jobSchema).values(newJob);
    logger.info(
      `Created new GROUP_PROJECT_DISCOVERY job ${discoveryJobId} for tokenScopeJob ${currentScopeJobId} (Authorization: ${authorizationDbId})`
    );

    // Start the job
    // The startJob function might need to be aware of how to pass pat and gitlabGraphQLUrl if they are not
    // directly stored or easily derivable by the worker using only accountId and full_path (tokenScopeJobId).
    // For now, assuming startJob can handle this or the worker can fetch them.
    await startJob({
      jobId: newJob.id,
      fullPath: newJob.full_path, // This is currentScopeJobId
      command: newJob.command,
      accountId: newJob.accountId // This is authorizationDbId
    });

    logger.info(
      `GROUP_PROJECT_DISCOVERY job ${discoveryJobId} started for tokenScopeJob ${currentScopeJobId} (Authorization: ${authorizationDbId})`
    );
  } catch (error) {
    logger.error(`Error initiating GitLab discovery or creating/starting job for authorization ${authorizationDbId}:`, { error });
    // Consider updating the tokenScopeJob to an error state here
    // Also, if the job was created but failed to start, update its status to 'failed'
  }
}

/**
 * Handles actions when a new authorization is successfully created or updated in the system.
 * This function is the new entry point for triggering GitLab discovery.
 * @param userId The internal system User ID.
 * @param authorizationDbId The unique ID of the authorization record in the database (e.g., from the 'account' table).
 * @param providerId The identifier for the provider (e.g., "gitlab", "gitlab-onprem").
 * @param pat The Personal Access Token (PAT) for GitLab.
 * @param gitlabGraphQLUrl The GraphQL endpoint for the GitLab instance.
 */
export async function handleNewAuthorization(
  userId: string,
  authorizationDbId: string, // Renamed from accountId for clarity, this is the PK of the 'account' table
  providerId: string,
  pat: string, // New parameter: PAT
  gitlabGraphQLUrl: string // New parameter: GitLab GraphQL URL
): Promise<void> {
  logger.info(
    `Handling new authorization: UserID=${userId}, AuthDBID=${authorizationDbId}, Provider=${providerId}`
  );

  try {
    // The old logic for creating a generic 'CrawlCommand.authorizationScope' job and
    // directly managing 'tokenScopeJob' entries is now replaced by 'initiateGitLabDiscovery'.

    await initiateGitLabDiscovery({
      pat,
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
 * Handles creation of jobs when a new area (group or project) is created/discovered.
 * This function remains largely unchanged but is distinct from PAT-based discovery.
 * @param areaPath The full path of the group or project
 * @param areaType The type of area (group or project)
 * @param areaId The GitLab ID of the area
 * @param accountId The account ID to use for crawling
 */
export async function handleNewArea(
  areaPath: string,
  areaType: AreaType,
  areaId: string,
  accountId: string
): Promise<void> {
  logger.info(`Handling new area: ${areaPath} (${areaType}) with ID ${areaId}`);

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

    // Create appropriate jobs based on area type
    const jobsToCreate = [];

    // --- Expanded job creation for all service handlers ---
    if (areaType === AreaType.group) {
      // List of all group-related CrawlCommands (from servicehandlers.md)
      const groupCommands = [
        CrawlCommand.group, // group details
        CrawlCommand.groupMembers,
        CrawlCommand.groupProjects,
        CrawlCommand.groupIssues,
        CrawlCommand.groupSubgroups,
        CrawlCommand.epics,
        CrawlCommand.groupCustomAttributes,
        CrawlCommand.groupAccessRequests,
        CrawlCommand.groupVariables,
        CrawlCommand.groupLabels,
        CrawlCommand.groupBadges,
        CrawlCommand.groupDeployTokens,
        CrawlCommand.groupIssueBoards,
        CrawlCommand.groupMilestones,
        CrawlCommand.epicIssues,
        CrawlCommand.epicNotes,
        CrawlCommand.epicDiscussions
      ];
      for (const command of groupCommands) {
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
          jobsToCreate.push({
            id: ulid(),
            accountId,
            full_path: areaPath,
            command,
            status: JobStatus.queued
          });
        }
      }
    }

    if (areaType === AreaType.project) {
      // List of all project-related CrawlCommands (from servicehandlers.md)
      const projectCommands = [
        CrawlCommand.project, // project details
        CrawlCommand.projectVariables,
        CrawlCommand.projectMembers,
        CrawlCommand.issues,
        CrawlCommand.pagesDomains,
        CrawlCommand.projectCustomAttributes,
        CrawlCommand.projectStatistics,
        CrawlCommand.projectBadges,
        CrawlCommand.projectTemplates,
        CrawlCommand.projectAccessRequests,
        CrawlCommand.projectHooks,
        CrawlCommand.projectIssueBoards,
        CrawlCommand.freezePeriods,
        CrawlCommand.commits,
        CrawlCommand.commitDiscussions,
        CrawlCommand.branches,
        CrawlCommand.tags,
        CrawlCommand.mergeRequests,
        CrawlCommand.mergeRequestNotes,
        CrawlCommand.mergeRequestDiscussions,
        CrawlCommand.mergeRequestAwardEmojis,
        CrawlCommand.projectSnippets,
        CrawlCommand.snippets,
        CrawlCommand.pipelines,
        CrawlCommand.pipelineSchedules,
        CrawlCommand.jobs,
        CrawlCommand.deployments,
        CrawlCommand.environments,
        CrawlCommand.pipelineScheduleVariables,
        CrawlCommand.pipelineTriggers,
        CrawlCommand.containerRegistryRepositories,
        CrawlCommand.packages,
        CrawlCommand.vulnerabilities,
        CrawlCommand.protectedBranches,
        CrawlCommand.protectedTags,
        CrawlCommand.deployKeys
      ];
      for (const command of projectCommands) {
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
          jobsToCreate.push({
            id: ulid(),
            accountId,
            full_path: areaPath,
            command,
            status: JobStatus.queued
          });
        }
      }
    }

    // Insert all new jobs
    if (jobsToCreate.length > 0) {
      logger.info(`Creating ${jobsToCreate.length} new jobs for area ${areaPath}`);
      await db.insert(jobSchema).values(jobsToCreate);

      // Start each job
      for (const jobData of jobsToCreate) {
        await startJob({
          jobId: jobData.id,
          fullPath: jobData.full_path,
          command: jobData.command,
          accountId: jobData.accountId
        });
      }

      logger.info(`Successfully created and started ${jobsToCreate.length} jobs for area ${areaPath}`);
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

  await handleNewArea(areaPath, areaType, areaId, accountId);
}
