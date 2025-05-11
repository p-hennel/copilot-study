import { getLogger } from "$lib/logging";
import { db } from "$lib/server/db";
import {
  area as areaSchema,
  job as jobSchema
  // account as accountSchema // No longer directly used here to fetch PAT
} from "$lib/server/db/schema";
import { AreaType, CrawlCommand, JobStatus, TokenProvider } from "$lib/types";
import type { Job, JobInsert } from "$lib/server/db/base-schema"; // Corrected import path for Job
import { and, desc, eq, or } from "drizzle-orm"; // Removed isNull
import { monotonicFactory } from "ulid";
import { startJob } from "$lib/server/supervisor";

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
        eq(jobSchema.authorizationId, authorizationDbId),
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
        eq(jobSchema.authorizationId, authorizationDbId),
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
          gitlabGraphQLUrl, // Update in case it changed. Assumes this field exists on jobSchema.
          // updated_at is handled by onUpdateNow()
        })
        .where(eq(jobSchema.id, existingJobToReset.id));
      currentDiscoveryJobId = existingJobToReset.id;
    } else {
      currentDiscoveryJobId = ulid();
      const newDiscoveryJobData: JobInsert = {
        id: currentDiscoveryJobId,
        command: CrawlCommand.GROUP_PROJECT_DISCOVERY,
        userId,
        provider: providerId as TokenProvider,
        accountId: authorizationDbId, // Account for PAT
        authorizationId: authorizationDbId, // Specific authorization
        gitlabGraphQLUrl, // Assumes this field exists on jobSchema.
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
        updated_at: null, // Will be set by DB on update, null on insert
        // created_at, from are handled by DB defaults
      };
      await db.insert(jobSchema).values(newDiscoveryJobData);
      logger.info(`Created new GROUP_PROJECT_DISCOVERY job ${currentDiscoveryJobId} for authorization ${authorizationDbId}`);
    }

    // Start the job
    await startJob({
      jobId: currentDiscoveryJobId,
      fullPath: null, // GROUP_PROJECT_DISCOVERY is not tied to a specific GitLab path
      command: CrawlCommand.GROUP_PROJECT_DISCOVERY,
      accountId: authorizationDbId // Account ID for PAT fetching by worker
    });

    logger.info(
      `GROUP_PROJECT_DISCOVERY job ${currentDiscoveryJobId} started for Authorization: ${authorizationDbId}`
    );
  } catch (error) {
    logger.error(`Error initiating GitLab discovery or creating/starting job for authorization ${authorizationDbId}:`, { error });
    if (currentDiscoveryJobId) {
      try {
        await db.update(jobSchema)
          .set({ status: JobStatus.failed }) // Removed error field
          .where(eq(jobSchema.id, currentDiscoveryJobId));
        logger.info(`Marked GROUP_PROJECT_DISCOVERY job ${currentDiscoveryJobId} as failed.`);
      } catch (dbError) {
        logger.error(`Failed to update job ${currentDiscoveryJobId} to failed status:`, { dbError });
      }
    }
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
    // The logic for initiating discovery is now directly handled by 'initiateGitLabDiscovery',
    // which creates a 'GROUP_PROJECT_DISCOVERY' job.

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
