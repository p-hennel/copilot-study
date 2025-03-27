import { cacheExchange, Client, fetchExchange } from "@urql/core";
import {
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
} from "./queries";
import type { Logger } from "@logtape/logtape";
import type DataStorage from "../utils/datastorage";
import { CollectionTypes } from "../utils/datastorage";
import { iterate, iterateOverOffset } from "../utils/gqliterator";
import { retryExchange } from "@urql/exchange-retry";
import {
  Gitlab,
  type CommitSchema,
  type CommitStatsSchema,
  type OffsetPagination
} from "@gitbeaker/rest";
import { CrawlCommand, normalizeURL } from "../../utils";

type CommitResult = {
  paginationInfo: OffsetPagination;
  data: (CommitSchema & { stats: CommitStatsSchema })[];
};

/* General Strategy:
 * 1. List Users (... iterate)
 * 3. List Groups (... iterate)
 * 3.1. List Descendant Groups (... iterate)
 * 3.2. List Memberships (... iterate)
 * 3.3. List Labels (... iterate)
 * 3.4. List Issues (... iterate)
 * 3.5. List Timelogs (... iterate)
 * 4. List Projects (... iterate)
 * 4.1. List Branches (... iterate)
 * 4.2. List Merge Requests (... iterate)
 * 4.2.1. List Discussions (... iterate)
 * 4.3. List Releases (... iterate)
 * 4.4. List Milestones (... iterate)
 * 4.5. List Pipelines (... iterate)
 * 4.5.1 List Code Quality Reports (... iterate)
 * 4.5.2 List Security Report Findings (... iterate)
 * 4.5.3 List Test Suites (... iterate)
 * 4.6. CRAWL COMMITS VIA REST (... iterate)
 * 5. List Vulnerabilities (... iterate)
 * 5.1. List Discussions (... iterate)
 */
export class Crawler {
  logger: Logger;
  client: Client;
  restClient;
  storage: DataStorage;
  gqlURL: string;
  restURL: string;
  token: string;
  headers = new Headers();

  constructor(
    logger: Logger,
    gqlURL: string,
    restURL: string,
    token: string,
    storage: DataStorage
  ) {
    this.logger = logger;
    this.gqlURL = normalizeURL(gqlURL);
    this.restURL = normalizeURL(restURL);
    this.token = token;
    this.headers.append("Authorization", `Bearer ${this.token}`);
    this.client = this.getClient(this.gqlURL, token);
    this.restClient = new Gitlab({
      oauthToken: token,
      host: this.restURL
    });
    this.storage = storage;
  }

  /**
 * Fetches all commits for a project across all branches.
 * @param projectId - The ID (or fullPath, if your Gitbeaker instance supports it) of the project.
 * @returns An array containing all commits from every branch.
 */
public async getAllCommitsForProject(projectId: string): Promise<void> {
  this.logger.info(`Fetching all commits for project ${projectId} on all branches`);
  try {
    // Retrieve all branches for the project
    const branches = await this.restClient.Branches.all(projectId);
    this.logger.info(`Found ${branches.length} branches in project ${projectId}`);

    // Loop through each branch
    for (const branch of branches) {
      let page = 1;
      let commits: any[] = [];
      this.logger.info(`Fetching commits for branch ${branch.name}`);
      
      // Paginate through commits on this branch until fewer than 100 commits are returned.
      do {
        commits = await this.restClient.Commits.all(projectId, {
          refName: branch.name,
          perPage: 100,
          page: page,
        });
        this.logger.debug(`Fetched ${commits.length} commits from branch ${branch.name} (page ${page})`);
        this.storage.save(CollectionTypes.Commit, commits);
        page++;
      } while (commits.length === 100);
    }
  } catch (error) {
    this.logger.error("Error fetching commits for project: {error}", {error});
  }
}

  /**
   * getAuthorizationScope - Crawls all groups and projects accessible to the authenticated user.
   * This gives an overview of the authorization scope.
   */
  public async getAuthorizationScope(): Promise<void> {
    this.logger.info("Fetching authorization scope: groups and projects accessible to the user");
    // Run both in parallel for efficiency
    await Promise.all([this.getGroups(), this.getProjects()]);
    // Optionally, you can also call getUsers() if needed.
    this.logger.info("Authorization scope fetched");
  }

  /**
   * crawl - Dispatches crawling logic based on the provided crawl command.
   * @param command - The crawl command as defined in the CrawlCommand enum.
   * @param fullPath - The identifier (full path) of the project or group to crawl.
   */
  public async crawl(command: CrawlCommand, fullPath: string): Promise<void> {
    this.logger.info(`Starting crawl for command: ${command} on ${fullPath}`);
    switch (command) {
      case CrawlCommand.authorizationScope:
        await this.getAuthorizationScope();
        break;
      case CrawlCommand.group:
        await this.getGroup(fullPath);
        break;
      case CrawlCommand.project:
        await this.getProject(fullPath);
        break;
      case CrawlCommand.commits:
        await this.getAllCommitsForProject(fullPath);
        break;
      case CrawlCommand.mergeRequests:
        await this.getProjectMergeRequests(fullPath);
        break;
      case CrawlCommand.workItems:
      case CrawlCommand.issues:
        await this.getWorkItems(fullPath);
        break;
      case CrawlCommand.vulnerabilities:
        await this.getVulnerabilities();
        break;
      case CrawlCommand.pipelines:
        await this.getProjectPipelines(fullPath, this.logger);
        break;
      case CrawlCommand.timelogs:
        await this.getGroupTimelogs(fullPath, this.logger);
        break;
      case CrawlCommand.users:
        await this.getUsers();
        break;
      default:
        this.logger.warn("Unknown crawl command", { command });
        break;
    }
    this.logger.info(`Finished crawl for command: ${command}`);
  }
  
  public async getGroup(fullPath: string): Promise<void> {
    this.logger.info(`Fetching group with fullPath: ${fullPath}`);
    await iterate<typeof qGroups>(
      this.logger,
      this.client,
      "groups",
      qGroups,
      { FullPath: fullPath },
      undefined,
      (res) => {
        if (res && res.length > 0) {
          this.storage.save(CollectionTypes.Group, res[0]);
        }
      }
    );
  }
  
  public async getProject(fullPath: string): Promise<void> {
    this.logger.info(`Fetching project with fullPath: ${fullPath}`);
    await iterate<typeof qProjects>(
      this.logger,
      this.client,
      "projects",
      qProjects,
      { FullPath: fullPath },
      undefined,
      (res) => {
        if (res && res.length > 0) {
          this.storage.save(CollectionTypes.Project, res[0]);
        }
      }
    );
  }

  protected getClient(baseUrl: string, token: string) {
    const retryOptions = {
      initialDelayMs: 5000,
      maxDelayMs: 61000,
      randomDelay: true,
      maxNumberAttempts: 5
    };
    return new Client({
      url: baseUrl,
      exchanges: [cacheExchange, retryExchange(retryOptions), fetchExchange],
      fetchOptions: () => {
        return {
          headers: { authorization: token ? `Bearer ${token}` : "" }
        };
      }
    });
  }

  public async run() {
    return await Promise.all([
      this.getUsers(),
      this.getGroups(),
      this.getProjects(),
      this.getVulnerabilities()
    ]);
  }

  /*
   * 1. List Users
   */
  public async getUsers() {
    await iterate<typeof qUsers>(this.logger, this.client, "users", qUsers, { limit: 10 }, (res) =>
      this.storage.save(CollectionTypes.User, res)
    );
  }

  /*
   * 2. List Groups
   */
  public async getGroups() {
    await iterate<typeof qGroups>(
      this.logger,
      this.client,
      "groups",
      qGroups,
      { limit: 2 },
      this.enhanceGroup.bind(this)
    );
  }


  /*
   * 3.1. List Descendant Groups
   * 3.2. List Memberships
   * 3.3. List Projects
   * 3.4. List Issues
   */
  public async enhanceGroup(group: any) {
    const logger = this.logger.with({ group });
    logger.warn("enhancing group {group}", group);
    group.descendantGroups = group.descendantGroups ?? [];
    await this.getDescendantGroups(group.fullPath, logger);
    group.projects = group.projects ?? [];
    await this.getGroupProjects(group.fullPath, logger);
    group.members = group.members ?? [];
    await this.getGroupMembers(group.fullPath, logger);

    this.storage.save(CollectionTypes.Group, group);

    await this.getGroupIssues(group.fullPath, logger);
    await this.getGroupTimelogs(group.fullPath, logger);
  }

  /*
   * 4. List Projects
   */
  public async getProjects() {
    await iterate<typeof qProjects>(
      this.logger,
      this.client,
      "projects",
      qProjects,
      {},
      this.enhanceProject.bind(this)
    );
  }

  /*
   * 4.1. List Branches (... iterate)
   * 4.2. List Merge Requests (... iterate)
   * 4.3. List Releases (... iterate)
   * 4.4. List Milestones (... iterate)
   * 4.5. List Pipelines (... iterate)
   * 4.6. CRAWL COMMITS VIA REST (... iterate)
   */
  public async enhanceProject(project: any) {
    const logger = this.logger.with({ id: project.id, fullPath: project.fullPath });

    project.branchNames = await this.getProjectBranchNames(project.fullPath, logger);
    project.releases = project.releases ?? [];
    await this.getProjectReleases(project.fullPath, logger);
    project.milestones = project.milestones ?? [];
    await this.getProjectMilestones(project.fullPath, logger);

    this.storage.save(CollectionTypes.Project, project);

    await this.getProjectMergeRequests(project.fullPath);
    await this.getProjectPipelines(project.fullPath, logger);

    if (Array.isArray(project.branchNames)) {
      for (const branch of project.branchNames) {
        await this.getCommits(project.id, branch);
      }
    } else {
      this.logger.warn("No branchNames array found for project", { projectId: project.id });
    }
  }

  public async getCommits(id: string, branch: string, perPage = 100): Promise<void> {
    let pagination: OffsetPagination | undefined = undefined;
    do {
      const result: CommitResult = await this.restClient.Commits.all(id, {
        refName: branch,
        all: true,
        withStats: true,
        order: "topo",
        firstParent: false,
        page: pagination?.next ?? 1,
        perPage: perPage,
        showExpanded: true,
        maxPages: 1
      });

      // Check if the result has valid commit data
      if (!result || !Array.isArray(result.data) || result.data.length === 0) {
        this.logger.warn("No commits result for branch", { projectId: id, branch });
        break;
      }

      // Save the commit data
      this.storage.save(CollectionTypes.Commit, result.data);

      pagination = result.paginationInfo;
    } while (pagination && pagination.totalPages > pagination.current);
  }

  /*
   * 5. List Vulnerabilities
   */
  public async getVulnerabilities() {
    await iterate<typeof qVulnerabilities>(
      this.logger,
      this.client,
      ["vulnerabilities"],
      qVulnerabilities,
      {},
      this.enhanceVulnerability.bind(this)
    );
  }

  /*
   * 5.1. List Discussions (... iterate)
   */
  public async enhanceVulnerability(vulnerability: any) {
    const logger = this.logger.with({ vulnerability });
    vulnerability.discussions = vulnerability.discussions ?? [];
    await iterate<typeof qVulnerabilityDiscussions>(
      logger,
      this.client,
      ["vulnerability", "discussions"],
      qVulnerabilityDiscussions,
      { ID: vulnerability.id },
      undefined,
      (results) => {
        if (!!results) vulnerability.discussions.push(...results);
      }
    );

    this.storage.save(CollectionTypes.Vulnerability, vulnerability);
  }

  public async getWorkItems(projectFullPath: string) {
    await iterate<typeof qWorkItems>(
      this.logger,
      this.client,
      ["project", "workItems"],
      qWorkItems,
      { FullPath: projectFullPath },
      undefined,
      (results) => {
        if (results && results.length > 0) {
          this.storage.save(CollectionTypes.WorkItem, results);
        }
      }
    );
  }

  /*
   * 4.2.1. List Discussions (... iterate)
   */
  public async enhanceMergeRequest(mergeRequest: any) {
    const logger = this.logger.with({ mergeRequest });
    mergeRequest.discussions = mergeRequest.discussions ?? [];
    await iterate<typeof qMergeRequestDiscussions>(
      logger,
      this.client,
      ["mergeRequest", "discussions"],
      qMergeRequestDiscussions,
      { ID: mergeRequest.id },
      undefined,
      (results) => {
        if (!!results) mergeRequest.discussions.push(...results);
      }
    );

    this.storage.save(CollectionTypes.Mergerequest, mergeRequest);
  }

  public async enhanceIssue(issue: any) {
    const logger = this.logger.with({ issue });
    issue.discussions = issue.discussions ?? [];
    await iterate<typeof qIssueDiscussions>(
      logger,
      this.client,
      ["issue", "discussions"],
      qIssueDiscussions,
      { ID: issue.id },
      undefined,
      (results) => {
        if (!!results) issue.discussions.push(...results);
      }
    );

    this.storage.save(CollectionTypes.Issue, issue);
  }
  /*
   * 4.5.1 List Code Quality Reports (... iterate)
   * 4.5.2 List Security Report Findings (... iterate)
   * 4.5.3 List Test Suites (... iterate)
   */
  public async enhancePipeline(pipeline: any) {
    const logger = this.logger.with({ pipeline });
    pipeline.codeQualityReports = pipeline.codeQualityReports ?? [];
    await iterate<typeof qPipelineCodeQualityReports>(
      logger,
      this.client,
      ["project", "pipeline", "codeQualityReports"],
      qPipelineCodeQualityReports,
      { FullPath: pipeline.project.fullPath, ID: pipeline.id },
      undefined,
      (results) => {
        if (results) {
          pipeline.codeQualityReports.push(...results);
        }
      }
    );
    pipeline.securityReportFindings = pipeline.securityReportFindings ?? [];
    await iterate<typeof qPipelineSecurityReportFindings>(
      logger,
      this.client,
      ["project", "pipeline", "securityReportFindings"],
      qPipelineSecurityReportFindings,
      { FullPath: pipeline.project.fullPath, ID: pipeline.id },
      undefined,
      (results) => {
        if (!!results) {
          pipeline.securityReportFindings.push(...results);
        }
      }
    );
    pipeline.testSuites = pipeline.testSuites ?? [];
    await iterate<typeof qPipelineTestSuites>(
      logger,
      this.client,
      ["project", "pipeline", "testReportSummary", "testSuites"],
      qPipelineTestSuites,
      { FullPath: pipeline.project.fullPath, ID: pipeline.id },
      undefined,
      (results) => {
        if (!!results) {
          pipeline.testSuites.push(...results);
        }
      }
    );
  }

  /**
   * Helper: Fetch descendant groups for a given fullPath.
   */
  public async getDescendantGroups(fullPath: string, logger: Logger): Promise<void> {
    await iterate<typeof qDescendantGroups>(
      logger,
      this.client,
      ["group", "descendantGroups"],
      qDescendantGroups,
      { FullPath: fullPath },
      undefined,
      (results) => {
        if (results) {
          // Process descendant groups as needed; here, we merge them into storage.
          this.storage.save(CollectionTypes.Group, results);
        }
      }
    );
  }

  /**
   * Helper: Fetch group projects for a given fullPath.
   */
  public async getGroupProjects(fullPath: string, logger: Logger): Promise<void> {
    await iterate<typeof qGroupProjects>(
      logger,
      this.client,
      ["group", "projects"],
      qGroupProjects,
      { FullPath: fullPath },
      undefined,
      (results) => {
        if (results) {
          this.storage.save(CollectionTypes.Project, results);
        }
      }
    );
  }

  /**
   * Helper: Fetch group members for a given fullPath.
   */
  public async getGroupMembers(fullPath: string, logger: Logger): Promise<void> {
    await iterate<typeof qGroupMembers>(
      logger,
      this.client,
      ["group", "groupMembers"],
      qGroupMembers,
      { FullPath: fullPath },
      undefined,
      (results) => {
        if (results) {
          this.storage.save(CollectionTypes.Group, results);
        }
      }
    );
  }

  /**
   * Helper: Fetch group issues for a given fullPath.
   */
  public async getGroupIssues(fullPath: string, logger: Logger): Promise<void> {
    await iterate<typeof qGroupIssues>(
      logger,
      this.client,
      ["group", "issues"],
      qGroupIssues,
      { FullPath: fullPath },
      this.enhanceIssue.bind(this)
    );
  }

  /**
   * Helper: Fetch group timelogs for a given fullPath.
   */
  public async getGroupTimelogs(fullPath: string, logger: Logger): Promise<void> {
    await iterate<typeof qGroupTimelogs>(
      logger,
      this.client,
      ["group", "timelogs"],
      qGroupTimelogs,
      { FullPath: fullPath },
      undefined,
      (results) => this.storage.save(CollectionTypes.Timelog, results)
    );
  }

  /**
   * Helper: Fetch project branch names for a given fullPath.
   */
  public async getProjectBranchNames(fullPath: string, logger: Logger): Promise<any[]> {
    return await iterateOverOffset(
      logger,
      this.client,
      ["project", "repository", "branchNames"],
      qBranches,
      { FullPath: fullPath }
    );
  }

  /**
   * Helper: Fetch project releases for a given fullPath.
   */
  public async getProjectReleases(fullPath: string, logger: Logger): Promise<void> {
    await iterate<typeof qReleases>(
      logger,
      this.client,
      ["project", "releases"],
      qReleases,
      { FullPath: fullPath },
      undefined,
      (results) => {
        if (results) {
          this.storage.save(CollectionTypes.Project, results);
        }
      }
    );
  }

  /**
   * Helper: Fetch project milestones for a given fullPath.
   */
  public async getProjectMilestones(fullPath: string, logger: Logger): Promise<void> {
    await iterate<typeof qMilestones>(
      logger,
      this.client,
      ["project", "milestones"],
      qMilestones,
      { FullPath: fullPath },
      undefined,
      (results) => {
        if (results) {
          this.storage.save(CollectionTypes.Project, results);
        }
      }
    );
  }

  /**
   * Helper: Fetch project merge requests for a given fullPath.
   */
  public async getProjectMergeRequests(fullPath: string): Promise<void> {
    const logger = this.logger.with({ fullPath });
    await iterate<typeof qProjectMergeRequests>(
      logger,
      this.client,
      ["project", "mergeRequests"],
      qProjectMergeRequests,
      { FullPath: fullPath, limit: 10 },
      this.enhanceMergeRequest.bind(this)
    );
  }

  /**
   * Helper: Fetch project pipelines for a given fullPath.
   */
  public async getProjectPipelines(fullPath: string, logger: Logger): Promise<void> {
    await iterate<typeof qPipelines>(
      logger,
      this.client,
      ["project", "pipelines"],
      qPipelines,
      { FullPath: fullPath },
      this.enhancePipeline.bind(this)
    );
  }

  /**
   * Helper: Fetch merge request discussions for a given merge request ID.
   */
  public async getMergeRequestDiscussions(mergeRequestId: string, logger: Logger): Promise<void> {
    await iterate<typeof qMergeRequestDiscussions>(
      logger,
      this.client,
      ["mergeRequest", "discussions"],
      qMergeRequestDiscussions,
      { ID: mergeRequestId },
      undefined,
      (results) => {
        if (results) {
          // Process or save merge request discussions as needed.
        }
      }
    );
  }

  /**
   * Helper: Fetch issue discussions for a given issue ID.
   */
  public async getIssueDiscussions(issueId: string, logger: Logger): Promise<void> {
    await iterate<typeof qIssueDiscussions>(
      logger,
      this.client,
      ["issue", "discussions"],
      qIssueDiscussions,
      { ID: issueId },
      undefined,
      (results) => {
        if (results) {
          // Process or save issue discussions as needed.
        }
      }
    );
  }

  /**
   * Helper: Fetch vulnerability discussions for a given vulnerability ID.
   */
  public async getVulnerabilityDiscussions(vulnerabilityId: string, logger: Logger): Promise<void> {
    await iterate<typeof qVulnerabilityDiscussions>(
      logger,
      this.client,
      ["vulnerability", "discussions"],
      qVulnerabilityDiscussions,
      { ID: vulnerabilityId },
      undefined,
      (results) => {
        if (results) {
          // Process or save vulnerability discussions as needed.
        }
      }
    );
  }

  /**
   * Helper: Fetch pipeline code quality reports.
   */
  public async getPipelineCodeQualityReports(fullPath: string, pipelineId: string, logger: Logger): Promise<void> {
    await iterate<typeof qPipelineCodeQualityReports>(
      logger,
      this.client,
      ["project", "pipeline", "codeQualityReports"],
      qPipelineCodeQualityReports,
      { FullPath: fullPath, ID: pipelineId },
      undefined,
      (results) => {
        if (results) {
          // Process code quality reports as needed.
        }
      }
    );
  }

  /**
   * Helper: Fetch pipeline security report findings.
   */
  public async getPipelineSecurityReportFindings(fullPath: string, pipelineId: string, logger: Logger): Promise<void> {
    await iterate<typeof qPipelineSecurityReportFindings>(
      logger,
      this.client,
      ["project", "pipeline", "securityReportFindings"],
      qPipelineSecurityReportFindings,
      { FullPath: fullPath, ID: pipelineId },
      undefined,
      (results) => {
        if (results) {
          // Process security report findings as needed.
        }
      }
    );
  }

  /**
   * Helper: Fetch pipeline test suites.
   */
  public async getPipelineTestSuites(fullPath: string, pipelineId: string, logger: Logger): Promise<void> {
    await iterate<typeof qPipelineTestSuites>(
      logger,
      this.client,
      ["project", "pipeline", "testReportSummary", "testSuites"],
      qPipelineTestSuites,
      { FullPath: fullPath, ID: pipelineId },
      undefined,
      (results) => {
        if (results) {
          // Process test suites as needed.
        }
      }
    );
  }
}
