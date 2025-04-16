import { getLogger } from "$lib/logging";
import { db } from "$lib/server/db";
import { area as areaSchema, job as jobSchema, tokenScopeJob as tokenScopeJobSchema } from "$lib/server/db/schema";
import { AreaType, CrawlCommand, JobStatus, TokenProvider } from "$lib/types";
import { and, eq, isNull, or } from "drizzle-orm";
import { monotonicFactory } from "ulid";
import { startJob } from "../../hooks.server";

const logger = getLogger(["backend", "job-manager"]);
const ulid = monotonicFactory();

/**
 * Handles creation of jobs when a new authorization is received via OAuth
 * @param userId The user ID that authenticated
 * @param accountId The account ID from the authorization
 * @param providerId The provider ID (e.g. gitlab-onprem, gitlab-cloud)
 * @param tokens The OAuth tokens received
 */
export async function handleNewAuthorization(
  userId: string,
  accountId: string,
  providerId: string): Promise<void> {
  logger.info(`Handling new authorization for user ${userId} with account ${accountId} via ${providerId}`);

  try {
    // Check if we already have an authorization scope job for this account
    const existingJob = await db.query.job.findFirst({
      where: and(
        eq(jobSchema.accountId, accountId),
        eq(jobSchema.command, CrawlCommand.authorizationScope),
        isNull(jobSchema.full_path),
        isNull(jobSchema.branch),
        or(
          eq(jobSchema.status, JobStatus.queued),
          eq(jobSchema.status, JobStatus.running)
        )
      )
    });

    // If job already exists and is running or queued, don't create a new one
    if (existingJob) {
      logger.info(`Authorization scope job already exists for account ${accountId}: ${existingJob.id}`);
      return;
    }

    // Create new authorization scope job
    const jobId = ulid();
    const newJob = {
      id: jobId,
      accountId,
      command: CrawlCommand.authorizationScope,
      status: JobStatus.queued,
      // No full_path or branch for authorization scope jobs
    };

    logger.info(`Creating new authorization scope job ${jobId} for account ${accountId}`);
    await db.insert(jobSchema).values(newJob);

    // Create/update token scope job entry to track progress
    const existingTokenScopeJob = await db.query.tokenScopeJob.findFirst({
      where: and(
        eq(tokenScopeJobSchema.userId, userId),
        eq(tokenScopeJobSchema.provider, providerId as TokenProvider),
        eq(tokenScopeJobSchema.accountId, accountId)
      )
    });

    if (existingTokenScopeJob) {
      // Reset the progress if we're creating a new job
      await db.update(tokenScopeJobSchema)
        .set({
          isComplete: false,
          groupCursor: null,
          projectCursor: null,
          groupCount: 0,
          projectCount: 0,
          groupTotal: null,
          projectTotal: null,
          updated_at: new Date()
        })
        .where(and(
          eq(tokenScopeJobSchema.userId, userId),
          eq(tokenScopeJobSchema.provider, providerId as TokenProvider),
          eq(tokenScopeJobSchema.accountId, accountId)
        ));
    } else {
      // Create new token scope job entry
      await db.insert(tokenScopeJobSchema).values({
        userId,
        provider: providerId as TokenProvider,
        accountId,
        isComplete: false,
        groupCount: 0,
        projectCount: 0
      });
    }

    // Start the job
    await startJob({
      jobId,
      accountId,
      command: CrawlCommand.authorizationScope
    });

    logger.info(`Successfully created and started authorization scope job ${jobId}`);
  } catch (error) {
    logger.error(`Error creating authorization scope job for account ${accountId}:`, { error });
  }
}

/**
 * Handles creation of jobs when a new area (group or project) is created/discovered
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
    let existingArea = await db.query.area.findFirst({
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

    // For groups, we need to crawl group details and discover subgroups/projects
    if (areaType === AreaType.group) {
      // Check for existing group job
      const existingGroupJob = await db.query.job.findFirst({
        where: and(
          eq(jobSchema.full_path, areaPath),
          eq(jobSchema.command, CrawlCommand.group),
          or(
            eq(jobSchema.status, JobStatus.queued),
            eq(jobSchema.status, JobStatus.running)
          )
        )
      });

      if (!existingGroupJob) {
        jobsToCreate.push({
          id: ulid(),
          accountId,
          full_path: areaPath,
          command: CrawlCommand.group,
          status: JobStatus.queued
        });
      }

      // Check for existing groupProjects job
      const existingGroupProjectsJob = await db.query.job.findFirst({
        where: and(
          eq(jobSchema.full_path, areaPath),
          eq(jobSchema.command, CrawlCommand.groupProjects),
          or(
            eq(jobSchema.status, JobStatus.queued),
            eq(jobSchema.status, JobStatus.running)
          )
        )
      });

      if (!existingGroupProjectsJob) {
        jobsToCreate.push({
          id: ulid(),
          accountId,
          full_path: areaPath,
          command: CrawlCommand.groupProjects,
          status: JobStatus.queued
        });
      }

      // Check for existing groupSubgroups job
      const existingGroupSubgroupsJob = await db.query.job.findFirst({
        where: and(
          eq(jobSchema.full_path, areaPath),
          eq(jobSchema.command, CrawlCommand.groupSubgroups),
          or(
            eq(jobSchema.status, JobStatus.queued),
            eq(jobSchema.status, JobStatus.running)
          )
        )
      });

      if (!existingGroupSubgroupsJob) {
        jobsToCreate.push({
          id: ulid(),
          accountId,
          full_path: areaPath,
          command: CrawlCommand.groupSubgroups,
          status: JobStatus.queued
        });
      }
    }

    // For projects, we need to crawl project details
    if (areaType === AreaType.project) {
      // Check for existing project job
      const existingProjectJob = await db.query.job.findFirst({
        where: and(
          eq(jobSchema.full_path, areaPath),
          eq(jobSchema.command, CrawlCommand.project),
          or(
            eq(jobSchema.status, JobStatus.queued),
            eq(jobSchema.status, JobStatus.running)
          )
        )
      });

      if (!existingProjectJob) {
        jobsToCreate.push({
          id: ulid(),
          accountId,
          full_path: areaPath,
          command: CrawlCommand.project,
          status: JobStatus.queued
        });
      }

      // Add other project-related jobs like commits, mergeRequests, issues, etc.
      const projectCommands = [
        CrawlCommand.commits,
        CrawlCommand.mergeRequests,
        CrawlCommand.issues,
        CrawlCommand.vulnerabilities,
        CrawlCommand.pipelines
      ];

      for (const command of projectCommands) {
        const existingCommandJob = await db.query.job.findFirst({
          where: and(
            eq(jobSchema.full_path, areaPath),
            eq(jobSchema.command, command),
            or(
              eq(jobSchema.status, JobStatus.queued),
              eq(jobSchema.status, JobStatus.running)
            )
          )
        });

        if (!existingCommandJob) {
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
