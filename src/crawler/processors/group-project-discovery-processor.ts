import { BaseProcessor, type BaseProcessorConfig } from "./base-processor";
import type { Job, JobResult } from "../types/job-types";
import { JobType } from "../types/job-types"; // Import JobType enum
import { AreaType } from "../../lib/types"; // Removed CrawlCommand and TokenProvider
import { db } from "../../lib/server/db";
import { tokenScopeJob, area, area_authorization, tokenScopeJobArea } from "../../lib/server/db/base-schema";
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

  private async updateTokenScopeJobProgress(
    tokenScopeJobId: string,
    progress: DiscoveryProgress & { updated_at?: Date } // Ensure updated_at can be passed
  ) {
    const updateData: any = { ...progress, updated_at: progress.updated_at || new Date() };
    
    // Ensure nulls are passed correctly for cursors if they are explicitly set to null or empty string
    if (Object.prototype.hasOwnProperty.call(progress, 'groupsCursor')) {
        updateData.groupCursor = progress.groupsCursor === "" ? null : progress.groupsCursor;
    } else {
        delete updateData.groupCursor; // Don't update if not provided
    }
    if (Object.prototype.hasOwnProperty.call(progress, 'projectsCursor')) {
        updateData.projectCursor = progress.projectsCursor === "" ? null : progress.projectsCursor;
    } else {
        delete updateData.projectCursor;
    }
    
    // Remove undefined fields to avoid overwriting with null if not provided in progress object
    Object.keys(updateData).forEach(key => updateData[key] === undefined && delete updateData[key]);
    
    if (Object.keys(updateData).length > 1 || (Object.keys(updateData).length === 1 && !Object.prototype.hasOwnProperty.call(updateData, 'updated_at'))) { // Check if there's more than just updated_at
        await db.update(tokenScopeJob)
          .set(updateData)
          .where(eq(tokenScopeJob.id, tokenScopeJobId));
        logger.debug("Updated tokenScopeJob progress", { tokenScopeJobId, updateData });
    } else {
        logger.debug("No progress data to update for tokenScopeJob (only updated_at or empty)", { tokenScopeJobId });
    }
  }

  private async updateGroupsAndProjectsInDb(
    items: DiscoveredItem[],
    itemType: AreaType,
    authorizationId: string,
    tokenScopeJobId: string
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
      logger.debug(`Inserted/ignored ${areaInserts.length} areas of type ${itemType}`, { tokenScopeJobId });

      const areaPaths = items.map((x) => x.fullPath);

      const tokenScopeJobAreaInserts = areaPaths.map((path) => ({
        full_path: path,
        token_scope_job_id: tokenScopeJobId,
      }));
      await db.insert(tokenScopeJobArea).values(tokenScopeJobAreaInserts).onConflictDoNothing();
      logger.debug(`Linked ${tokenScopeJobAreaInserts.length} areas to tokenScopeJob ${tokenScopeJobId}`, { tokenScopeJobId });
      
      const areaAuthorizationInserts = areaPaths.map((path) => ({
        area_id: path,
        accountId: authorizationId,
      }));
      await db.insert(area_authorization).values(areaAuthorizationInserts).onConflictDoNothing();
      logger.debug(`Linked ${areaAuthorizationInserts.length} areas to authorization ${authorizationId}`, { tokenScopeJobId });

      for (const item of items) {
        await handleNewArea(item.fullPath, itemType, item.id, authorizationId);
        logger.info(`Triggered handleNewArea for ${itemType} ${item.fullPath}`, { tokenScopeJobId, gitlabId: item.id });
      }
    } catch (error: any) {
        logger.error(`Error in updateGroupsAndProjectsInDb for ${itemType}: ${error.message}`, { tokenScopeJobId, stack: error.stack });
        throw error; // Re-throw to be caught by the main process method
    }
  }

  private async fetchAllGroupsInternal(
    gitlabGraphQLEndpoint: string,
    personalAccessToken: string,
    initialCursor: string | null,
    tokenScopeJobId: string,
    authorizationId: string,
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
      logger.info(`Fetching groups page ${pageNum} for tokenScopeJob ${tokenScopeJobId}`, { cursor: currentCursor, itemsPerPage });
      const response = await this.fetchGraphQLPage<GraphQLGroupsResponse>(
        gitlabGraphQLEndpoint,
        personalAccessToken,
        query,
        { after: currentCursor, first: itemsPerPage }
      );

      const groups = response?.data?.groups?.nodes;
      const pageInfo = response?.data?.groups?.pageInfo;
      
      if (response?.errors || !groups || !pageInfo) {
        logger.error("GraphQL errors or missing data while fetching groups:", { errors: response?.errors, missingData: !groups || !pageInfo, tokenScopeJobId });
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
        logger.info(`Finished fetching all groups for tokenScopeJob ${tokenScopeJobId}. Collected in this run: ${runningCollectedCount}`, { finalCursor: currentCursor });
      }
    }
    return { finalCursor: currentCursor, collectedCount: runningCollectedCount, totalCount: currentTotalCount, hasMore: hasNextPage };
  }

 private async fetchAllProjectsInternal(
    gitlabGraphQLEndpoint: string,
    personalAccessToken: string,
    initialCursor: string | null,
    tokenScopeJobId: string,
    authorizationId: string,
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
      logger.info(`Fetching projects page ${pageNum} for tokenScopeJob ${tokenScopeJobId}`, { cursor: currentCursor, itemsPerPage });
      const response = await this.fetchGraphQLPage<GraphQLProjectsResponse>(
        gitlabGraphQLEndpoint,
        personalAccessToken,
        query,
        { after: currentCursor, first: itemsPerPage }
      );

      const projects = response?.data?.projects?.nodes;
      const pageInfo = response?.data?.projects?.pageInfo;

      if (response?.errors || !projects || !pageInfo) {
        logger.error("GraphQL errors or missing data while fetching projects:", { errors: response?.errors, missingData: !projects || !pageInfo, tokenScopeJobId });
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
        logger.info(`Finished fetching all projects for tokenScopeJob ${tokenScopeJobId}. Collected in this run: ${runningCollectedCount}`, { finalCursor: currentCursor });
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

    const tokenScopeJobId = job.resourceId as string;
    
    const tokenScopeJobRecord = await db.query.tokenScopeJob.findFirst({
      where: eq(tokenScopeJob.id, tokenScopeJobId),
    });

    if (!tokenScopeJobRecord) {
      logger.error(`TokenScopeJob not found: ${tokenScopeJobId}`, { jobId: job.id });
      return { job, success: false, error: `TokenScopeJob not found: ${tokenScopeJobId}` };
    }

    const authorizationId = tokenScopeJobRecord.authorizationId;
    const gitlabGraphQLEndpoint = tokenScopeJobRecord.gitlabGraphQLUrl;

    if (!authorizationId || !gitlabGraphQLEndpoint) {
      logger.error(`TokenScopeJob ${tokenScopeJobId} is missing authorizationId or gitlabGraphQLEndpoint`, { jobId: job.id });
      return { job, success: false, error: "Missing authorizationId or gitlabGraphQLEndpoint in tokenScopeJob record" };
    }

    const accountRecord = await db.query.account.findFirst({
        where: eq(accountTable.id, authorizationId),
    });

    if (!accountRecord || !accountRecord.accessToken) {
        logger.error(`Account or PAT not found for authorizationId: ${authorizationId}`, { jobId: job.id });
        return { job, success: false, error: `Account or PAT not found for authorizationId: ${authorizationId}` };
    }
    const personalAccessToken = accountRecord.accessToken;
    
    try {
      logger.info(`Starting GROUP_PROJECT_DISCOVERY for tokenScopeJobId: ${tokenScopeJobId}`, { jobId: job.id, gitlabGraphQLEndpoint });
      
      let currentGroupsCursor = tokenScopeJobRecord.groupCursor;
      let currentProjectsCursor = tokenScopeJobRecord.projectCursor;
      let currentCollectedGroups = tokenScopeJobRecord.groupCount || 0;
      let currentCollectedProjects = tokenScopeJobRecord.projectCount || 0;
      let currentTotalGroups: number | null = tokenScopeJobRecord.groupTotal || null; // Allow null
      let currentTotalProjects: number | null = tokenScopeJobRecord.projectTotal || null; // Allow null
      
      let groupsFetchCompleted = false;
      let projectsFetchCompleted = false;

      // If job was marked complete, but cursors exist, it means it was interrupted or is a new run after completion.
      // We should reset isComplete and continue.
      if (tokenScopeJobRecord.isComplete && (currentGroupsCursor || currentProjectsCursor)) {
          logger.info(`Resuming previously completed or interrupted job: ${tokenScopeJobId}`);
          await this.updateTokenScopeJobProgress(tokenScopeJobId, { isComplete: false });
      } else if (tokenScopeJobRecord.isComplete) {
          logger.info(`Job ${tokenScopeJobId} already marked as complete and no cursors found. Assuming full completion.`);
          groupsFetchCompleted = true;
          projectsFetchCompleted = true;
      }


      if (!groupsFetchCompleted) {
        logger.info(`Fetching groups for tokenScopeJobId: ${tokenScopeJobId}`, { initialCursor: currentGroupsCursor });
        const groupResult = await this.fetchAllGroupsInternal(
          gitlabGraphQLEndpoint,
          personalAccessToken,
          currentGroupsCursor,
          tokenScopeJobId,
          authorizationId,
          async (progressUpdate) => { // progressCallback
            currentCollectedGroups = (tokenScopeJobRecord.groupCount || 0) + (progressUpdate.collectedGroups || 0);
            if (progressUpdate.totalGroups !== undefined) currentTotalGroups = progressUpdate.totalGroups;
            await this.updateTokenScopeJobProgress(tokenScopeJobId, {
              ...progressUpdate, // contains groupsCursor from internal fetch
              collectedGroups: currentCollectedGroups,
              totalGroups: currentTotalGroups,
            });
          },
          async (groups) => { // batchProcessCallback
            await this.updateGroupsAndProjectsInDb(groups, AreaType.group, authorizationId, tokenScopeJobId);
            // The currentCollectedGroups is updated based on progressUpdate from fetchAllGroupsInternal
          }
        );
        currentGroupsCursor = groupResult.finalCursor;
        currentCollectedGroups = (tokenScopeJobRecord.groupCount || 0) + groupResult.collectedCount;
        if (groupResult.totalCount !== null) currentTotalGroups = groupResult.totalCount;
        groupsFetchCompleted = !groupResult.hasMore;
        
        await this.updateTokenScopeJobProgress(tokenScopeJobId, {
            groupsCursor: currentGroupsCursor,
            collectedGroups: currentCollectedGroups,
            totalGroups: currentTotalGroups,
            isComplete: groupsFetchCompleted && projectsFetchCompleted
        });
      } else {
          logger.info(`Group discovery previously completed or skipped for ${tokenScopeJobId}.`);
      }

      if (!projectsFetchCompleted) {
        logger.info(`Fetching projects for tokenScopeJobId: ${tokenScopeJobId}`, { initialCursor: currentProjectsCursor });
        const projectResult = await this.fetchAllProjectsInternal(
          gitlabGraphQLEndpoint,
          personalAccessToken,
          currentProjectsCursor,
          tokenScopeJobId,
          authorizationId,
          async (progressUpdate) => { // progressCallback
            currentCollectedProjects = (tokenScopeJobRecord.projectCount || 0) + (progressUpdate.collectedProjects || 0);
            if (progressUpdate.totalProjects !== undefined) currentTotalProjects = progressUpdate.totalProjects;
            await this.updateTokenScopeJobProgress(tokenScopeJobId, {
              ...progressUpdate, // contains projectsCursor
              collectedProjects: currentCollectedProjects,
              totalProjects: currentTotalProjects,
            });
          },
          async (projects) => { // batchProcessCallback
            await this.updateGroupsAndProjectsInDb(projects, AreaType.project, authorizationId, tokenScopeJobId);
          }
        );
        currentProjectsCursor = projectResult.finalCursor;
        currentCollectedProjects = (tokenScopeJobRecord.projectCount || 0) + projectResult.collectedCount;
        if (projectResult.totalCount !== null) currentTotalProjects = projectResult.totalCount;
        projectsFetchCompleted = !projectResult.hasMore;

        await this.updateTokenScopeJobProgress(tokenScopeJobId, {
            projectsCursor: currentProjectsCursor,
            collectedProjects: currentCollectedProjects,
            totalProjects: currentTotalProjects,
            isComplete: groupsFetchCompleted && projectsFetchCompleted
        });
      } else {
          logger.info(`Project discovery previously completed or skipped for ${tokenScopeJobId}.`);
      }

      const finalJobStatusIsComplete = groupsFetchCompleted && projectsFetchCompleted;
      if (finalJobStatusIsComplete && !tokenScopeJobRecord.isComplete) { // Only update if it wasn't already marked complete
         await this.updateTokenScopeJobProgress(tokenScopeJobId, { isComplete: true });
      }
      logger.info(`GROUP_PROJECT_DISCOVERY processing finished for tokenScopeJobId: ${tokenScopeJobId}`, { groupsDone: groupsFetchCompleted, projectsDone: projectsFetchCompleted, finalStatusComplete: finalJobStatusIsComplete});

      return {
        job,
        success: true,
        data: {
          message: `Processed GROUP_PROJECT_DISCOVERY for tokenScopeJobId: ${tokenScopeJobId}`,
          collectedGroups: currentCollectedGroups,
          collectedProjects: currentCollectedProjects,
          groupsCursor: currentGroupsCursor,
          projectsCursor: currentProjectsCursor,
          status: finalJobStatusIsComplete ? "Completed" : "In Progress",
        },
      };
    } catch (error: any) {
      logger.error(`Error processing GROUP_PROJECT_DISCOVERY for tokenScopeJobId: ${tokenScopeJobId}: ${error.message}`, { jobId: job.id, stack: error.stack });
      await this.updateTokenScopeJobProgress(tokenScopeJobId, { isComplete: false });
      return {
        job,
        success: false,
        error: error.message,
      };
    }
  }
}