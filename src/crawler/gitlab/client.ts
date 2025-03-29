// src/crawler/gitlab/client.ts
import type { Job } from '../types'; // Assuming Job type includes API URL and token

// Import generated GraphQL types
// Adjust path and imported types as necessary based on actual generated file content
import type {
    PageInfo, // Common
    ProjectMemberConnection, GroupMemberConnection, ProjectMember, GroupMember, // Memberships
    IssueConnection, Issue, // Issues
    LabelConnection, Label, // Labels
    MilestoneConnection, Milestone, // Milestones
    // BranchConnection, Branch, // Removed - Types seem missing/incorrectly named
    MergeRequestConnection, MergeRequest, // Merge Requests
    ReleaseConnection, Release, // Releases
    PipelineConnection, Pipeline, // Pipelines
    TimelogConnection, Timelog, // Timelogs
    VulnerabilityConnection, Vulnerability, // Vulnerabilities
    Discussion, Note, // Discussion/Note types (DiscussionConnection not needed directly)
    // CodeQualityReportSummary, // Removed - Type seems missing
    // SecurityReportFinding, // Removed - Type seems missing/nested
    // TestReportSummary, TestSuite // Removed - Types seem missing
    // Add other specific types as needed for nested data (User, Commit, etc.)
} from '../../../stashed/crawler-old/gql/graphql'; // Corrected relative path

// Define a default PageInfo object satisfying the imported type
const defaultPageInfo: PageInfo = { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null };

// Define Response structure types using imported types
// These help type the data returned by executeGraphQL

interface ProjectMembersResponse {
    project: { projectMembers: ProjectMemberConnection; } | null;
}
interface GroupMembersResponse {
    group: { groupMembers: GroupMemberConnection; } | null;
}
interface ProjectIssuesResponse {
    project: { issues: IssueConnection; } | null;
}
interface GroupIssuesResponse {
     group: { issues: IssueConnection; } | null;
}
interface ProjectLabelsResponse {
    project: { labels: LabelConnection; } | null;
}
interface GroupLabelsResponse {
     group: { labels: LabelConnection; } | null;
}
interface ProjectMilestonesResponse {
    project: { milestones: MilestoneConnection; } | null;
}
interface GroupMilestonesResponse {
     group: { milestones: MilestoneConnection; } | null;
}
interface ProjectBranchesResponse {
    project: { repository?: { branches: any; }; } | null; // Use any for branches connection
}
interface ProjectMergeRequestsResponse {
    project: { mergeRequests: MergeRequestConnection; } | null;
}
interface GroupMergeRequestsResponse {
     group: { mergeRequests: MergeRequestConnection; } | null;
}
interface ProjectReleasesResponse {
    project: { releases: ReleaseConnection; } | null;
}
interface ProjectPipelinesResponse {
    project: { pipelines: PipelineConnection; } | null;
}
interface ProjectTimelogsResponse {
    project: { timelogs: TimelogConnection; } | null;
}
interface GroupTimelogsResponse {
     group: { timelogs: TimelogConnection; } | null;
}
interface ProjectVulnerabilitiesResponse {
    project: { vulnerabilities: VulnerabilityConnection; } | null;
}
// Add response types for Discussions, Reports, Tests if direct queries exist


/**
 * Client for interacting with the GitLab GraphQL API.
 */
export class GitlabClient {
  private apiUrl: string;
  private token: string;
  private headers: Record<string, string>;

  constructor(apiUrl: string, token: string) {
    if (!apiUrl || !token) {
      throw new Error('GitLab API URL and token are required.');
    }
    this.apiUrl = apiUrl;
    this.token = token;
    this.headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
    };
    console.log(`GitlabClient initialized for API URL: ${this.apiUrl}`);
  }

  private async executeGraphQL<T = any>(query: string, variables?: Record<string, any>): Promise<T> {
    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ query, variables }),
      });

      if (!response.ok) {
        let errorBody = '';
        try { errorBody = await response.text(); } catch (_) { /* ignore */ }
        throw new Error(`GitLab API request failed: ${response.status} ${response.statusText}. Body: ${errorBody}`);
      }
      const result = await response.json();
      if (result.errors) {
        console.error('GitLab API returned errors:', JSON.stringify(result.errors, null, 2));
        throw new Error(`GitLab API Error: ${result.errors[0]?.message || 'Unknown GraphQL error'}`);
      }
      if (!result.data) {
          throw new Error('GitLab API response missing data field.');
      }
      return result.data as T;
    } catch (error) {
      console.error('Error during GraphQL execution:', error);
      throw error;
    }
  }

  /**
   * Fetches data for a specific type. Handles pagination.
   */
  async fetchData(
      dataType: string,
      targetPath: string,
      pageInfo?: { after?: string }
  ): Promise<{ data: any[]; pageInfo: PageInfo }> { // Return type uses imported PageInfo
    console.log(`Fetching data type '${dataType}' for path '${targetPath}' (cursor: ${pageInfo?.after ?? 'start'})`);
    const isGroup = !targetPath.includes('/'); // Simple heuristic
    // Define a default PageInfo object satisfying the imported type
    const defaultPageInfo: PageInfo = { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null };

    try {
        switch (dataType) {
          case 'memberships':
            return isGroup
                ? await this.fetchGroupMemberships(targetPath, pageInfo?.after)
                : await this.fetchProjectMemberships(targetPath, pageInfo?.after);
          case 'issues':
             return isGroup
                 ? await this.fetchGroupIssues(targetPath, pageInfo?.after)
                 : await this.fetchProjectIssues(targetPath, pageInfo?.after);
          case 'labels':
             return isGroup
                 ? await this.fetchGroupLabels(targetPath, pageInfo?.after)
                 : await this.fetchProjectLabels(targetPath, pageInfo?.after);
          case 'milestones':
             return isGroup
                 ? await this.fetchGroupMilestones(targetPath, pageInfo?.after)
                 : await this.fetchProjectMilestones(targetPath, pageInfo?.after);
          case 'branches':
             if (isGroup) {
                 console.warn(`fetchData: Branches are project-specific. Skipping for group ${targetPath}.`);
                 return { data: [], pageInfo: defaultPageInfo };
             }
             return await this.fetchProjectBranches(targetPath, pageInfo?.after);
          case 'mergeRequests':
             return isGroup
                 ? await this.fetchGroupMergeRequests(targetPath, pageInfo?.after)
                 : await this.fetchProjectMergeRequests(targetPath, pageInfo?.after);
          case 'releases':
             if (isGroup) {
                 console.warn(`fetchData: Releases are project-specific. Skipping for group ${targetPath}.`);
                 return { data: [], pageInfo: defaultPageInfo };
             }
             return await this.fetchProjectReleases(targetPath, pageInfo?.after);
          case 'pipelines':
             if (isGroup) {
                 console.warn(`fetchData: Pipelines are project-specific. Skipping for group ${targetPath}.`);
                 return { data: [], pageInfo: defaultPageInfo };
             }
             return await this.fetchProjectPipelines(targetPath, pageInfo?.after);
          case 'timelogs':
             return isGroup
                 ? await this.fetchGroupTimelogs(targetPath, pageInfo?.after)
                 : await this.fetchProjectTimelogs(targetPath, pageInfo?.after);
          case 'vulnerabilities':
             if (isGroup) {
                 console.warn(`fetchData: Vulnerabilities query at group level not implemented. Skipping for group ${targetPath}.`);
                 return { data: [], pageInfo: defaultPageInfo };
             }
             return await this.fetchProjectVulnerabilities(targetPath, pageInfo?.after);
          case 'codeQualityReports':
          case 'securityReportFindings':
          case 'testSuites':
             console.warn(`fetchData: Direct fetching for '${dataType}' not implemented (may require pipeline context). Skipping.`);
             return { data: [], pageInfo: defaultPageInfo };
          default:
            console.error(`Unsupported data type requested: ${dataType}`);
            throw new Error(`Unsupported data type: ${dataType}`);
        }
    } catch (error) {
         console.error(`Error fetching ${dataType} for ${targetPath}:`, error);
         return { data: [], pageInfo: defaultPageInfo }; // Return empty on error
    }
  }

  // --- Specific Fetch Methods (using imported types) ---

  private async fetchProjectMemberships(fullPath: string, afterCursor?: string): Promise<{ data: ProjectMember[]; pageInfo: PageInfo }> {
    const query = `
      query GetProjectMembers($fullPath: ID!, $after: String) {
        project(fullPath: $fullPath) {
          projectMembers(first: 100, after: $after) {
            nodes { id user { id username name state webUrl } accessLevel { stringValue } }
            pageInfo { hasNextPage endCursor }
          } } }`;
    const variables = { fullPath, after: afterCursor };
    const result = await this.executeGraphQL<ProjectMembersResponse>(query, variables);
    const members = result?.project?.projectMembers;
    // Ensure nodes are correctly typed if needed, though connection type implies it
    return { data: (members?.nodes as ProjectMember[]) ?? [], pageInfo: members?.pageInfo ?? defaultPageInfo };
  }

  private async fetchGroupMemberships(fullPath: string, afterCursor?: string): Promise<{ data: GroupMember[]; pageInfo: PageInfo }> {
    const query = `
      query GetGroupMembers($fullPath: ID!, $after: String) {
        group(fullPath: $fullPath) {
          groupMembers(first: 100, after: $after) {
            nodes { id user { id username name state webUrl } accessLevel { stringValue } }
            pageInfo { hasNextPage endCursor }
          } } }`;
    const variables = { fullPath, after: afterCursor };
    const result = await this.executeGraphQL<GroupMembersResponse>(query, variables);
    const members = result?.group?.groupMembers;
    return { data: (members?.nodes as GroupMember[]) ?? [], pageInfo: members?.pageInfo ?? defaultPageInfo };
  }

   private async fetchProjectIssues(fullPath: string, afterCursor?: string): Promise<{ data: Issue[]; pageInfo: PageInfo }> {
      const query = `
        query GetProjectIssues($fullPath: ID!, $after: String) {
          project(fullPath: $fullPath) {
            issues(first: 50, after: $after, includeSubgroups: false) {
              nodes {
                id iid title state createdAt updatedAt closedAt webUrl author { id username name }
                assignees(first: 10) { nodes { id username name } }
                labels(first: 20) { nodes { id title color } }
                discussions(first: 50) { # Fetch discussions (and their notes)
                  nodes {
                    id
                    replyId
                    resolved
                    notes(first: 100) { # Fetch notes within discussion
                      nodes { id body system createdAt updatedAt author { id username name } resolvable resolved resolvedAt resolvedBy { id username name } }
                      pageInfo { hasNextPage endCursor } # Notes pagination
                    }
                  }
                  pageInfo { hasNextPage endCursor } # Discussions pagination
                }
              }
              pageInfo { hasNextPage endCursor } # Issues pagination
            } } }`;
      const variables = { fullPath, after: afterCursor };
      const result = await this.executeGraphQL<ProjectIssuesResponse>(query, variables);
      const issues = result?.project?.issues;
      return { data: (issues?.nodes as Issue[]) ?? [], pageInfo: issues?.pageInfo ?? defaultPageInfo };
  }

   private async fetchGroupIssues(fullPath: string, afterCursor?: string): Promise<{ data: Issue[]; pageInfo: PageInfo }> {
      const query = `
        query GetGroupIssues($fullPath: ID!, $after: String) {
          group(fullPath: $fullPath) {
            issues(first: 50, after: $after, includeSubgroups: true) {
              nodes {
                id iid title state createdAt updatedAt closedAt webUrl author { id username name }
                assignees(first: 10) { nodes { id username name } }
                labels(first: 20) { nodes { id title color } }
                discussions(first: 50) { # Fetch discussions (and their notes)
                  nodes {
                    id
                    replyId
                    resolved
                    notes(first: 100) { # Fetch notes within discussion
                      nodes { id body system createdAt updatedAt author { id username name } resolvable resolved resolvedAt resolvedBy { id username name } }
                      pageInfo { hasNextPage endCursor } # Notes pagination
                    }
                  }
                  pageInfo { hasNextPage endCursor } # Discussions pagination
                }
              }
              pageInfo { hasNextPage endCursor } # Issues pagination
            } } }`;
      const variables = { fullPath, after: afterCursor };
      const result = await this.executeGraphQL<GroupIssuesResponse>(query, variables);
      const issues = result?.group?.issues;
      return { data: (issues?.nodes as Issue[]) ?? [], pageInfo: issues?.pageInfo ?? defaultPageInfo };
  }

  private async fetchProjectLabels(fullPath: string, afterCursor?: string): Promise<{ data: Label[]; pageInfo: PageInfo }> {
      const query = `
        query GetProjectLabels($fullPath: ID!, $after: String) {
          project(fullPath: $fullPath) {
            labels(first: 100, after: $after) {
              nodes { id title description color textColor createdAt updatedAt }
              pageInfo { hasNextPage endCursor }
            } } }`;
      const variables = { fullPath, after: afterCursor };
      const result = await this.executeGraphQL<ProjectLabelsResponse>(query, variables);
      const labels = result?.project?.labels;
      return { data: (labels?.nodes as Label[]) ?? [], pageInfo: labels?.pageInfo ?? defaultPageInfo };
  }

   private async fetchGroupLabels(fullPath: string, afterCursor?: string): Promise<{ data: Label[]; pageInfo: PageInfo }> {
      const query = `
        query GetGroupLabels($fullPath: ID!, $after: String) {
          group(fullPath: $fullPath) {
            labels(first: 100, after: $after, includeAncestorGroups: false) {
              nodes { id title description color textColor createdAt updatedAt }
              pageInfo { hasNextPage endCursor }
            } } }`;
      const variables = { fullPath, after: afterCursor };
      const result = await this.executeGraphQL<GroupLabelsResponse>(query, variables);
      const labels = result?.group?.labels;
      return { data: (labels?.nodes as Label[]) ?? [], pageInfo: labels?.pageInfo ?? defaultPageInfo };
  }

  private async fetchProjectMilestones(fullPath: string, afterCursor?: string): Promise<{ data: Milestone[]; pageInfo: PageInfo }> {
      const query = `
        query GetProjectMilestones($fullPath: ID!, $after: String) {
          project(fullPath: $fullPath) {
            milestones(first: 100, after: $after, includeDescendants: false, state: all) {
              nodes { id iid title description state startDate dueDate createdAt updatedAt webUrl }
              pageInfo { hasNextPage endCursor }
            } } }`;
      const variables = { fullPath, after: afterCursor };
      const result = await this.executeGraphQL<ProjectMilestonesResponse>(query, variables);
      const milestones = result?.project?.milestones;
      return { data: (milestones?.nodes as Milestone[]) ?? [], pageInfo: milestones?.pageInfo ?? defaultPageInfo };
  }

  private async fetchGroupMilestones(fullPath: string, afterCursor?: string): Promise<{ data: Milestone[]; pageInfo: PageInfo }> {
      const query = `
        query GetGroupMilestones($fullPath: ID!, $after: String) {
          group(fullPath: $fullPath) {
            milestones(first: 100, after: $after, includeDescendants: true, state: all) {
              nodes { id iid title description state startDate dueDate createdAt updatedAt webUrl }
              pageInfo { hasNextPage endCursor }
            } } }`;
      const variables = { fullPath, after: afterCursor };
      const result = await this.executeGraphQL<GroupMilestonesResponse>(query, variables);
      const milestones = result?.group?.milestones;
      return { data: (milestones?.nodes as Milestone[]) ?? [], pageInfo: milestones?.pageInfo ?? defaultPageInfo };
  }

  private async fetchProjectBranches(fullPath: string, afterCursor?: string): Promise<{ data: any[]; pageInfo: PageInfo }> { // Use any[] for data
      const query = `
        query GetProjectBranches($fullPath: ID!, $after: String) {
          project(fullPath: $fullPath) {
            repository {
              branches(first: 100, after: $after) {
                nodes { name webUrl protected developersCanPush developersCanMerge commit { id authoredDate committedDate message webUrl author { name email user { username } } committer { name email user { username } } } }
                pageInfo { hasNextPage endCursor }
              } } } }`;
      const variables = { fullPath, after: afterCursor };
      const result = await this.executeGraphQL<ProjectBranchesResponse>(query, variables);
      const branches = result?.project?.repository?.branches;
      return { data: branches?.nodes ?? [], pageInfo: branches?.pageInfo ?? defaultPageInfo }; // Removed type assertion
  }

  private async fetchProjectMergeRequests(fullPath: string, afterCursor?: string): Promise<{ data: MergeRequest[]; pageInfo: PageInfo }> {
      const query = `
        query GetProjectMergeRequests($fullPath: ID!, $after: String) {
          project(fullPath: $fullPath) {
            mergeRequests(first: 50, after: $after, state: all, sort: UPDATED_DESC) {
              nodes {
                id iid title state sourceBranch targetBranch createdAt updatedAt mergedAt closedAt webUrl author { id username name }
                assignees(first: 10) { nodes { id username name } }
                reviewers(first: 10) { nodes { id username name } }
                labels(first: 20) { nodes { id title color } }
                milestone { id title }
                discussions(first: 50) { # Fetch discussions
                  nodes {
                    id replyId resolved
                    notes(first: 100) { # Fetch notes
                      nodes { id body system createdAt updatedAt author { id username name } resolvable resolved resolvedAt resolvedBy { id username name } }
                      pageInfo { hasNextPage endCursor } # Notes pagination
                    }
                  }
                  pageInfo { hasNextPage endCursor } # Discussions pagination
                }
              }
              pageInfo { hasNextPage endCursor } # MR pagination
            } } }`;
      const variables = { fullPath, after: afterCursor };
      const result = await this.executeGraphQL<ProjectMergeRequestsResponse>(query, variables);
      const mergeRequests = result?.project?.mergeRequests;
      return { data: (mergeRequests?.nodes as MergeRequest[]) ?? [], pageInfo: mergeRequests?.pageInfo ?? defaultPageInfo };
  }

  private async fetchGroupMergeRequests(fullPath: string, afterCursor?: string): Promise<{ data: MergeRequest[]; pageInfo: PageInfo }> {
      const query = `
        query GetGroupMergeRequests($fullPath: ID!, $after: String) {
          group(fullPath: $fullPath) {
            mergeRequests(first: 50, after: $after, state: all, sort: UPDATED_DESC, includeSubgroups: true) {
              nodes {
                id iid title state sourceBranch targetBranch createdAt updatedAt mergedAt closedAt webUrl author { id username name }
                assignees(first: 10) { nodes { id username name } }
                reviewers(first: 10) { nodes { id username name } }
                labels(first: 20) { nodes { id title color } }
                milestone { id title }
                discussions(first: 50) { # Fetch discussions
                  nodes {
                    id replyId resolved
                    notes(first: 100) { # Fetch notes
                      nodes { id body system createdAt updatedAt author { id username name } resolvable resolved resolvedAt resolvedBy { id username name } }
                      pageInfo { hasNextPage endCursor } # Notes pagination
                    }
                  }
                  pageInfo { hasNextPage endCursor } # Discussions pagination
                }
              }
              pageInfo { hasNextPage endCursor } # MR pagination
            } } }`;
      const variables = { fullPath, after: afterCursor };
      const result = await this.executeGraphQL<GroupMergeRequestsResponse>(query, variables);
      const mergeRequests = result?.group?.mergeRequests;
      return { data: (mergeRequests?.nodes as MergeRequest[]) ?? [], pageInfo: mergeRequests?.pageInfo ?? defaultPageInfo };
  }

   private async fetchProjectReleases(fullPath: string, afterCursor?: string): Promise<{ data: Release[]; pageInfo: PageInfo }> {
      const query = `
        query GetProjectReleases($fullPath: ID!, $after: String) {
          project(fullPath: $fullPath) {
            releases(first: 50, after: $after, orderBy: RELEASED_AT, sort: DESC) {
              nodes { tagName name createdAt releasedAt commit { id } author { id username name } assets { count sources(first: 10) { nodes { format url } } links(first: 10) { nodes { id name url linkType } } } milestones(first: 10) { nodes { id title } } }
              pageInfo { hasNextPage endCursor }
            } } }`;
      const variables = { fullPath, after: afterCursor };
      const result = await this.executeGraphQL<ProjectReleasesResponse>(query, variables);
      const releases = result?.project?.releases;
      return { data: (releases?.nodes as Release[]) ?? [], pageInfo: releases?.pageInfo ?? defaultPageInfo };
  }

  private async fetchProjectPipelines(fullPath: string, afterCursor?: string): Promise<{ data: Pipeline[]; pageInfo: PageInfo }> {
      const query = `
        query GetProjectPipelines($fullPath: ID!, $after: String) {
          project(fullPath: $fullPath) {
            pipelines(first: 50, after: $after, orderBy: UPDATED_AT, sort: DESC) {
              nodes {
                id iid sha status source createdAt updatedAt startedAt finishedAt duration queuedDuration user { id username name }
                detailedStatus { icon text label group }
                # Add report fields
                codeQualityReports { count } # Example: Just get count, or nodes if needed
                securityReportSummary { # Example structure, adjust based on actual API
                   dast { vulnerabilitiesCount }
                   sast { vulnerabilitiesCount }
                   dependencyScanning { vulnerabilitiesCount }
                   containerScanning { vulnerabilitiesCount }
                }
                testReportSummary { # Example structure
                   total { time count success failed skipped error }
                   # testSuites(first: 5) { nodes { name totalCount successCount failedCount } } # Optionally fetch suite summaries
                }
                # jobs(first: 10) { nodes { id name status stage { name } testSuite { totalCount successCount } } } # Fetch job test counts?
              }
              pageInfo { hasNextPage endCursor }
            } } }`;
      const variables = { fullPath, after: afterCursor };
      const result = await this.executeGraphQL<ProjectPipelinesResponse>(query, variables);
      const pipelines = result?.project?.pipelines;
      return { data: (pipelines?.nodes as Pipeline[]) ?? [], pageInfo: pipelines?.pageInfo ?? defaultPageInfo };
  }

  private async fetchProjectTimelogs(fullPath: string, afterCursor?: string): Promise<{ data: Timelog[]; pageInfo: PageInfo }> {
      const query = `
        query GetProjectTimelogs($fullPath: ID!, $after: String) {
          project(fullPath: $fullPath) {
            timelogs(first: 100, after: $after) {
              nodes { timeSpent user { id username name } issue { id iid title } mergeRequest { id iid title } note { id body } spentAt summary }
              pageInfo { hasNextPage endCursor }
            } } }`;
      const variables = { fullPath, after: afterCursor };
      const result = await this.executeGraphQL<ProjectTimelogsResponse>(query, variables);
      const timelogs = result?.project?.timelogs;
      return { data: (timelogs?.nodes as Timelog[]) ?? [], pageInfo: timelogs?.pageInfo ?? defaultPageInfo };
  }

  private async fetchGroupTimelogs(fullPath: string, afterCursor?: string): Promise<{ data: Timelog[]; pageInfo: PageInfo }> {
       const query = `
        query GetGroupTimelogs($fullPath: ID!, $after: String) {
          group(fullPath: $fullPath) {
            timelogs(first: 100, after: $after) {
              nodes { timeSpent user { id username name } issue { id iid title } mergeRequest { id iid title } note { id body } spentAt summary }
              pageInfo { hasNextPage endCursor }
            } } }`;
      const variables = { fullPath, after: afterCursor };
      const result = await this.executeGraphQL<GroupTimelogsResponse>(query, variables);
      const timelogs = result?.group?.timelogs;
      return { data: (timelogs?.nodes as Timelog[]) ?? [], pageInfo: timelogs?.pageInfo ?? defaultPageInfo };
  }

  // Placeholder: Fetching discussions might be done per-issue/MR
  // private async fetchIssueDiscussions(issueId: string, afterCursor?: string): Promise<{ data: Discussion[]; pageInfo: PageInfo }> { ... }
  // private async fetchMergeRequestDiscussions(mrId: string, afterCursor?: string): Promise<{ data: Discussion[]; pageInfo: PageInfo }> { ... }

  private async fetchProjectVulnerabilities(fullPath: string, afterCursor?: string): Promise<{ data: Vulnerability[]; pageInfo: PageInfo }> {
       const query = `
         query GetProjectVulnerabilities($fullPath: ID!, $after: String) {
           project(fullPath: $fullPath) {
             vulnerabilities(first: 50, after: $after, state: [DETECTED, CONFIRMED]) {
               nodes { id title state severity confidence reportType scanner { id name vendor } identifiers { externalType externalId name url } location { file startLine endLine blobPath } project { id name fullPath } pipeline { id iid } detectedAt resolvedAt dismissedAt }
               pageInfo { hasNextPage endCursor }
             } } }`;
       const variables = { fullPath, after: afterCursor };
       const result = await this.executeGraphQL<ProjectVulnerabilitiesResponse>(query, variables);
       const vulnerabilities = result?.project?.vulnerabilities;
       return { data: (vulnerabilities?.nodes as Vulnerability[]) ?? [], pageInfo: vulnerabilities?.pageInfo ?? defaultPageInfo };
   }

  // Removed placeholder methods for Reports/Tests as they are now fetched via Pipelines query

}