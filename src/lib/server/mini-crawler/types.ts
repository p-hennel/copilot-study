// Types for GitLab GraphQL response structure
export interface PageInfo {
  endCursor: string | null
  hasNextPage: boolean
}

export interface Project {
  id: string
  name: string
  fullPath: string
  webUrl: string
  path: string
  description: string | null
  namespace?: {
    id: string
    fullPath: string
  }
}

export interface Group {
  id: string
  name: string
  fullPath: string
  webUrl: string
}

export interface GraphQLGroupResponse {
  data: {
    currentUser: {
      id: string
      username: string
      groups: {
        pageInfo: PageInfo
        nodes: Group[]
      }
    }
  }
}

export interface GraphQLProjectResponse {
  data: {
    currentUser: {
      id: string
      username: string
      projects: {
        pageInfo: PageInfo
        nodes: Project[]
      }
    }
  }
}

// Progress interface for status updates
export interface ProgressStatus {
  groupsPage: number
  projectsPage: number
  collectedGroups: number
  totalGroups: number
  collectedProjects: number
  totalProjects: number
  isComplete: boolean
  groupsCursor: string | null
  projectsCursor: string | null
}

// Type definitions for the callback functions
export type ProgressCallback = (status: ProgressStatus, userId: string) => void
export type BatchProcessCallback = (items: Group[] | Project[], itemType: "groups" | "projects") => Promise<void>
