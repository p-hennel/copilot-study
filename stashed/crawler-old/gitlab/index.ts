import { cacheExchange, Client, fetchExchange, type TypedDocumentNode } from "@urql/core";
import {
  qAuthorizationScope, // Added
  qBranches,
  qDescendantGroups,
  qGroupIssues,
  qGroupMembers,
  qGroupProjects,
  qGroups,
  qIssueDiscussions,
  qMergeRequestDiscussions,
  qMilestones,
  qPipelineCodeQualityReports,
  qPipelines,
  qPipelineSecurityReportFindings,
  qPipelineTestSuites,
  qProjectMergeRequests,
  qProjects,
  qReleases,
  qGroupTimelogs,
  qUsers,
  qVulnerabilities,
  qVulnerabilityDiscussions,
  qWorkItems
  // qGroupLabels // Query doesn't exist yet
} from "./queries";
import type { Logger } from "@logtape/logtape";
// Correct AreaContext import - use 'type'
import type DataStorage from "../utils/datastorage";
import { CollectionTypes, type AreaContext } from "../utils/datastorage";
import { iterate, iterateOverOffset } from "../utils/gqliterator";
import { retryExchange } from "@urql/exchange-retry";

// Define placeholder types if import fails or not available
// Assuming these might be defined in ../../server/utils or similar
type GroupScope = { id: string; fullPath: string; name: string; /* add other fields if needed */ };
type ProjectScope = { id: string; fullPath: string; name: string; /* add other fields if needed */ };
type AuthorizationScopesResult = {
    groups: GroupScope[];
    projects: ProjectScope[];
};
// --- End Placeholder Types ---

import {
  Gitlab,
  type CommitSchema,
  type CommitStatsSchema,
  type OffsetPagination
} from "@gitbeaker/rest";
import { CrawlCommand, normalizeURL } from "../../lib/utils";

// Placeholder types for callbacks and IPC emitter
type DataCallback = (type: CollectionTypes, data: any) => Promise<any> | any;
type CallbackMap = Partial<Record<CollectionTypes, DataCallback>>;
type IpcEmitter = {
  sendProgress: (jobId: string, message: string, processed?: number, total?: number | null) => void;
};

type CommitResult = {
  paginationInfo: OffsetPagination;
  data: (CommitSchema & { stats: CommitStatsSchema })[];
};


// Define types for iterate calls below based on GraphQL fragments/queries
// Before, we tried using 'TypeName' syntax to refer to types
// defined within the Crawler class scope, but this seems not to work with TypeScript.
// We therefore now use them es explicit types, defined outside the class but within
// the same file for better organization and readability.
// --- Type Definitions ---
type UserType = { id: string; username: string; /* add other fields from fUserDetails */ };
type VulnerabilityType = { id: string; /* add fields from fVulnerabilityDetails */ };
type WorkItemType = { id: string; /* add fields from fWorkItemDetails */ };
type DescendantGroupType = { id: string; fullName: string; fullPath: string; };
type GroupProjectType = { id: string; nameWithNamespace: string; fullPath: string; };
type GroupMemberType = { id: string; /* add fields from fMemberDetails */ };
type GroupIssueType = { id: string; /* add fields from fIssueDetails */ };
type GroupTimelogType = { id: string; /* add fields from fTimelogDetails */ };
type ProjectReleaseType = { id: string; /* add fields from fReleaseDetails */ };
type ProjectMilestoneType = { id: string; /* add fields from fMilestoneDetails */ };
type ProjectMergeRequestType = { id: string; project?: { fullPath: string }; /* add fields from fMergeRequestDetails */ };
type ProjectPipelineType = { id: string; project?: { fullPath: string }; /* add fields from fPipelineDetails */ };
type DiscussionType = { id: string; /* add fields from fDiscussionDetails */ };
type CodeQualityReportType = { /* add fields from fCodeQualityDegradationDetails */ };
type SecurityFindingType = { /* add fields from fSecurityReportFindingDetails */ };
type TestSuiteType = { /* add fields from fTestSuiteSummaryDetails */ };
type IssueType = { id: string; projectId?: string; project?: { fullPath: string }; group?: { fullPath: string }; /* add fields from fIssueDetails */ };
// --- End Type Definitions ---

export class Crawler {
  // --- Class Properties ---
  logger: Logger;
  client: Client;
  restClient: InstanceType<typeof Gitlab>;
  storage: DataStorage;
  gqlURL: string;
  restURL: string;
  token: string;
  headers = new Headers();
  callbacks: CallbackMap;
  ipcEmitter: IpcEmitter | null;

  constructor(
    logger: Logger,
    gqlURL: string,
    restURL: string,
    token: string,
    storage: DataStorage,
    callbacks: CallbackMap = {},
    ipcEmitter: IpcEmitter | null = null
  ) {
    this.logger = logger;
    this.gqlURL = normalizeURL(gqlURL);
    this.restURL = normalizeURL(restURL);
    this.token = token;
    this.callbacks = callbacks;
    this.ipcEmitter = ipcEmitter;
    this.headers.append("Authorization", `Bearer ${this.token}`);
    this.client = this.getClient(this.gqlURL, token);
    this.restClient = new Gitlab({
      oauthToken: token,
      host: this.restURL
    });
    this.storage = storage;
  }

  // --- Protected/Private Helper Methods ---

  protected getClient(baseUrl: string, token: string): Client {
    const retryOptions = {
      initialDelayMs: 5000,
      maxDelayMs: 61000,
      randomDelay: true,
      maxNumberAttempts: 5
    };
    return new Client({
      url: baseUrl,
      exchanges: [cacheExchange, retryExchange(retryOptions), fetchExchange],
      fetchOptions: () => ({ headers: { authorization: token ? `Bearer ${token}` : "" } })
    });
  }

  private async applyCallbackAndSave(type: CollectionTypes, data: any, context: AreaContext): Promise<void> {
      let processedData = data;
      const callback = this.callbacks[type];
      if (callback) {
          try {
              if (Array.isArray(data)) {
                  processedData = await Promise.all(data.map(item => callback.call(null, type, item)));
              } else {
                  processedData = await callback.call(null, type, data);
              }
              if (Array.isArray(processedData)) {
                  processedData = processedData.filter(item => item != null);
              } else if (processedData == null) {
                  return;
              }
          } catch (error) {
              this.logger.error("Callback failed for type {type}: {error}", { type, error });
              processedData = data; // Save original data on callback error
          }
      }
      if (processedData && (!Array.isArray(processedData) || processedData.length > 0)) {
        // Use the storage instance passed to the constructor
        await this.storage.save(type, processedData, context);
      }
  }

  // --- Public API Methods ---

  public async determineAuthorizationScope(): Promise<AuthorizationScopesResult | null> {
    this.logger.info("Determining authorization scope (accessible groups and projects)");
    const allGroups: GroupScope[] = [];
    const allProjects: ProjectScope[] = [];
    let groupsAfter: string | null = null;
    let projectsAfter: string | null = null;
    const context: AreaContext = { type: 'global', fullPath: null };

    try {
      type AuthScopeResponse = {
          currentUser?: {
              groupMemberships?: { nodes: { group: GroupScope }[], pageInfo: { endCursor: string | null } },
              projectMemberships?: { nodes: { project: ProjectScope }[], pageInfo: { endCursor: string | null } }
          }
      };

      do {
        const response = await this.client.query<AuthScopeResponse>(qAuthorizationScope, { groupsAfter });
        if (response.error || !response.data?.currentUser?.groupMemberships) {
          this.logger.error("Failed to fetch group memberships", { error: response.error?.message });
          return null;
        }
        const memberships = response.data.currentUser.groupMemberships;
        const groups = memberships.nodes.map((n: { group: GroupScope }) => n.group).filter((g): g is GroupScope => !!g);
        if (groups.length > 0) {
            allGroups.push(...groups);
            // Save groups globally as they represent the scope, not specific group data yet
            await this.applyCallbackAndSave(CollectionTypes.Group, groups, context);
        }
        groupsAfter = memberships.pageInfo.endCursor;
      } while (groupsAfter);

      do {
        const response = await this.client.query<AuthScopeResponse>(qAuthorizationScope, { projectsAfter });
        if (response.error || !response.data?.currentUser?.projectMemberships) {
          this.logger.error("Failed to fetch project memberships", { error: response.error?.message });
          return null;
        }
        const memberships = response.data.currentUser.projectMemberships;
        const projects = memberships.nodes.map((n: { project: ProjectScope }) => n.project).filter((p): p is ProjectScope => !!p);
         if (projects.length > 0) {
            allProjects.push(...projects);
             // Save projects globally as they represent the scope
            await this.applyCallbackAndSave(CollectionTypes.Project, projects, context);
        }
        projectsAfter = memberships.pageInfo.endCursor;
      } while (projectsAfter);

      this.logger.info("Authorization scope determined: {groupCount} groups, {projectCount} projects", { groupCount: allGroups.length, projectCount: allProjects.length });
      return { groups: allGroups, projects: allProjects };

    } catch (error) {
      this.logger.error("Error determining authorization scope: {error}", { error });
      return null;
    }
  }

  public async crawl(command: CrawlCommand, fullPath: string | null, startCursor?: string | null): Promise<{ lastCursor: string | null }> {
    this.logger.info(`Starting crawl for command: {command} on {fullPath} from cursor {startCursor}`, { command, fullPath: fullPath ?? 'N/A', startCursor: startCursor ?? 'start' });
    let result: { lastCursor: string | null } = { lastCursor: null };

    if (command === CrawlCommand.authorizationScope) {
         this.logger.warn("Authorization scope command should be handled by the runner.");
         return { lastCursor: null };
    }

    if (!fullPath && ![CrawlCommand.users, CrawlCommand.vulnerabilities].includes(command)) {
        this.logger.error("FullPath is required for command {command}", { command });
        throw new Error(`FullPath is required for command ${command}`);
    }

    switch (command) {
      case CrawlCommand.group:
        result = await this.getGroup(fullPath!, startCursor);
        break;
      case CrawlCommand.project:
        result = await this.getProject(fullPath!, startCursor);
        break;
      case CrawlCommand.commits:
        // REST API - resuming logic is page-based, handled differently or not at all yet
        await this.getAllCommitsForProject(fullPath!);
        result = { lastCursor: null }; // Indicate completion for GraphQL cursor tracking
        break;
      case CrawlCommand.mergeRequests:
        result = await this.getProjectMergeRequests(fullPath!, startCursor);
        break;
      case CrawlCommand.workItems:
         result = await this.getWorkItems(fullPath!, startCursor);
         break;
      case CrawlCommand.issues:
        result = await this.getGroupIssues(fullPath!, this.logger, startCursor);
        break;
      case CrawlCommand.vulnerabilities:
        result = await this.getVulnerabilities(startCursor);
        break;
      case CrawlCommand.pipelines:
        result = await this.getProjectPipelines(fullPath!, this.logger, startCursor);
        break;
      case CrawlCommand.timelogs:
        result = await this.getGroupTimelogs(fullPath!, this.logger, startCursor);
        break;
      case CrawlCommand.users:
        result = await this.getUsers(startCursor);
        break;
      // case CrawlCommand.labels:
      //    result = await this.getGroupLabels(fullPath!, this.logger, startCursor);
      //    break;
      default:
        this.logger.warn("Unknown or unhandled crawl command: {command}", { command });
        result = { lastCursor: null };
        break;
    }
    this.logger.info(`Finished crawl iteration for command: {command} on {fullPath}. Last cursor: {lastCursor}`, { command, fullPath: fullPath ?? 'N/A', lastCursor: result.lastCursor ?? 'end' });
    return result;
  }

  // --- Getters for Specific Resources ---

  public async getGroup(fullPath: string, startCursor?: string | null): Promise<{ lastCursor: string | null }> {
    this.logger.info(`Fetching group details for: {fullPath}`, { fullPath });
    const context: AreaContext = { type: 'group', fullPath };
    // Fetch the single group - no pagination needed here for the group itself
    const response = await this.client.query(qGroups, { FullPath: fullPath, limit: 1 });
     if (response.error || !response.data?.groups?.nodes?.length) {
        this.logger.error("Failed to fetch group details for {fullPath}", { fullPath, error: response.error });
        return { lastCursor: null }; // Indicate failure/completion
    }
    const groupData = response.data.groups.nodes[0];
    await this.applyCallbackAndSave(CollectionTypes.Group, groupData, context);
    await this.enhanceGroup(groupData); // TODO: Pass resume state cursors
    return { lastCursor: null }; // Enhancement cursors handled internally for now
  }

  public async getProject(fullPath: string, startCursor?: string | null): Promise<{ lastCursor: string | null }> {
    this.logger.info(`Fetching project details for: {fullPath}`, { fullPath });
    const context: AreaContext = { type: 'project', fullPath };
     // Fetch the single project - no pagination needed here
    const response = await this.client.query(qProjects, { FullPath: fullPath, limit: 1 });
     if (response.error || !response.data?.projects?.nodes?.length) {
        this.logger.error("Failed to fetch project details for {fullPath}", { fullPath, error: response.error });
        return { lastCursor: null };
    }
    const projectData = response.data.projects.nodes[0];
    await this.applyCallbackAndSave(CollectionTypes.Project, projectData, context);
    await this.enhanceProject(projectData); // TODO: Pass resume state cursors
    return { lastCursor: null }; // Enhancement cursors handled internally for now
  }

  public async getUsers(startCursor?: string | null): Promise<{ lastCursor: string | null }> {
    const context: AreaContext = { type: 'global', fullPath: null };
    return iterate<TypedDocumentNode<any, any>, UserType>(this.logger, this.client, ["users"], qUsers, { limit: 100 }, undefined,
      async (res) => {
        await this.applyCallbackAndSave(CollectionTypes.User, res, context);
        // TODO: Report progress via IPC
      },
      startCursor
    );
  }

  public async getVulnerabilities(startCursor?: string | null): Promise<{ lastCursor: string | null }> {
     const context: AreaContext = { type: 'global', fullPath: null };
     return iterate<TypedDocumentNode<any, any>, VulnerabilityType>(
       this.logger, this.client, ["vulnerabilities"], qVulnerabilities, {},
       this.enhanceVulnerability.bind(this),
       async (res) => { /* Saved in enhance */ },
       startCursor
     );
  }

  public async getWorkItems(projectFullPath: string, startCursor?: string | null): Promise<{ lastCursor: string | null }> {
    const context: AreaContext = { type: 'project', fullPath: projectFullPath };
    return iterate<TypedDocumentNode<any, any>, WorkItemType>(
      this.logger, this.client, ["project", "workItems"], qWorkItems, { FullPath: projectFullPath },
      undefined,
      async (results) => {
        if (results && results.length > 0) {
          await this.applyCallbackAndSave(CollectionTypes.WorkItem, results, context);
        }
      },
      startCursor
    );
  }

  // --- Enhancement Methods ---

  public async enhanceGroup(group: any): Promise<void> {
    const logger = this.logger.with({ groupFullPath: group.fullPath });
    logger.info("Enhancing group {groupFullPath}", { groupFullPath: group.fullPath });

    const descCursor = null; // Placeholder
    const projCursor = null; // Placeholder
    const memCursor = null; // Placeholder
    const issueCursor = null; // Placeholder
    const timeCursor = null; // Placeholder

    // TODO: Retrieve cursors from resumeState and update after calls
    // TODO: Handle lastCursor return values from helpers
    await this.getDescendantGroups(group.fullPath, logger, descCursor);
    await this.getGroupProjects(group.fullPath, logger, projCursor);
    await this.getGroupMembers(group.fullPath, logger, memCursor);
    await this.getGroupIssues(group.fullPath, logger, issueCursor);
    await this.getGroupTimelogs(group.fullPath, logger, timeCursor);
  }

  public async enhanceProject(project: any): Promise<void> {
    const logger = this.logger.with({ projectFullPath: project.fullPath });
    logger.info("Enhancing project {projectFullPath}", { projectFullPath: project.fullPath });

    const releaseCursor = null; // Placeholder
    const milestoneCursor = null; // Placeholder
    const mrCursor = null; // Placeholder
    const pipelineCursor = null; // Placeholder

    // TODO: Retrieve cursors from resumeState and update after calls
    // TODO: Handle lastCursor return values from helpers
    project.branchNames = await this.getProjectBranchNames(project.fullPath, logger);
    await this.getProjectReleases(project.fullPath, logger, releaseCursor);
    await this.getProjectMilestones(project.fullPath, logger, milestoneCursor);
    await this.getProjectMergeRequests(project.fullPath, mrCursor);
    await this.getProjectPipelines(project.fullPath, logger, pipelineCursor);
    await this.getAllCommitsForProject(project.fullPath); // REST - no cursor yet
  }

  public async enhanceVulnerability(vulnerability: any): Promise<void> {
    const logger = this.logger.with({ vulnerabilityId: vulnerability.id });
    const context: AreaContext = { type: 'global', fullPath: null };
    const discussionCursor = null; // TODO: Get cursor

    logger.debug("Enhancing vulnerability {vulnerabilityId} - fetching discussions", { vulnerabilityId: vulnerability.id });
    vulnerability.discussions = vulnerability.discussions ?? [];
    const discussionResult = await this.getVulnerabilityDiscussions(vulnerability.id, logger, discussionCursor);
    // TODO: Update resume state with discussionResult.lastCursor
    await this.applyCallbackAndSave(CollectionTypes.Vulnerability, vulnerability, context);
  }

  public async enhanceMergeRequest(mergeRequest: ProjectMergeRequestType): Promise<void> {
    const logger = this.logger.with({ mergeRequestId: mergeRequest.id, projectFullPath: mergeRequest.project?.fullPath });
    const context: AreaContext = { type: 'project', fullPath: mergeRequest.project?.fullPath ?? null };
    const discussionCursor = null; // TODO: Get cursor

    logger.debug("Enhancing MR {mergeRequestId} - fetching discussions", { mergeRequestId: mergeRequest.id });
    (mergeRequest as any).discussions = (mergeRequest as any).discussions ?? [];
    const discussionResult = await this.getMergeRequestDiscussions(mergeRequest.id, logger, discussionCursor);
    // TODO: Update resume state with discussionResult.lastCursor
    await this.applyCallbackAndSave(CollectionTypes.Mergerequest, mergeRequest, context);
  }

  public async enhanceIssue(issue: IssueType): Promise<void> {
    const logger = this.logger.with({ issueId: issue.id, projectFullPath: issue.project?.fullPath });
    const context: AreaContext = { type: issue.projectId ? 'project' : 'group', fullPath: issue.project?.fullPath ?? issue.group?.fullPath ?? null };
    const discussionCursor = null; // TODO: Get cursor

    logger.debug("Enhancing Issue {issueId} - fetching discussions", { issueId: issue.id });
    (issue as any).discussions = (issue as any).discussions ?? [];
    const discussionResult = await this.getIssueDiscussions(issue.id, logger, discussionCursor);
    // TODO: Update resume state with discussionResult.lastCursor
    await this.applyCallbackAndSave(CollectionTypes.Issue, issue, context);
  }

  public async enhancePipeline(pipeline: ProjectPipelineType): Promise<void> {
    const logger = this.logger.with({ pipelineId: pipeline.id, projectFullPath: pipeline.project?.fullPath });
    const context: AreaContext = { type: 'project', fullPath: pipeline.project?.fullPath ?? null };
    const cqCursor = null; // TODO: Get cursor
    const secCursor = null; // TODO: Get cursor
    const testCursor = null; // TODO: Get cursor

    logger.debug("Enhancing Pipeline {pipelineId} - fetching reports", { pipelineId: pipeline.id });
    (pipeline as any).codeQualityReports = (pipeline as any).codeQualityReports ?? [];
    const cqResult = await this.getPipelineCodeQualityReports(context.fullPath!, pipeline.id, logger, cqCursor);
    // TODO: Update resume state with cqResult.lastCursor

    (pipeline as any).securityReportFindings = (pipeline as any).securityReportFindings ?? [];
    const secResult = await this.getPipelineSecurityReportFindings(context.fullPath!, pipeline.id, logger, secCursor);
     // TODO: Update resume state with secResult.lastCursor

    (pipeline as any).testSuites = (pipeline as any).testSuites ?? [];
    const testResult = await this.getPipelineTestSuites(context.fullPath!, pipeline.id, logger, testCursor);
     // TODO: Update resume state with testResult.lastCursor

     await this.applyCallbackAndSave(CollectionTypes.Pipeline, pipeline, context);
  }

  // --- Helper Methods for Fetching Sub-Resources ---

  public async getDescendantGroups(fullPath: string, logger: Logger, startCursor?: string | null): Promise<{ lastCursor: string | null }> {
    return iterate<TypedDocumentNode<any, any>, DescendantGroupType>(
      logger, this.client, ["group", "descendantGroups"], qDescendantGroups, { FullPath: fullPath },
      undefined, // No enhance needed for the list itself
      async (results) => {
        if (results) {
          for (const group of results) {
              // Use group.fullPath for context when saving individual descendant groups
              await this.applyCallbackAndSave(CollectionTypes.Group, group, { type: 'group', fullPath: group.fullPath });
          }
        }
      },
      startCursor
    );
  }

  public async getGroupProjects(fullPath: string, logger: Logger, startCursor?: string | null): Promise<{ lastCursor: string | null }> {
    return iterate<TypedDocumentNode<any, any>, GroupProjectType>(
      logger, this.client, ["group", "projects"], qGroupProjects, { FullPath: fullPath },
      undefined, // No enhance needed for the list itself
      async (results) => {
        if (results) {
           for (const project of results) {
               // Use project.fullPath for context when saving individual projects
               await this.applyCallbackAndSave(CollectionTypes.Project, project, { type: 'project', fullPath: project.fullPath });
           }
        }
      },
      startCursor
    );
  }

  public async getGroupMembers(fullPath: string, logger: Logger, startCursor?: string | null): Promise<{ lastCursor: string | null }> {
    const context: AreaContext = { type: 'group', fullPath };
    return iterate<TypedDocumentNode<any, any>, GroupMemberType>(
      logger, this.client, ["group", "groupMembers"], qGroupMembers, { FullPath: fullPath },
      undefined, // Enhance member details if needed (e.g., fetch full user)
      async (results) => {
        if (results) {
          // Saving members under the parent group's context
          // Consider saving as CollectionTypes.Member if that enum exists and makes sense
          await this.applyCallbackAndSave(CollectionTypes.Group, results, context); // Or CollectionTypes.Member?
        }
      },
      startCursor
    );
  }

  public async getGroupIssues(fullPath: string, logger: Logger, startCursor?: string | null): Promise<{ lastCursor: string | null }> {
    return iterate<TypedDocumentNode<any, any>, GroupIssueType>(
      logger, this.client, ["group", "issues"], qGroupIssues, { FullPath: fullPath },
      this.enhanceIssue.bind(this),
      async (results) => { /* Saved in enhance */ },
      startCursor
    );
  }

  public async getGroupTimelogs(fullPath: string, logger: Logger, startCursor?: string | null): Promise<{ lastCursor: string | null }> {
    const context: AreaContext = { type: 'group', fullPath };
    return iterate<TypedDocumentNode<any, any>, GroupTimelogType>(
      logger, this.client, ["group", "timelogs"], qGroupTimelogs, { FullPath: fullPath },
      undefined, // No enhancement needed
      async (results) => {
          await this.applyCallbackAndSave(CollectionTypes.Timelog, results, context);
      },
      startCursor
    );
  }

  public async getProjectBranchNames(fullPath: string, logger: Logger): Promise<string[]> {
     // Offset pagination, returns all at once. No cursor handling needed here.
     return iterateOverOffset<TypedDocumentNode<any, any>, string>(
       logger, this.client, ["project", "repository", "branchNames"], qBranches, { FullPath: fullPath }
     );
  }

  public async getProjectReleases(fullPath: string, logger: Logger, startCursor?: string | null): Promise<{ lastCursor: string | null }> {
    const context: AreaContext = { type: 'project', fullPath };
    return iterate<TypedDocumentNode<any, any>, ProjectReleaseType>(
      logger, this.client, ["project", "releases"], qReleases, { FullPath: fullPath },
      undefined, // Enhance release if needed
      async (results) => {
        if (results) {
          await this.applyCallbackAndSave(CollectionTypes.Release, results, context);
        }
      },
      startCursor
    );
  }

  public async getProjectMilestones(fullPath: string, logger: Logger, startCursor?: string | null): Promise<{ lastCursor: string | null }> {
    const context: AreaContext = { type: 'project', fullPath };
    return iterate<TypedDocumentNode<any, any>, ProjectMilestoneType>(
      logger, this.client, ["project", "milestones"], qMilestones, { FullPath: fullPath },
      undefined, // Enhance milestone if needed
      async (results) => {
        if (results) {
          await this.applyCallbackAndSave(CollectionTypes.Milestone, results, context);
        }
      },
      startCursor
    );
  }

  public async getProjectMergeRequests(fullPath: string, startCursor?: string | null): Promise<{ lastCursor: string | null }> {
    const logger = this.logger.with({ fullPath });
    return iterate<TypedDocumentNode<any, any>, ProjectMergeRequestType>(
      logger, this.client, ["project", "mergeRequests"], qProjectMergeRequests, { FullPath: fullPath, limit: 50 },
      this.enhanceMergeRequest.bind(this),
      async (results) => { /* Saved in enhance */ },
      startCursor
    );
  }

  public async getProjectPipelines(fullPath: string, logger: Logger, startCursor?: string | null): Promise<{ lastCursor: string | null }> {
    return iterate<TypedDocumentNode<any, any>, ProjectPipelineType>(
      logger, this.client, ["project", "pipelines"], qPipelines, { FullPath: fullPath },
      this.enhancePipeline.bind(this),
      async (results) => { /* Saved in enhance */ },
      startCursor
    );
  }

  public async getMergeRequestDiscussions(mergeRequestId: string, logger: Logger, startCursor?: string | null): Promise<{ lastCursor: string | null }> {
     // TODO: Determine project context dynamically if possible
     const context: AreaContext = { type: 'project', fullPath: null }; // Placeholder context
     return iterate<TypedDocumentNode<any, any>, DiscussionType>(
       logger, this.client, ["mergeRequest", "discussions"], qMergeRequestDiscussions, { ID: mergeRequestId },
       undefined, // Enhance note details if needed
       async (results) => {
         if (results) {
           await this.applyCallbackAndSave(CollectionTypes.Discussion, results, context);
         }
       },
       startCursor
     );
  }

  public async getIssueDiscussions(issueId: string, logger: Logger, startCursor?: string | null): Promise<{ lastCursor: string | null }> {
     // TODO: Determine project/group context dynamically if possible
     const context: AreaContext = { type: 'global', fullPath: null }; // Placeholder context
     return iterate<TypedDocumentNode<any, any>, DiscussionType>(
       logger, this.client, ["issue", "discussions"], qIssueDiscussions, { ID: issueId },
       undefined,
       async (results) => {
         if (results) {
           await this.applyCallbackAndSave(CollectionTypes.Discussion, results, context);
         }
       },
       startCursor
     );
  }

  public async getVulnerabilityDiscussions(vulnerabilityId: string, logger: Logger, startCursor?: string | null): Promise<{ lastCursor: string | null }> {
     const context: AreaContext = { type: 'global', fullPath: null };
     return iterate<TypedDocumentNode<any, any>, DiscussionType>(
       logger, this.client, ["vulnerability", "discussions"], qVulnerabilityDiscussions, { ID: vulnerabilityId },
       undefined,
       async (results) => {
         if (results) {
           await this.applyCallbackAndSave(CollectionTypes.Discussion, results, context);
         }
       },
       startCursor
     );
  }

  public async getPipelineCodeQualityReports(fullPath: string, pipelineId: string, logger: Logger, startCursor?: string | null): Promise<{ lastCursor: string | null }> {
     const context: AreaContext = { type: 'project', fullPath };
     return iterate<TypedDocumentNode<any, any>, CodeQualityReportType>(
       logger, this.client, ["project", "pipeline", "codeQualityReports"], qPipelineCodeQualityReports, { FullPath: fullPath, ID: pipelineId },
       undefined,
       async (results) => { /* Saved in enhance */ },
       startCursor
     );
  }

  public async getPipelineSecurityReportFindings(fullPath: string, pipelineId: string, logger: Logger, startCursor?: string | null): Promise<{ lastCursor: string | null }> {
     const context: AreaContext = { type: 'project', fullPath };
     return iterate<TypedDocumentNode<any, any>, SecurityFindingType>(
       logger, this.client, ["project", "pipeline", "securityReportFindings"], qPipelineSecurityReportFindings, { FullPath: fullPath, ID: pipelineId },
       undefined,
       async (results) => { /* Saved in enhance */ },
       startCursor
     );
  }

  public async getPipelineTestSuites(fullPath: string, pipelineId: string, logger: Logger, startCursor?: string | null): Promise<{ lastCursor: string | null }> {
     const context: AreaContext = { type: 'project', fullPath };
     return iterate<TypedDocumentNode<any, any>, TestSuiteType>(
       logger, this.client, ["project", "pipeline", "testReportSummary", "testSuites"], qPipelineTestSuites, { FullPath: fullPath, ID: pipelineId },
       undefined,
       async (results) => { /* Saved in enhance */ },
       startCursor
     );
  }
} // End of Crawler class
