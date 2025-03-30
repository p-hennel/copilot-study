// Import generated GraphQL types
// Adjust path and imported types as necessary based on actual generated file content
// src/crawler/gitlab/client.ts
import { Gitlab } from "@gitbeaker/rest" // Added: Gitbeaker REST client
// Removed duplicate import: import type { Job } from "../types";

// Import generated GraphQL types
// Adjust path and imported types as necessary based on actual generated file content
import type {
  PageInfo, // Common
  ProjectMemberConnection,
  GroupMemberConnection,
  ProjectMember,
  GroupMember, // Memberships
  IssueConnection,
  Issue, // Issues
  LabelConnection,
  Label, // Labels
  MilestoneConnection,
  Milestone, // Milestones
  // BranchConnection, Branch, // Removed - Types seem missing/incorrectly named
  MergeRequestConnection,
  MergeRequest, // Merge Requests
  ReleaseConnection,
  Release, // Releases
  PipelineConnection,
  Pipeline, // Pipelines
  TimelogConnection,
  Timelog, // Timelogs
  VulnerabilityConnection,
  Vulnerability // Vulnerabilities
  //Discussion,
  //Note // Discussion/Note types (DiscussionConnection not needed directly)
  // CodeQualityReportSummary, // Removed - Type seems missing
  // SecurityReportFinding, // Removed - Type seems missing/nested
  // TestReportSummary, TestSuite // Removed - Types seem missing
  // Add other specific types as needed for nested data (User, Commit, etc.)
} from "../gql/graphql" // Corrected relative path

import type { ProjectSchema, GroupSchema } from "@gitbeaker/rest" // Import REST types

// Define a simplified structure for the commit data we care about
interface SimpleCommit {
  id: string
  short_id: string
  title: string
  message: string
  author_name: string
  author_email: string
  authored_date: string // ISO 8601 format
  committer_name: string
  committer_email: string
  committed_date: string // ISO 8601 format
  web_url: string
  parent_ids: string[]
  // Add other fields if needed, like stats (additions, deletions)
}

// Define a default PageInfo object satisfying the imported type
const defaultPageInfo: PageInfo = {
  hasNextPage: false,
  hasPreviousPage: false,
  startCursor: null,
  endCursor: null
}

// Define Response structure types using imported types
// These help type the data returned by executeGraphQL

interface ProjectMembersResponse {
  project: { projectMembers: ProjectMemberConnection } | null
}
interface GroupMembersResponse {
  group: { groupMembers: GroupMemberConnection } | null
}
interface ProjectIssuesResponse {
  project: { issues: IssueConnection } | null
}
interface GroupIssuesResponse {
  group: { issues: IssueConnection } | null
}
interface ProjectLabelsResponse {
  project: { labels: LabelConnection } | null
}
interface GroupLabelsResponse {
  group: { labels: LabelConnection } | null
}
interface ProjectMilestonesResponse {
  project: { milestones: MilestoneConnection } | null
}
interface GroupMilestonesResponse {
  group: { milestones: MilestoneConnection } | null
}
interface ProjectBranchesResponse {
  project: { repository?: { branches: any } } | null // Use any for branches connection
}
interface ProjectMergeRequestsResponse {
  project: { mergeRequests: MergeRequestConnection } | null
}
interface GroupMergeRequestsResponse {
  group: { mergeRequests: MergeRequestConnection } | null
}
interface ProjectReleasesResponse {
  project: { releases: ReleaseConnection } | null
}
interface ProjectPipelinesResponse {
  project: { pipelines: PipelineConnection } | null
}
interface ProjectTimelogsResponse {
  project: { timelogs: TimelogConnection } | null
}
interface GroupTimelogsResponse {
  group: { timelogs: TimelogConnection } | null
}
interface ProjectVulnerabilitiesResponse {
  project: { vulnerabilities: VulnerabilityConnection } | null
}
// Add response types for Discussions, Reports, Tests if direct queries exist

/**
 * Client for interacting with the GitLab GraphQL API.
 */
export class GitlabClient {
  private graphqlApiUrl: string // Renamed for clarity
  private token: string
  private headers: Record<string, string>
  private restClient: InstanceType<typeof Gitlab> // Added: Gitbeaker REST client instance

  constructor(apiUrl: string, token: string) {
    // apiUrl here is expected to be the GraphQL endpoint, e.g., https://gitlab.com/api/graphql
    // Gitbeaker needs the base host, e.g., https://gitlab.com
    if (!apiUrl || !token) {
      throw new Error("GitLab API URL and token are required.")
    }
    this.graphqlApiUrl = apiUrl // Assign to the renamed property
    this.token = token
    this.headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`
    }

    // Derive host for Gitbeaker
    const url = new URL(apiUrl)
    const host = `${url.protocol}//${url.host}`

    // Instantiate Gitbeaker REST client
    this.restClient = new Gitlab({
      host: host,
      token: this.token
      // Add other options like requestTimeout if needed
    })

    console.log(`GitlabClient initialized for GraphQL API URL: ${this.graphqlApiUrl} and Host: ${host}`)
  }

  private async executeGraphQL<T = any>(query: string, variables?: Record<string, any>): Promise<T> {
    try {
      const response = await fetch(this.graphqlApiUrl, {
        // Use renamed property
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({ query, variables })
      })

      if (!response.ok) {
        let errorBody = ""
        try {
          errorBody = await response.text()
        } catch {
          // Remove unused variable binding
          /* ignore */
        }
        throw new Error(`GitLab API request failed: ${response.status} ${response.statusText}. Body: ${errorBody}`)
      }
      // Add a basic type for the GraphQL response structure and cast
      const result = (await response.json()) as {
        data?: T
        errors?: Array<{ message: string; [key: string]: any }>
      }
      if (result.errors) {
        console.error("GitLab API returned errors:", JSON.stringify(result.errors, null, 2))
        throw new Error(`GitLab API Error: ${result.errors[0]?.message || "Unknown GraphQL error"}`)
      }
      if (!result.data) {
        throw new Error("GitLab API response missing data field.")
      }
      return result.data as T
    } catch (error) {
      console.error("Error during GraphQL execution:", error)
      throw error
    }
  }

  // --- NEW METHOD for fetching commits via REST ---
  /**
   * Fetches commits for a project using the REST API.
   * Handles pagination internally.
   * @param fullPath The full path of the project (e.g., 'group/subgroup/project').
   * @param options Optional parameters like 'ref_name', 'since', 'until'.
   * @returns An array of simplified commit data.
   */
  async fetchProjectCommits(
    fullPath: string,
    options: {
      ref_name?: string
      since?: string
      until?: string
      page?: number
      perPage?: number
    } = {}
  ): Promise<SimpleCommit[]> {
    console.log(`Fetching commits for project '${fullPath}' via REST...`)
    const projectId = encodeURIComponent(fullPath) // URL-encode the full path for REST API
    const allCommits: SimpleCommit[] = []
    let page = 1
    const perPage = 100 // Fetch 100 per page
    let keepFetching = true

    try {
      while (keepFetching) {
        console.log(`Fetching page ${page} of commits for ${fullPath}...`)
        const commitsPage = await this.restClient.Commits.all(projectId, {
          ...options, // Include ref_name, since, until if provided
          page: page,
          perPage: perPage
          // Remove showPagination and maxPages, handle manually
        })

        if (commitsPage && commitsPage.length > 0) {
          for (const commit of commitsPage) {
            // Map to our simplified structure, providing defaults and type assertions
            allCommits.push({
              id: (commit.id ?? "") as string,
              short_id: (commit.short_id ?? "") as string,
              title: (commit.title ?? "") as string,
              message: (commit.message ?? "") as string,
              author_name: (commit.author_name ?? "Unknown Author") as string,
              author_email: (commit.author_email ?? "") as string,
              authored_date: (commit.authored_date ?? "") as string,
              committer_name: (commit.committer_name ?? "Unknown Committer") as string,
              committer_email: (commit.committer_email ?? "") as string,
              committed_date: (commit.committed_date ?? "") as string,
              web_url: (commit.web_url ?? "") as string,
              parent_ids: (commit.parent_ids ?? []) as string[]
            })
          }

          // Check if we received fewer results than requested, indicating the last page
          if (commitsPage.length < perPage) {
            keepFetching = false
          } else {
            page++ // Go to the next page
          }
        } else {
          keepFetching = false // No more commits found
        }

        // Safety break (optional, adjust limit as needed)
        if (page > 1000) {
          console.warn(`Commit fetch limit (1000 pages) reached for ${fullPath}. Stopping.`)
          keepFetching = false
        }
      }
      console.log(`Fetched ${allCommits.length} commits in total for project '${fullPath}'.`)
    } catch (fetchError) {
      // Rename error variable
      console.error(`Error fetching commits for project ${fullPath} via REST:`, fetchError)
      // Decide how to handle errors - throw or return empty array?
      // Returning empty for now to match GraphQL error handling pattern
    }
    return allCommits
  }
  // --- END NEW METHOD ---

  /**
   * Fetches data for a specific type. Handles pagination.
   */
  async fetchData(
    dataType: string,
    targetPath: string,
    pageInfo?: { after?: string }
  ): Promise<{ data: any[]; pageInfo?: PageInfo; totalItems?: number }> {
    // Allow optional pageInfo and totalItems
    // Return type uses imported PageInfo
    console.log(`Fetching data type '${dataType}' for path '${targetPath}' (cursor: ${pageInfo?.after ?? "start"})`)
    const isGroup = !targetPath.includes("/") // Simple heuristic
    // Define a default PageInfo object satisfying the imported type
    const defaultPageInfo: PageInfo = {
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: null,
      endCursor: null
    }

    try {
      switch (dataType) {
        // --- Discovery Data Types ---
        case "groupProjects": {
          if (!isGroup) {
            console.warn(`fetchData: Cannot fetch projects for a project path: ${targetPath}`)
            return { data: [], totalItems: 0 }
          }
          const projects = await this.fetchGroupProjects(targetPath)
          return { data: projects, totalItems: projects.length } // No pageInfo for REST fetch-all
        } // Close brace for case 'groupProjects'
        case "groupSubgroups": {
          if (!isGroup) {
            console.warn(`fetchData: Cannot fetch subgroups for a project path: ${targetPath}`)
            return { data: [], totalItems: 0 }
          }
          const subgroups = await this.fetchGroupSubgroups(targetPath)
          return { data: subgroups, totalItems: subgroups.length } // No pageInfo for REST fetch-all
        } // Close brace for case 'groupSubgroups'

        // --- Existing GraphQL Data Types ---
        case "memberships":
          return isGroup
            ? await this.fetchGroupMemberships(targetPath, pageInfo?.after)
            : await this.fetchProjectMemberships(targetPath, pageInfo?.after)
        case "issues":
          return isGroup
            ? await this.fetchGroupIssues(targetPath, pageInfo?.after)
            : await this.fetchProjectIssues(targetPath, pageInfo?.after)
        case "labels":
          return isGroup
            ? await this.fetchGroupLabels(targetPath, pageInfo?.after)
            : await this.fetchProjectLabels(targetPath, pageInfo?.after)
        case "milestones":
          return isGroup
            ? await this.fetchGroupMilestones(targetPath, pageInfo?.after)
            : await this.fetchProjectMilestones(targetPath, pageInfo?.after)
        case "branches":
          if (isGroup) {
            console.warn(`fetchData: Branches are project-specific. Skipping for group ${targetPath}.`)
            return { data: [], pageInfo: defaultPageInfo }
          }
          return await this.fetchProjectBranches(targetPath, pageInfo?.after)
        case "mergeRequests":
          return isGroup
            ? await this.fetchGroupMergeRequests(targetPath, pageInfo?.after)
            : await this.fetchProjectMergeRequests(targetPath, pageInfo?.after)
        case "releases":
          if (isGroup) {
            console.warn(`fetchData: Releases are project-specific. Skipping for group ${targetPath}.`)
            return { data: [], pageInfo: defaultPageInfo }
          }
          return await this.fetchProjectReleases(targetPath, pageInfo?.after)
        case "pipelines":
          if (isGroup) {
            console.warn(`fetchData: Pipelines are project-specific. Skipping for group ${targetPath}.`)
            return { data: [], pageInfo: defaultPageInfo }
          }
          return await this.fetchProjectPipelines(targetPath, pageInfo?.after)
        case "timelogs":
          return isGroup
            ? await this.fetchGroupTimelogs(targetPath, pageInfo?.after)
            : await this.fetchProjectTimelogs(targetPath, pageInfo?.after)
        case "vulnerabilities":
          if (isGroup) {
            console.warn(
              `fetchData: Vulnerabilities query at group level not implemented. Skipping for group ${targetPath}.`
            )
            return { data: [], pageInfo: defaultPageInfo }
          }
          return await this.fetchProjectVulnerabilities(targetPath, pageInfo?.after)
        case "commits": {
          // Added case for commits + braces
          if (isGroup) {
            console.warn(`fetchData: Commits are project-specific. Skipping for group ${targetPath}.`)
            return { data: [], totalItems: 0 } // Return empty, no pageInfo needed for REST fetch-all
          }
          // Note: REST pagination is handled inside fetchProjectCommits
          const commits = await this.fetchProjectCommits(targetPath)
          // REST fetch-all doesn't use GraphQL pageInfo
          return { data: commits, totalItems: commits.length }
        } // Close brace for case 'commits'
        case "codeQualityReports":
        case "securityReportFindings":
        case "testSuites":
          console.warn(
            `fetchData: Direct fetching for '${dataType}' not implemented (may require pipeline context). Skipping.`
          )
          return { data: [], pageInfo: defaultPageInfo }
        default:
          console.error(`Unsupported data type requested: ${dataType}`)
          throw new Error(`Unsupported data type: ${dataType}`)
      }
    } catch (error) {
      console.error(`Error fetching ${dataType} for ${targetPath}:`, error)
      // Return empty on error, adjust structure based on expected return type
      return {
        data: [],
        pageInfo: dataType !== "commits" ? defaultPageInfo : undefined,
        totalItems: 0
      }
    }
  }

  // --- Specific Fetch Methods (using imported types) ---

  private async fetchProjectMemberships(
    fullPath: string,
    afterCursor?: string
  ): Promise<{ data: ProjectMember[]; pageInfo: PageInfo }> {
    const query = `
      query GetProjectMembers($fullPath: ID!, $after: String) {
        project(fullPath: $fullPath) {
          projectMembers(first: 100, after: $after) {
            nodes { id user { id username name state webUrl } accessLevel { stringValue } }
            pageInfo { hasNextPage endCursor }
          } } }`
    const variables = { fullPath, after: afterCursor }
    const result = await this.executeGraphQL<ProjectMembersResponse>(query, variables)
    const members = result?.project?.projectMembers
    // Ensure nodes are correctly typed if needed, though connection type implies it
    return {
      data: (members?.nodes as ProjectMember[]) ?? [],
      pageInfo: members?.pageInfo ?? defaultPageInfo
    }
  }

  private async fetchGroupMemberships(
    fullPath: string,
    afterCursor?: string
  ): Promise<{ data: GroupMember[]; pageInfo: PageInfo }> {
    const query = `
      query GetGroupMembers($fullPath: ID!, $after: String) {
        group(fullPath: $fullPath) {
          groupMembers(first: 100, after: $after) {
            nodes { id user { id username name state webUrl } accessLevel { stringValue } }
            pageInfo { hasNextPage endCursor }
          } } }`
    const variables = { fullPath, after: afterCursor }
    const result = await this.executeGraphQL<GroupMembersResponse>(query, variables)
    const members = result?.group?.groupMembers
    return {
      data: (members?.nodes as GroupMember[]) ?? [],
      pageInfo: members?.pageInfo ?? defaultPageInfo
    }
  }

  private async fetchProjectIssues(
    fullPath: string,
    afterCursor?: string
  ): Promise<{ data: Issue[]; pageInfo: PageInfo }> {
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
            } } }`
    const variables = { fullPath, after: afterCursor }
    const result = await this.executeGraphQL<ProjectIssuesResponse>(query, variables)
    const issues = result?.project?.issues
    return {
      data: (issues?.nodes as Issue[]) ?? [],
      pageInfo: issues?.pageInfo ?? defaultPageInfo
    }
  }

  private async fetchGroupIssues(
    fullPath: string,
    afterCursor?: string
  ): Promise<{ data: Issue[]; pageInfo: PageInfo }> {
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
            } } }`
    const variables = { fullPath, after: afterCursor }
    const result = await this.executeGraphQL<GroupIssuesResponse>(query, variables)
    const issues = result?.group?.issues
    return {
      data: (issues?.nodes as Issue[]) ?? [],
      pageInfo: issues?.pageInfo ?? defaultPageInfo
    }
  }

  private async fetchProjectLabels(
    fullPath: string,
    afterCursor?: string
  ): Promise<{ data: Label[]; pageInfo: PageInfo }> {
    const query = `
        query GetProjectLabels($fullPath: ID!, $after: String) {
          project(fullPath: $fullPath) {
            labels(first: 100, after: $after) {
              nodes { id title description color textColor createdAt updatedAt }
              pageInfo { hasNextPage endCursor }
            } } }`
    const variables = { fullPath, after: afterCursor }
    const result = await this.executeGraphQL<ProjectLabelsResponse>(query, variables)
    const labels = result?.project?.labels
    return {
      data: (labels?.nodes as Label[]) ?? [],
      pageInfo: labels?.pageInfo ?? defaultPageInfo
    }
  }

  private async fetchGroupLabels(
    fullPath: string,
    afterCursor?: string
  ): Promise<{ data: Label[]; pageInfo: PageInfo }> {
    const query = `
        query GetGroupLabels($fullPath: ID!, $after: String) {
          group(fullPath: $fullPath) {
            labels(first: 100, after: $after, includeAncestorGroups: false) {
              nodes { id title description color textColor createdAt updatedAt }
              pageInfo { hasNextPage endCursor }
            } } }`
    const variables = { fullPath, after: afterCursor }
    const result = await this.executeGraphQL<GroupLabelsResponse>(query, variables)
    const labels = result?.group?.labels
    return {
      data: (labels?.nodes as Label[]) ?? [],
      pageInfo: labels?.pageInfo ?? defaultPageInfo
    }
  }

  private async fetchProjectMilestones(
    fullPath: string,
    afterCursor?: string
  ): Promise<{ data: Milestone[]; pageInfo: PageInfo }> {
    const query = `
        query GetProjectMilestones($fullPath: ID!, $after: String) {
          project(fullPath: $fullPath) {
            milestones(first: 100, after: $after, includeDescendants: false, state: all) {
              nodes { id iid title description state startDate dueDate createdAt updatedAt webUrl }
              pageInfo { hasNextPage endCursor }
            } } }`
    const variables = { fullPath, after: afterCursor }
    const result = await this.executeGraphQL<ProjectMilestonesResponse>(query, variables)
    const milestones = result?.project?.milestones
    return {
      data: (milestones?.nodes as Milestone[]) ?? [],
      pageInfo: milestones?.pageInfo ?? defaultPageInfo
    }
  }

  private async fetchGroupMilestones(
    fullPath: string,
    afterCursor?: string
  ): Promise<{ data: Milestone[]; pageInfo: PageInfo }> {
    const query = `
        query GetGroupMilestones($fullPath: ID!, $after: String) {
          group(fullPath: $fullPath) {
            milestones(first: 100, after: $after, includeDescendants: true, state: all) {
              nodes { id iid title description state startDate dueDate createdAt updatedAt webUrl }
              pageInfo { hasNextPage endCursor }
            } } }`
    const variables = { fullPath, after: afterCursor }
    const result = await this.executeGraphQL<GroupMilestonesResponse>(query, variables)
    const milestones = result?.group?.milestones
    return {
      data: (milestones?.nodes as Milestone[]) ?? [],
      pageInfo: milestones?.pageInfo ?? defaultPageInfo
    }
  }

  private async fetchProjectBranches(
    fullPath: string,
    afterCursor?: string
  ): Promise<{ data: any[]; pageInfo: PageInfo }> {
    // Use any[] for data
    const query = `
        query GetProjectBranches($fullPath: ID!, $after: String) {
          project(fullPath: $fullPath) {
            repository {
              branches(first: 100, after: $after) {
                nodes { name webUrl protected developersCanPush developersCanMerge commit { id authoredDate committedDate message webUrl author { name email user { username } } committer { name email user { username } } } }
                pageInfo { hasNextPage endCursor }
              } } } }`
    const variables = { fullPath, after: afterCursor }
    const result = await this.executeGraphQL<ProjectBranchesResponse>(query, variables)
    const branches = result?.project?.repository?.branches
    return { data: branches?.nodes ?? [], pageInfo: branches?.pageInfo ?? defaultPageInfo } // Removed type assertion
  }

  private async fetchProjectMergeRequests(
    fullPath: string,
    afterCursor?: string
  ): Promise<{ data: MergeRequest[]; pageInfo: PageInfo }> {
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
            } } }`
    const variables = { fullPath, after: afterCursor }
    const result = await this.executeGraphQL<ProjectMergeRequestsResponse>(query, variables)
    const mergeRequests = result?.project?.mergeRequests
    return {
      data: (mergeRequests?.nodes as MergeRequest[]) ?? [],
      pageInfo: mergeRequests?.pageInfo ?? defaultPageInfo
    }
  }

  private async fetchGroupMergeRequests(
    fullPath: string,
    afterCursor?: string
  ): Promise<{ data: MergeRequest[]; pageInfo: PageInfo }> {
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
            } } }`
    const variables = { fullPath, after: afterCursor }
    const result = await this.executeGraphQL<GroupMergeRequestsResponse>(query, variables)
    const mergeRequests = result?.group?.mergeRequests
    return {
      data: (mergeRequests?.nodes as MergeRequest[]) ?? [],
      pageInfo: mergeRequests?.pageInfo ?? defaultPageInfo
    }
  }

  private async fetchProjectReleases(
    fullPath: string,
    afterCursor?: string
  ): Promise<{ data: Release[]; pageInfo: PageInfo }> {
    const query = `
        query GetProjectReleases($fullPath: ID!, $after: String) {
          project(fullPath: $fullPath) {
            releases(first: 50, after: $after, orderBy: RELEASED_AT, sort: DESC) {
              nodes { tagName name createdAt releasedAt commit { id } author { id username name } assets { count sources(first: 10) { nodes { format url } } links(first: 10) { nodes { id name url linkType } } } milestones(first: 10) { nodes { id title } } }
              pageInfo { hasNextPage endCursor }
            } } }`
    const variables = { fullPath, after: afterCursor }
    const result = await this.executeGraphQL<ProjectReleasesResponse>(query, variables)
    const releases = result?.project?.releases
    return {
      data: (releases?.nodes as Release[]) ?? [],
      pageInfo: releases?.pageInfo ?? defaultPageInfo
    }
  }

  private async fetchProjectPipelines(
    fullPath: string,
    afterCursor?: string
  ): Promise<{ data: Pipeline[]; pageInfo: PageInfo }> {
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
            } } }`
    const variables = { fullPath, after: afterCursor }
    const result = await this.executeGraphQL<ProjectPipelinesResponse>(query, variables)
    const pipelines = result?.project?.pipelines
    return {
      data: (pipelines?.nodes as Pipeline[]) ?? [],
      pageInfo: pipelines?.pageInfo ?? defaultPageInfo
    }
  }

  private async fetchProjectTimelogs(
    fullPath: string,
    afterCursor?: string
  ): Promise<{ data: Timelog[]; pageInfo: PageInfo }> {
    const query = `
        query GetProjectTimelogs($fullPath: ID!, $after: String) {
          project(fullPath: $fullPath) {
            timelogs(first: 100, after: $after) {
              nodes { timeSpent user { id username name } issue { id iid title } mergeRequest { id iid title } note { id body } spentAt summary }
              pageInfo { hasNextPage endCursor }
            } } }`
    const variables = { fullPath, after: afterCursor }
    const result = await this.executeGraphQL<ProjectTimelogsResponse>(query, variables)
    const timelogs = result?.project?.timelogs
    return {
      data: (timelogs?.nodes as Timelog[]) ?? [],
      pageInfo: timelogs?.pageInfo ?? defaultPageInfo
    }
  }

  private async fetchGroupTimelogs(
    fullPath: string,
    afterCursor?: string
  ): Promise<{ data: Timelog[]; pageInfo: PageInfo }> {
    const query = `
        query GetGroupTimelogs($fullPath: ID!, $after: String) {
          group(fullPath: $fullPath) {
            timelogs(first: 100, after: $after) {
              nodes { timeSpent user { id username name } issue { id iid title } mergeRequest { id iid title } note { id body } spentAt summary }
              pageInfo { hasNextPage endCursor }
            } } }`
    const variables = { fullPath, after: afterCursor }
    const result = await this.executeGraphQL<GroupTimelogsResponse>(query, variables)
    const timelogs = result?.group?.timelogs
    return {
      data: (timelogs?.nodes as Timelog[]) ?? [],
      pageInfo: timelogs?.pageInfo ?? defaultPageInfo
    }
  }

  // Placeholder: Fetching discussions might be done per-issue/MR
  // private async fetchIssueDiscussions(issueId: string, afterCursor?: string): Promise<{ data: Discussion[]; pageInfo: PageInfo }> { ... }
  // private async fetchMergeRequestDiscussions(mrId: string, afterCursor?: string): Promise<{ data: Discussion[]; pageInfo: PageInfo }> { ... }

  private async fetchProjectVulnerabilities(
    fullPath: string,
    afterCursor?: string
  ): Promise<{ data: Vulnerability[]; pageInfo: PageInfo }> {
    const query = `
         query GetProjectVulnerabilities($fullPath: ID!, $after: String) {
           project(fullPath: $fullPath) {
             vulnerabilities(first: 50, after: $after, state: [DETECTED, CONFIRMED]) {
               nodes { id title state severity confidence reportType scanner { id name vendor } identifiers { externalType externalId name url } location { file startLine endLine blobPath } project { id name fullPath } pipeline { id iid } detectedAt resolvedAt dismissedAt }
               pageInfo { hasNextPage endCursor }
             } } }`
    const variables = { fullPath, after: afterCursor }
    const result = await this.executeGraphQL<ProjectVulnerabilitiesResponse>(query, variables)
    const vulnerabilities = result?.project?.vulnerabilities
    return {
      data: (vulnerabilities?.nodes as Vulnerability[]) ?? [],
      pageInfo: vulnerabilities?.pageInfo ?? defaultPageInfo
    }
  }

  // Removed placeholder methods for Reports/Tests as they are now fetched via Pipelines query

  // --- NEW Methods for Group Discovery via REST ---

  /**
   * Fetches projects within a group using the REST API.
   * Handles pagination internally.
   * @param groupPath The full path of the group.
   * @returns An array of project data objects.
   */
  async fetchGroupProjects(groupPath: string): Promise<ProjectSchema[]> {
    console.log(`Fetching projects for group '${groupPath}' via REST...`)
    const groupId = encodeURIComponent(groupPath)
    const allProjects: any[] = [] // Use any[] to simplify type handling
    let page = 1
    const perPage = 100
    let keepFetching = true

    try {
      while (keepFetching) {
        const projectsPage = await this.restClient.Groups.allProjects(groupId, {
          page: page,
          perPage: perPage
          // Add other options like 'archived=false' if needed
        })

        if (projectsPage && projectsPage.length > 0) {
          allProjects.push(...projectsPage)
          if (projectsPage.length < perPage) {
            keepFetching = false
          } else {
            page++
          }
        } else {
          keepFetching = false
        }
        if (page > 100) {
          // Safety break
          console.warn(`Project fetch limit (100 pages) reached for group ${groupPath}. Stopping.`)
          keepFetching = false
        }
      }
      console.log(`Fetched ${allProjects.length} projects for group '${groupPath}'.`)
    } catch (error) {
      console.error(`Error fetching projects for group ${groupPath} via REST:`, error)
    }
    return allProjects
  }

  /**
   * Fetches subgroups within a group using the REST API.
   * Handles pagination internally.
   * @param groupPath The full path of the group.
   * @returns An array of group data objects.
   */
  async fetchGroupSubgroups(groupPath: string): Promise<GroupSchema[]> {
    console.log(`Fetching subgroups for group '${groupPath}' via REST...`)
    const groupId = encodeURIComponent(groupPath)
    const allSubgroups: any[] = [] // Use any[] to simplify type handling
    let page = 1
    const perPage = 100
    let keepFetching = true

    try {
      while (keepFetching) {
        const subgroupsPage = await this.restClient.Groups.allSubgroups(groupId, {
          page: page,
          perPage: perPage
        })

        if (subgroupsPage && subgroupsPage.length > 0) {
          allSubgroups.push(...subgroupsPage)
          if (subgroupsPage.length < perPage) {
            keepFetching = false
          } else {
            page++
          }
        } else {
          keepFetching = false
        }
        if (page > 100) {
          // Safety break
          console.warn(`Subgroup fetch limit (100 pages) reached for group ${groupPath}. Stopping.`)
          keepFetching = false
        }
      }
      console.log(`Fetched ${allSubgroups.length} subgroups for group '${groupPath}'.`)
    } catch (error) {
      console.error(`Error fetching subgroups for group ${groupPath} via REST:`, error)
    }
    return allSubgroups
  }
  // --- END NEW Methods ---
}
