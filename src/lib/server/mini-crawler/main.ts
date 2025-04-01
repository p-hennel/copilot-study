import { db } from "../db"
import { tokenScopeJob } from "../db/base-schema"
import type {
  BatchProcessCallback,
  GraphQLGroupResponse,
  GraphQLProjectResponse,
  Group,
  ProgressCallback,
  ProgressStatus,
  Project
} from "./types"

export async function updateScopingJob(data: ProgressStatus, userId: string) {
  if (!userId) return
  let cursor = {}
  if (!data.groupsCursor || data.groupsCursor.length !== 0)
    cursor = {
      groupCursor: data.groupsCursor
    }
  if (!data.projectsCursor || data.projectsCursor.length !== 0)
    cursor = {
      groupCursor: data.projectsCursor
    }

  if (!data) return
  await db.update(tokenScopeJob).set({
    isComplete: data.isComplete,
    groupCursor: data.groupsCursor,
    projectCursor: data.projectsCursor,
    groupCount: data.collectedGroups,
    projectCount: data.collectedProjects,
    groupTotal: data.totalGroups,
    projectTotal: data.totalProjects,
    ...cursor
  })
}

/**
 * Fetches all groups and projects from GitLab GraphQL API with pagination
 *
 * @param gitlabGraphQLEndpoint - The GitLab GraphQL API endpoint
 * @param personalAccessToken - GitLab personal access token
 * @param onProgress - Callback function for progress updates
 * @param onBatchProcess - Callback function to process each batch of results
 * @returns Promise that resolves when all data has been fetched and processed
 */
async function fetchAllGroupsAndProjects(
  userId: string,
  gitlabGraphQLEndpoint: string,
  personalAccessToken: string,
  onBatchProcess: BatchProcessCallback,
  first: number | undefined = 40,
  _fetch: typeof fetch = fetch,
  onProgress: ProgressCallback = updateScopingJob
): Promise<void> {
  // Initialize tracking variables
  let groupsPage = 0
  let projectsPage = 0
  let collectedGroups = 0
  let collectedProjects = 0
  let totalGroups = 0
  let totalProjects = 0

  // Fetch and process all groups
  const loadingGroups = fetchAllGroups(
    gitlabGraphQLEndpoint,
    personalAccessToken,
    (groups, page, hasMoreGroups, cursor: string | null, total: number | null) => {
      if (!groups || groups.length <= 0) return
      groupsPage = page
      collectedGroups += groups?.length ?? 0
      if (total > totalGroups) totalGroups = total

      // Update progress after each group page
      onProgress(
        {
          groupsPage,
          projectsPage,
          collectedGroups,
          totalGroups,
          collectedProjects,
          totalProjects,
          groupsCursor: cursor,
          projectsCursor: "",
          isComplete: !hasMoreGroups
        },
        userId
      )

      // Process this batch of groups
      return onBatchProcess(groups, "groups")
    },
    first,
    _fetch
  )

  // Fetch and process all projects
  const loadingProjects = fetchAllProjects(
    gitlabGraphQLEndpoint,
    personalAccessToken,
    (projects, page, hasMoreProjects, cursor: string | null, total: number | null) => {
      if (!projects || projects.length <= 0) return
      projectsPage = page
      collectedProjects += projects?.length ?? 0
      if (total > totalProjects) totalProjects = total

      // Update progress after each project page
      onProgress(
        {
          groupsPage,
          projectsPage,
          collectedGroups,
          totalGroups,
          collectedProjects,
          totalProjects,
          groupsCursor: "",
          projectsCursor: cursor,
          isComplete: !hasMoreProjects
        },
        userId
      )

      // Process this batch of projects
      return onBatchProcess(projects, "projects")
    },
    first,
    _fetch
  )

  await Promise.all([loadingGroups, loadingProjects])

  // We don't need a final progress update here since the last project callback
  // will mark isComplete as true when hasMoreProjects is false
}

/**
 * Fetches all groups using pagination
 *
 * @param endpoint - GitLab GraphQL endpoint
 * @param token - Personal access token
 * @param callback - Function called for each page of groups
 */
async function fetchAllGroups(
  endpoint: string,
  token: string,
  callback: (
    groups: Group[],
    page: number,
    hasMorePages: boolean,
    cursor: string | null,
    total: number | null
  ) => Promise<void>,
  first: number | undefined = 40,
  _fetch: typeof fetch = fetch
): Promise<void> {
  let hasNextPage = true
  let cursor: string | null = null
  let currentPage = 0

  // GraphQL query for groups only
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
      }
    }
  `

  while (hasNextPage) {
    currentPage++

    // Fetch current page of groups
    const response: any = await fetchGraphQLPage<GraphQLGroupResponse>(endpoint, token, query, cursor, first, _fetch)
    if (!response) return callback([], 0, false, null, null)

    // Extract groups from response
    // And pagination info
    const { nodes, pageInfo, ...data } = response.data?.groups ?? { nodes: [], pageInfo: {} }

    hasNextPage = pageInfo?.hasNextPage ?? false
    cursor = pageInfo?.endCursor ?? null
    let total = null
    try {
      total = data?.totalCount ?? data?.count ?? null
    } catch {
      console.log("catch")
    }

    // Call the callback with this batch of groups
    await callback(nodes, currentPage, hasNextPage, cursor, total)
  }
}

/**
 * Fetches all projects using pagination
 *
 * @param endpoint - GitLab GraphQL endpoint
 * @param token - Personal access token
 * @param callback - Function called for each page of projects
 */
async function fetchAllProjects(
  endpoint: string,
  token: string,
  callback: (
    projects: Project[],
    page: number,
    hasMorePages: boolean,
    cursor: string | null,
    total: number | null
  ) => Promise<void>,
  first: number | undefined = 40,
  _fetch: typeof fetch = fetch
): Promise<void> {
  let hasNextPage = true
  let cursor: string | null = null
  let currentPage = 0

  // GraphQL query for projects onlys
  const query = `
    query GetProjects($after: String) {
      projects(searchNamespaces: true, includeHidden: true, sort: "id_asc", after: $after, first: 5) {
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
      }
    }
  `

  while (hasNextPage) {
    currentPage++

    // Fetch current page of projects
    const response: any = await fetchGraphQLPage<GraphQLProjectResponse>(endpoint, token, query, cursor, first, _fetch)
    if (!response) return callback([], 0, false, null, null)

    // Extract projects from response
    // And pagination info
    const { nodes, pageInfo, ...data } = response.data?.projects ?? { nodes: [], pageInfo: {} }
    hasNextPage = pageInfo?.hasNextPage ?? false
    cursor = pageInfo?.endCursor ?? null
    let total = null
    try {
      total = data?.totalCount ?? data?.count ?? null
    } catch {
      console.log("catch")
    }

    // Call the callback with this batch of projects
    await callback(nodes, currentPage, hasNextPage, cursor, total)
  }
}

/**
 * Helper function to fetch a single page of GraphQL data
 */
async function fetchGraphQLPage<T>(
  endpoint: string,
  token: string,
  query: string,
  after: string | null,
  first: number = 30,
  _fetch: typeof fetch = fetch
): Promise<T | undefined> {
  const response = await _fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      query,
      variables: { after, first }
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(Error(`GraphQL request failed: ${response.status} ${response.statusText}\n${errorText}`))
    return undefined
  }

  const data = (await response.json()) as any
  return data
}

/**
 * Optional function to fetch projects for a specific group if needed
 * This can be used if you need to get projects for specific groups after the initial queries
 */
export async function fetchProjectsForGroup(
  endpoint: string,
  token: string,
  groupId: string,
  _fetch: typeof fetch = fetch
): Promise<Project[]> {
  const query = `
    query GetGroupProjects($groupId: ID!) {
      group(id: $groupId) {
        projects(first: 50) {
          nodes {
            id
            name
            fullPath
            webUrl
            path
            description
          }
        }
      }
    }
  `

  const response = await _fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      query,
      variables: { groupId }
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}\n${errorText}`)
  }

  const data: any = await response.json()
  return data.data.group.projects.nodes
}

// Example usage:
/*
(async () => {
  const GITLAB_API = 'https://gitlab.example.com/api/graphql';
  const ACCESS_TOKEN = 'your_personal_access_token';
  
  await fetchAllGroupsAndProjects(
    GITLAB_API,
    ACCESS_TOKEN,
    // Progress callback
    (progress) => {
      console.log(`Progress: ${progress.collectedGroups} groups (page ${progress.groupsPage}), ${progress.collectedProjects} projects (page ${progress.projectsPage})`);
      if (progress.isComplete) {
        console.log('Data collection complete!');
      }
    },
    // Batch processing callback
    async (items, itemType) => {
      if (itemType === 'groups') {
        console.log(`Processing ${items.length} groups`);
        // Do something with the groups
      } else {
        console.log(`Processing ${items.length} projects`);
        // Do something with the projects
      }
      
      // Example: Save to database based on type
      // if (itemType === 'groups') {
      //   await saveGroupsToDatabase(items as Group[]);
      // } else {
      //   await saveProjectsToDatabase(items as Project[]);
      // }
      
      // Simulate some processing time
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  );
})();
*/

export default fetchAllGroupsAndProjects
