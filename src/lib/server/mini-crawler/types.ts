// Types for GitLab GraphQL response structure
export interface PageInfo {
  endCursor: string | null;
  hasNextPage: boolean;
}

export interface AreaBase {
  id: string;
  name: string;
  fullPath: string;
}
export interface Project extends AreaBase {
  webUrl: string;
  path: string;
  description: string | null;
  namespace?: {
    id: string;
    fullPath: string;
  };
}

export interface Group extends AreaBase {
  webUrl: string;
}

export interface GraphQLGroupResponse {
  data: {
    currentUser: {
      id: string;
      username: string;
      groups: {
        pageInfo: PageInfo;
        nodes: Group[];
      };
    };
  };
}

export interface GraphQLProjectResponse {
  data: {
    currentUser: {
      id: string;
      username: string;
      projects: {
        pageInfo: PageInfo;
        nodes: Project[];
      };
    };
  };
}

// Progress interface for status updates
export interface ProgressStatus {
  groupsPage: number;
  projectsPage: number;
  collectedGroups: number;
  totalGroups: number;
  collectedProjects: number;
  totalProjects: number;
  isComplete: boolean;
  groupsCursor: string | null;
  projectsCursor: string | null;
}

// Type definitions for the callback functions
export type ProgressCallback = (status: ProgressStatus, userId: string) => void;
export type BatchProcessCallback = (
  items: Group[] | Project[],
  itemType: "groups" | "projects",
  userId: string,
  accountId: string,
  tokenScopeJobId: string,
  provider?: import("$lib/types").TokenProvider
) => Promise<void>;
