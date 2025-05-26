import { BaseProcessor, type BaseProcessorConfig } from "./base-processor";
import type { Job, JobResult } from "../types/job-types";
import { JobType } from "../types/job-types"; // Import JobType enum
import { AreaType, JobStatus } from "../../lib/types"; // Added JobStatus
import { db } from "../../lib/server/db";
import { job as jobSchema, area, area_authorization, jobArea, type Job as DbJob } from "../../lib/server/db/base-schema"; // Changed tokenScopeJob to job, tokenScopeJobArea to jobArea, added DbJob type
import { account as accountTable } from "../../lib/server/db/auth-schema";
import { handleNewArea } from "../../lib/server/job-manager";
// import { monotonicFactory } from "ulid"; // ulid not used directly in this file
import { eq } from "drizzle-orm"; // Removed 'and'
import { getLogger } from "@logtape/logtape";

// const ulid = monotonicFactory(); // Not used
const logger = getLogger(["crawlib", "processors", "group-project-discovery"]);

interface GraphQLPageInfo {
  endCursor: string | null;
  hasNextPage: boolean;
}

interface DiscoveredItem { // Renamed from GraphQLGroup/GraphQLProject to be more generic
  id: string; // GitLab GID, e.g., "gid://gitlab/Group/123" or "gid://gitlab/Project/456"
  name: string;
  fullPath: string;
  webUrl: string;
}

interface GraphQLGroupsResponse {
  data?: {
    groups: {
      nodes: DiscoveredItem[];
      pageInfo: GraphQLPageInfo;
      count?: number;
    };
  };
  errors?: any[];
}

interface GraphQLProjectsResponse {
  data?: {
    projects: {
      nodes: DiscoveredItem[];
      pageInfo: GraphQLPageInfo;
      count?: number;
    };
  };
  errors?: any[];
}

interface DiscoveryProgress {
  groupsPage?: number;
  projectsPage?: number;
  collectedGroups?: number; // Optional for partial updates
  totalGroups?: number | null;
  collectedProjects?: number; // Optional for partial updates
  totalProjects?: number | null;
  groupsCursor?: string | null;
  projectsCursor?: string | null;
  isComplete?: boolean;
}

export class GroupProjectDiscoveryProcessor extends BaseProcessor {
  constructor(config: BaseProcessorConfig) {
    super(config);
  }

  private getHeaders(token: string) {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  }

  private async fetchGraphQLPage<T>(
    endpoint: string,
    token: string,
    query: string,
    variables: { after: string | null; first: number },
    _fetch: typeof fetch = fetch
  ): Promise<T | undefined> {
    try {
      const response = await _fetch(endpoint, {
        method: "POST",
        headers: this.getHeaders(token),
        signal: AbortSignal.timeout(60 * 1000), // 60-second timeout
        body: JSON.stringify({
          query,
          variables,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`GraphQL request failed: ${response.status} ${response.statusText}`, { endpoint, query, errorText, variables });
        return undefined;
      }
      const data = (await response.json()) as T;
      if ((data as any).errors) {
        logger.warn(`GraphQL query returned errors:`, { errors: (data as any).errors, endpoint, query, variables });
      }
      return data;
    } catch (error: any) {
      logger.error(`Error in fetchGraphQLPage: ${error.message}`, { endpoint, query, variables, stack: error.stack });
      return undefined;
    }
  }

  private async updateDiscoveryJobProgress(
    discoveryJobId: string,
    progressUpdate: DiscoveryProgress
  ) {
    const jobRecord = await db.query.job.findFirst({
        where: eq(jobSchema.id, discoveryJobId),
    });

    if (!jobRecord) {
        logger.error(`Job not found for progress update: ${discoveryJobId}`);
        return;
    }

    const currentProgress = (jobRecord.progress || {}) as Record<string, any>;
    const currentResumeState = (jobRecord.resumeState || {}) as Record<string, any>;

    const newProgress: Record<string, any> = { ...currentProgress };
    const newResumeState: Record<string, any> = { ...currentResumeState };

    if (progressUpdate.collectedGroups !== undefined) newProgress.groupCount = progressUpdate.collectedGroups;
    if (progressUpdate.totalGroups !== undefined) newProgress.groupTotal = progressUpdate.totalGroups;
    if (progressUpdate.collectedProjects !== undefined) newProgress.projectCount = progressUpdate.collectedProjects;
    if (progressUpdate.totalProjects !== undefined) newProgress.projectTotal = progressUpdate.totalProjects;

    if (progressUpdate.groupsCursor !== undefined) newResumeState.groupCursor = progressUpdate.groupsCursor === "" ? null : progressUpdate.groupsCursor;
    if (progressUpdate.projectsCursor !== undefined) newResumeState.projectCursor = progressUpdate.projectsCursor === "" ? null : progressUpdate.projectsCursor;
    
    const updatePayload: Partial<DbJob> = {
        progress: newProgress,
        resumeState: newResumeState,
        updated_at: new Date() // Ensure updated_at is always set
    };

    if (progressUpdate.isComplete !== undefined) {
        updatePayload.status = progressUpdate.isComplete ? JobStatus.finished : jobRecord.status;
        if (progressUpdate.isComplete) {
            updatePayload.finished_at = new Date();
        }
    }
    
    await db.update(jobSchema)
      .set(updatePayload)
      .where(eq(jobSchema.id, discoveryJobId));
    logger.debug("Updated discovery job progress", { discoveryJobId, updatePayload });
  }

  private async updateGroupsAndProjectsInDb(
    items: DiscoveredItem[],
    itemType: AreaType,
    accountId: string,
    discoveryJobId: string // Changed from tokenScopeJobId
  ) {
    if (!items || items.length === 0) return;

    const areaInserts = items.map((item) => ({
      name: item.name,
      full_path: item.fullPath,
      gitlab_id: item.id,
      type: itemType,
    }));

    try {
      await db.insert(area).values(areaInserts).onConflictDoNothing();
      logger.debug(`Inserted/ignored ${areaInserts.length} areas of type ${itemType}`, { discoveryJobId });

      const areaPaths = items.map((x) => x.fullPath);

      // Link areas to the discovery job
      const jobAreaInserts = areaPaths.map((path) => ({
        full_path: path,
        jobId: discoveryJobId, // Use discoveryJobId
      }));
      if (jobAreaInserts.length > 0) {
        await db.insert(jobArea).values(jobAreaInserts).onConflictDoNothing(); // Use jobArea schema
        logger.debug(`Linked ${jobAreaInserts.length} areas to discovery job ${discoveryJobId}`, { discoveryJobId });
      }
      
      const areaAuthorizationInserts = areaPaths.map((path) => ({
        area_id: path,
        accountId: accountId,
      }));
      await db.insert(area_authorization).values(areaAuthorizationInserts).onConflictDoNothing();
      logger.debug(`Linked ${areaAuthorizationInserts.length} areas to authorization ${accountId}`, { discoveryJobId });

      for (const item of items) {
        await handleNewArea(item.fullPath, itemType, item.id, accountId);
        logger.info(`Triggered handleNewArea for ${itemType} ${item.fullPath}`, { discoveryJobId, gitlabId: item.id });
      }
    } catch (error: any) {
        logger.error(`Error in updateGroupsAndProjectsInDb for ${itemType}: ${error.message}`, { discoveryJobId, stack: error.stack });
        throw error; // Re-throw to be caught by the main process method
    }
  }

  private async fetchAllGroupsInternal(
    gitlabGraphQLEndpoint: string,
    personalAccessToken: string,
    initialCursor: string | null,
    discoveryJobId: string, // Changed from tokenScopeJobId
    accountId: string,
    progressCallback: (progressUpdate: DiscoveryProgress) => Promise<void>,
    batchProcessCallback: (groups: DiscoveredItem[]) => Promise<void>,
    itemsPerPage: number = 20
  ): Promise<{ finalCursor: string | null; collectedCount: number; totalCount: number | null; hasMore: boolean }> {
    let currentCursor = initialCursor;
    let hasNextPage = true;
    let runningCollectedCount = 0; // Count for this run, not total from DB
    let pageNum = 0;
    let currentTotalCount: number | null = null;

    const query = `
      query GetGroups($after: String, $first: Int) {
        groups(allAvailable: true, sort: "id_asc", after: $after, first: $first) {
          pageInfo {
            endCursor
            hasNextPage
          }
          nodes {
            id
            name
            fullPath
            webUrl
          }
          count
        }
      }
    `;

    while (hasNextPage) {
      pageNum++;
      logger.info(`Fetching groups page ${pageNum} for discovery job ${discoveryJobId}`, { cursor: currentCursor, itemsPerPage }); // Log uses discoveryJobId
      const response = await this.fetchGraphQLPage<GraphQLGroupsResponse>(
        gitlabGraphQLEndpoint,
        personalAccessToken,
        query,
        { after: currentCursor, first: itemsPerPage }
      );

      const groups = response?.data?.groups?.nodes;
      const pageInfo = response?.data?.groups?.pageInfo;
      
      if (response?.errors || !groups || !pageInfo) {
        logger.error("GraphQL errors or missing data while fetching groups:", { errors: response?.errors, missingData: !groups || !pageInfo, discoveryJobId }); // Log uses discoveryJobId
        hasNextPage = false;
        break;
      }
      
      if (response.data?.groups?.count !== undefined && currentTotalCount === null) {
        currentTotalCount = response.data.groups.count;
      }

      await batchProcessCallback(groups);
      runningCollectedCount += groups.length;
      currentCursor = pageInfo.endCursor;
      hasNextPage = pageInfo.hasNextPage;

      await progressCallback({
        groupsPage: pageNum, // This is page number for this run
        collectedGroups: runningCollectedCount, // This is count for this run
        totalGroups: currentTotalCount,
        groupsCursor: currentCursor,
      });

      if (!hasNextPage) {
        logger.info(`Finished fetching all groups for discovery job ${discoveryJobId}. Collected in this run: ${runningCollectedCount}`, { finalCursor: currentCursor }); // Log uses discoveryJobId
      }
    }
    return { finalCursor: currentCursor, collectedCount: runningCollectedCount, totalCount: currentTotalCount, hasMore: hasNextPage };
  }

 private async fetchAllProjectsInternal(
   gitlabGraphQLEndpoint: string,
   personalAccessToken: string,
   initialCursor: string | null,
   discoveryJobId: string, // Changed from tokenScopeJobId
   accountId: string,
   progressCallback: (progressUpdate: DiscoveryProgress) => Promise<void>,
   batchProcessCallback: (projects: DiscoveredItem[]) => Promise<void>,
    itemsPerPage: number = 20 // Original used 5 for projects
  ): Promise<{ finalCursor: string | null; collectedCount: number; totalCount: number | null; hasMore: boolean }> {
    let currentCursor = initialCursor;
    let hasNextPage = true;
    let runningCollectedCount = 0;
    let pageNum = 0;
    let currentTotalCount: number | null = null;

    const query = `
      query GetProjects($after: String, $first: Int) {
        projects(searchNamespaces: true, includeHidden: true, sort: "id_asc", after: $after, first: $first) {
          pageInfo {
            endCursor
            hasNextPage
          }
          nodes {
            id
            name
            fullPath
            webUrl
          }
          count
        }
      }
    `;
    
    while (hasNextPage) {
      pageNum++;
      logger.info(`Fetching projects page ${pageNum} for discovery job ${discoveryJobId}`, { cursor: currentCursor, itemsPerPage }); // Log uses discoveryJobId
      const response = await this.fetchGraphQLPage<GraphQLProjectsResponse>(
        gitlabGraphQLEndpoint,
        personalAccessToken,
        query,
        { after: currentCursor, first: itemsPerPage }
      );

      const projects = response?.data?.projects?.nodes;
      const pageInfo = response?.data?.projects?.pageInfo;

      if (response?.errors || !projects || !pageInfo) {
        logger.error("GraphQL errors or missing data while fetching projects:", { errors: response?.errors, missingData: !projects || !pageInfo, discoveryJobId }); // Log uses discoveryJobId
        hasNextPage = false;
        break;
      }

      if (response.data?.projects?.count !== undefined && currentTotalCount === null) {
        currentTotalCount = response.data.projects.count;
      }

      await batchProcessCallback(projects);
      runningCollectedCount += projects.length;
      currentCursor = pageInfo.endCursor;
      hasNextPage = pageInfo.hasNextPage;

      await progressCallback({
        projectsPage: pageNum,
        collectedProjects: runningCollectedCount,
        totalProjects: currentTotalCount,
        projectsCursor: currentCursor,
      });
      
      if (!hasNextPage) {
        logger.info(`Finished fetching all projects for discovery job ${discoveryJobId}. Collected in this run: ${runningCollectedCount}`, { finalCursor: currentCursor }); // Log uses discoveryJobId
      }
    }
    return { finalCursor: currentCursor, collectedCount: runningCollectedCount, totalCount: currentTotalCount, hasMore: hasNextPage };
  }

  public async process(job: Job): Promise<JobResult> {
    if (job.type !== JobType.GROUP_PROJECT_DISCOVERY) {
      // This check ensures the processor only handles its designated job type.
      // The string value of JobType.GROUP_PROJECT_DISCOVERY should align with CrawlCommand.GROUP_PROJECT_DISCOVERY
      // if CrawlCommand is still used for job creation in the DB.
      logger.error(`GroupProjectDiscoveryProcessor received job of incorrect type: ${job.type}. Expected: ${JobType.GROUP_PROJECT_DISCOVERY}`);
      throw new Error(`GroupProjectDiscoveryProcessor cannot handle job type ${job.type}`);
    }

    // The job.id IS the discoveryJobId for GROUP_PROJECT_DISCOVERY jobs.
    // The job.resourceId was previously used to link to the separate tokenScopeJob.
    // Now, the job itself holds all necessary state.
    const discoveryJobId = job.id;
    
    const discoveryJobRecord = await db.query.job.findFirst({
      where: eq(jobSchema.id, discoveryJobId),
    });

    if (!discoveryJobRecord) {
      logger.error(`GROUP_PROJECT_DISCOVERY job not found: ${discoveryJobId}`, { jobId: job.id });
      return { job, success: false, error: `Job not found: ${discoveryJobId}` };
    }

    // Ensure this is indeed a GROUP_PROJECT_DISCOVERY job, though job.type check should cover this.
    // if (discoveryJobRecord.command !== CrawlCommand.GROUP_PROJECT_DISCOVERY) { ... }

    const accountId = discoveryJobRecord.accountId; // This should be the PK of the 'account' table
    const gitlabGraphQLEndpoint = discoveryJobRecord.gitlabGraphQLUrl;

    if (!accountId) { // gitlabGraphQLEndpoint might be optional if default is used
      logger.error(`Job ${discoveryJobId} is missing accountId`, { jobId: job.id });
      return { job, success: false, error: "Missing accountId in job record" };
    }
    if (!gitlabGraphQLEndpoint) {
        logger.warn(`Job ${discoveryJobId} is missing gitlabGraphQLEndpoint, will attempt to use default if PAT provides it.`, { jobId: job.id });
        // Potentially fetch default from accountRecord if not present on job.
    }

    const accountRecord = await db.query.account.findFirst({
        where: eq(accountTable.id, accountId),
    });

    if (!accountRecord || !accountRecord.accessToken) {
        logger.error(`Account or PAT not found for accountId: ${accountId}`, { jobId: job.id });
        return { job, success: false, error: `Account or PAT not found for accountId: ${accountId}` };
    }
    const personalAccessToken = accountRecord.accessToken;
    
    try {
      logger.info(`Starting GROUP_PROJECT_DISCOVERY for job ID: ${discoveryJobId}`, { jobId: job.id, gitlabGraphQLEndpoint });
      
      const resumeState = (discoveryJobRecord.resumeState || {}) as { groupCursor?: string | null, projectCursor?: string | null };
      const progressState = (discoveryJobRecord.progress || {}) as { groupCount?: number, projectCount?: number, groupTotal?: number | null, projectTotal?: number | null };

      let currentGroupsCursor = resumeState.groupCursor || null;
      let currentProjectsCursor = resumeState.projectCursor || null;
      let currentCollectedGroups = progressState.groupCount || 0;
      let currentCollectedProjects = progressState.projectCount || 0;
      let currentTotalGroups: number | null = progressState.groupTotal || null;
      let currentTotalProjects: number | null = progressState.projectTotal || null;
      
      let groupsFetchCompleted = false;
      let projectsFetchCompleted = false;

      // If job status is finished, but cursors exist, it implies a reset or interruption.
      // The job manager should reset status to queued. Here we just proceed.
      if (discoveryJobRecord.status === JobStatus.finished && (currentGroupsCursor || currentProjectsCursor)) {
          logger.info(`Resuming previously finished or interrupted job: ${discoveryJobId}. Current status: ${discoveryJobRecord.status}`);
          // No need to update status here, job manager should have set it to queued if reset.
          // If it's still 'finished' but has cursors, it's an odd state, but we proceed.
      } else if (discoveryJobRecord.status === JobStatus.finished) {
          logger.info(`Job ${discoveryJobId} already marked as finished and no cursors found. Assuming full completion.`);
          groupsFetchCompleted = true;
          projectsFetchCompleted = true;
      }


      if (!groupsFetchCompleted) {
        logger.info(`Fetching groups for job ID: ${discoveryJobId}`, { initialCursor: currentGroupsCursor });
        const groupResult = await this.fetchAllGroupsInternal(
          gitlabGraphQLEndpoint!, // Assert non-null as checked or default logic would apply
          personalAccessToken,
          currentGroupsCursor,
          discoveryJobId,
          accountId!, // Assert non-null as checked
          async (progressUpdate) => { // progressCallback
            // Accumulate counts based on what's already in DB progress + this run's collection
            const baseGroupCount = (progressState.groupCount || 0) - (progressUpdate.collectedGroups || 0); // Subtract this run's to add accurately
            currentCollectedGroups = baseGroupCount + (progressUpdate.collectedGroups || 0);
            if (progressUpdate.totalGroups !== undefined) currentTotalGroups = progressUpdate.totalGroups;
            await this.updateDiscoveryJobProgress(discoveryJobId, {
              ...progressUpdate,
              collectedGroups: currentCollectedGroups,
              totalGroups: currentTotalGroups,
            });
          },
          async (groups) => { // batchProcessCallback
            await this.updateGroupsAndProjectsInDb(groups, AreaType.group, accountId!, discoveryJobId);
          }
        );
        currentGroupsCursor = groupResult.finalCursor;
        // After fetchAll, update with the final collected count from this run + what was already there
        currentCollectedGroups = (progressState.groupCount || 0) + groupResult.collectedCount;
        if (groupResult.totalCount !== null) currentTotalGroups = groupResult.totalCount;
        groupsFetchCompleted = !groupResult.hasMore;
        
        await this.updateDiscoveryJobProgress(discoveryJobId, {
            groupsCursor: currentGroupsCursor,
            collectedGroups: currentCollectedGroups,
            totalGroups: currentTotalGroups,
            isComplete: groupsFetchCompleted && projectsFetchCompleted // Only set isComplete if both are done
        });
      } else {
          logger.info(`Group discovery previously completed or skipped for ${discoveryJobId}.`);
      }

      if (!projectsFetchCompleted) {
        logger.info(`Fetching projects for job ID: ${discoveryJobId}`, { initialCursor: currentProjectsCursor });
        const projectResult = await this.fetchAllProjectsInternal(
          gitlabGraphQLEndpoint!,
          personalAccessToken,
          currentProjectsCursor,
          discoveryJobId,
          accountId!,
          async (progressUpdate) => { // progressCallback
            const baseProjectCount = (progressState.projectCount || 0) - (progressUpdate.collectedProjects || 0);
            currentCollectedProjects = baseProjectCount + (progressUpdate.collectedProjects || 0);
            if (progressUpdate.totalProjects !== undefined) currentTotalProjects = progressUpdate.totalProjects;
            await this.updateDiscoveryJobProgress(discoveryJobId, {
              ...progressUpdate,
              collectedProjects: currentCollectedProjects,
              totalProjects: currentTotalProjects,
            });
          },
          async (projects) => { // batchProcessCallback
            await this.updateGroupsAndProjectsInDb(projects, AreaType.project, accountId!, discoveryJobId);
          }
        );
        currentProjectsCursor = projectResult.finalCursor;
        currentCollectedProjects = (progressState.projectCount || 0) + projectResult.collectedCount;
        if (projectResult.totalCount !== null) currentTotalProjects = projectResult.totalCount;
        projectsFetchCompleted = !projectResult.hasMore;

        await this.updateDiscoveryJobProgress(discoveryJobId, {
            projectsCursor: currentProjectsCursor,
            collectedProjects: currentCollectedProjects,
            totalProjects: currentTotalProjects,
            isComplete: groupsFetchCompleted && projectsFetchCompleted
        });
      } else {
          logger.info(`Project discovery previously completed or skipped for ${discoveryJobId}.`);
      }

      const finalJobStatusIsComplete = groupsFetchCompleted && projectsFetchCompleted;
      // The isComplete flag in updateDiscoveryJobProgress handles setting the job to 'finished'
      // No need for an explicit update here if already handled by the last call to updateDiscoveryJobProgress.
      // However, ensure it's set if not already.
      if (finalJobStatusIsComplete && discoveryJobRecord.status !== JobStatus.finished) {
         await this.updateDiscoveryJobProgress(discoveryJobId, { isComplete: true });
      }
      logger.info(`GROUP_PROJECT_DISCOVERY processing finished for job ID: ${discoveryJobId}`, { groupsDone: groupsFetchCompleted, projectsDone: projectsFetchCompleted, finalStatusComplete: finalJobStatusIsComplete});

      return {
        job,
        success: true,
        data: {
          message: `Processed GROUP_PROJECT_DISCOVERY for job ID: ${discoveryJobId}`,
          collectedGroups: currentCollectedGroups,
          collectedProjects: currentCollectedProjects,
          groupsCursor: currentGroupsCursor,
          projectsCursor: currentProjectsCursor,
          status: finalJobStatusIsComplete ? "Completed" : "In Progress",
        },
      };
    } catch (error: any) {
      logger.error(`Error processing GROUP_PROJECT_DISCOVERY for job ID: ${discoveryJobId}: ${error.message}`, { jobId: job.id, stack: error.stack });
      // Mark the job as failed in the database
      await this.updateDiscoveryJobProgress(discoveryJobId, { isComplete: false }); // isComplete: false implies not finished, status will be updated to failed by job manager or here
      try {
        await db.update(jobSchema).set({ status: JobStatus.failed, finished_at: new Date() }).where(eq(jobSchema.id, discoveryJobId));
      } catch (dbError) {
        logger.error(`Failed to mark job ${discoveryJobId} as failed in DB:`, { dbError });
      }
      return {
        job,
        success: false,
        error: error.message,
      };
    }
  }
}