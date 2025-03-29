import { JobPayload, FetcherState } from './types';

// --- Configuration ---
// TODO: Make GitLab API endpoint configurable (e.g., via environment variable or JobPayload)
const GITLAB_GRAPHQL_ENDPOINT = 'https://gitlab.com/api/graphql'; // Default to gitlab.com

// --- Interfaces ---

/**
 * Represents a single page of results from a paginated GraphQL query.
 */
interface PaginatedResponse<T> {
    nodes: T[];
    pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
    };
}

/**
 * Options for the fetchPaginatedData function.
 */
interface FetchOptions {
    /** The GraphQL query string. Must include pageInfo fragment. */
    query: string;
    /** Variables for the GraphQL query. */
    variables: Record<string, any>;
    /** The GitLab API token. */
    token: string;
    /** Optional AbortSignal to allow cancelling the fetch operation. */
    signal?: AbortSignal;
}

// --- Core Client Logic ---

/**
 * Makes a single request to the GitLab GraphQL endpoint.
 *
 * @param options FetchOptions containing query, variables, token, and signal.
 * @returns The JSON response from the API.
 * @throws Error if the request fails or returns GraphQL errors.
 */
async function makeGraphQLRequest(options: FetchOptions): Promise<any> {
    const { query, variables, token, signal } = options;

    try {
        const response = await fetch(GITLAB_GRAPHQL_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                // Consider adding 'User-Agent'
            },
            body: JSON.stringify({ query, variables }),
            signal: signal, // Pass the abort signal
        });

        if (signal?.aborted) {
            throw new DOMException('Request aborted', 'AbortError');
        }

        if (!response.ok) {
            throw new Error(`GitLab API request failed: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();

        if (result.errors) {
            console.error('[GitLabClient] GraphQL Errors:', JSON.stringify(result.errors, null, 2));
            // Consider more specific error handling based on error codes/types
            throw new Error(`GraphQL query failed: ${result.errors.map((e: any) => e.message).join(', ')}`);
        }

        return result.data;

    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
             console.log('[GitLabClient] Request aborted by signal.');
        } else {
            console.error('[GitLabClient] Error during GraphQL request:', error);
        }
        // Re-throw the error so the caller (fetcher) can handle it
        throw error;
    }
}

/**
 * Fetches data from a paginated GitLab GraphQL endpoint, handling pagination automatically.
 * Assumes the query follows the standard Relay connection pattern with pageInfo.
 *
 * Example Query Structure (within the main query):
 * ```graphql
 *   dataField(first: $first, after: $after) {
 *     nodes { ...fields }
 *     pageInfo {
 *       hasNextPage
 *       endCursor
 *     }
 *   }
 * ```
 *
 * @param options FetchOptions containing query, variables, token, and signal.
 * @param dataPath A function to extract the PaginatedResponse from the raw GraphQL result.
 *                 Example: (data) => data.project.issues
 * @param onPage Callback function executed for each page of results. Receives the nodes.
 * @param initialCursor Optional starting cursor for resuming pagination.
 * @returns The final endCursor after fetching all pages (or null if no pages).
 */
export async function fetchPaginatedData<T>(
    options: FetchOptions,
    dataPath: (data: any) => PaginatedResponse<T> | null | undefined,
    onPage: (nodes: T[]) => Promise<void> | void,
    initialCursor: string | null = null
): Promise<string | null> {
    let currentCursor: string | null = initialCursor;
    let hasNextPage = true;
    const { query, variables, token, signal } = options;
    const pageSize = variables.first || 50; // Default or use provided page size

    console.log(`[GitLabClient] Starting paginated fetch. Initial cursor: ${initialCursor}`);

    while (hasNextPage) {
        if (signal?.aborted) {
            console.log('[GitLabClient] Aborting paginated fetch due to signal.');
            throw new DOMException('Request aborted', 'AbortError');
        }

        const currentVariables = {
            ...variables,
            after: currentCursor,
            first: pageSize, // Ensure page size is included
        };

        try {
            const data = await makeGraphQLRequest({ query, variables: currentVariables, token, signal });

            if (!data) {
                console.warn('[GitLabClient] No data returned from GraphQL request.');
                hasNextPage = false;
                break;
            }

            const pageData = dataPath(data);

            if (!pageData || !pageData.pageInfo) {
                console.warn('[GitLabClient] Could not extract pageInfo or nodes from response using dataPath function. Stopping pagination.');
                 console.debug('[GitLabClient] Response data structure:', JSON.stringify(data, null, 2)); // Log structure for debugging
                hasNextPage = false;
                break;
            }

            if (pageData.nodes && pageData.nodes.length > 0) {
                await onPage(pageData.nodes); // Process the current page's data
            } else {
                 console.log('[GitLabClient] Received page with 0 nodes.');
            }

            hasNextPage = pageData.pageInfo.hasNextPage;
            currentCursor = pageData.pageInfo.endCursor;

            console.log(`[GitLabClient] Fetched page. HasNextPage: ${hasNextPage}, EndCursor: ${currentCursor}`);

            // Optional: Add delay between requests if needed
            // await new Promise(resolve => setTimeout(resolve, 100));

        } catch (error) {
            // Errors are logged in makeGraphQLRequest, re-throw to stop the fetcher
            console.error(`[GitLabClient] Error during paginated fetch (cursor: ${currentCursor}):`, error);
            throw error; // Propagate error up to the fetcher
        }
    }

    console.log(`[GitLabClient] Finished paginated fetch. Final cursor: ${currentCursor}`);
    return currentCursor; // Return the last cursor for saving state
}

// --- Helper for constructing common query parts ---

export const PAGE_INFO_FRAGMENT = `
  pageInfo {
    hasNextPage
    endCursor
  }
`;

// Example Usage (would be called from a fetcher)
/*
async function exampleFetchIssues() {
    const jobPayload: JobPayload = {
        jobId: 'test-123',
        gitlabPath: 'gitlab-org/gitlab-test', // Example project path
        gitlabToken: 'YOUR_GITLAB_TOKEN', // Replace with actual token
        dataTypes: ['issues'],
        storageBasePath: './crawler_output'
    };
    const initialFetcherState: FetcherState = { cursor: null }; // Or a previous cursor

    const issuesQuery = `
        query GetProjectIssues($fullPath: ID!, $first: Int!, $after: String) {
            project(fullPath: $fullPath) {
                id
                issues(first: $first, after: $after, state: all) {
                    nodes {
                        id
                        iid
                        title
                        state
                        createdAt
                        updatedAt
                        author { username }
                        assignees { nodes { username } }
                        labels { nodes { title color } }
                    }
                    ${PAGE_INFO_FRAGMENT}
                }
            }
        }
    `;

    const variables = {
        fullPath: jobPayload.gitlabPath,
        first: 50 // Page size
    };

    try {
        const finalCursor = await fetchPaginatedData(
            { query: issuesQuery, variables, token: jobPayload.gitlabToken },
            (data) => data?.project?.issues, // How to get to the nodes/pageInfo
            (nodes) => {
                console.log(`[Example] Received ${nodes.length} issues`);
                // Here you would call appendToJsonl for each node
                nodes.forEach(issue => {
                    // appendToJsonl(getStoragePath(...), issue);
                    console.log(` - Issue ${issue.iid}: ${issue.title}`);
                });
            },
            initialFetcherState.cursor // Start from the saved cursor
        );
        console.log('[Example] Finished fetching issues. Final cursor:', finalCursor);
        // Here you would call the saveState callback with the finalCursor
        // saveState(jobPayload.jobId, 'issues', { cursor: finalCursor });

    } catch (error) {
        console.error('[Example] Failed to fetch issues:', error);
    }
}

// exampleFetchIssues();
*/
