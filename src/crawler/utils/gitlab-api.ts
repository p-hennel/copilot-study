/**
 * Utilities for working with the GitLab API directly
 *
 * These functions are used for endpoints not fully supported by GitBeaker
 * or when we need more control over the API requests.
 *
 * @packageDocumentation
 */

/**
 * Options for direct GitLab API requests
 */
export interface GitLabApiRequestOptions {
  /**
   * GitLab instance URL
   */
  gitlabUrl: string;

  /**
   * OAuth token for authentication
   */
  oauthToken: string;

  /**
   * HTTP method
   */
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

  /**
   * Request body (for POST, PUT, PATCH)
   */
  body?: any;

  /**
   * Query parameters
   */
  queryParams?: Record<string, string | number | boolean>;

  /**
   * Additional headers
   */
  additionalHeaders?: Record<string, string>;
}

/**
 * Make a direct request to the GitLab API
 *
 * @param endpoint - API endpoint path (without /api/v4 prefix)
 * @param options - Request options
 * @returns Promise with the JSON response
 * @throws Error if the request fails
 */
export async function gitlabApiRequest<T = any>(
  endpoint: string,
  options: GitLabApiRequestOptions
): Promise<T> {
  const { gitlabUrl, oauthToken, method = "GET", body, queryParams, additionalHeaders } = options;

  // Build URL with query parameters
  let url = `${gitlabUrl}/api/v4/${endpoint.startsWith("/") ? endpoint.substring(1) : endpoint}`;

  if (queryParams) {
    const params = new URLSearchParams();
    Object.entries(queryParams).forEach(([key, value]) => {
      params.append(key, String(value));
    });
    url += `?${params.toString()}`;
  }

  // Prepare headers
  const headers: Record<string, string> = {
    Authorization: `Bearer ${oauthToken}`,
    Accept: "application/json",
    ...additionalHeaders
  };

  // Add content type for requests with body
  if (body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  // Make the request
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  // Handle error responses
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`GitLab API resource not found: ${endpoint}`);
    }

    let errorMessage: string;
    try {
      const errorData: any = await response.json();
      errorMessage = errorData.message || errorData.error || response.statusText;
    } catch {
      errorMessage = response.statusText;
    }

    throw new Error(`GitLab API error (${response.status}): ${errorMessage}`);
  }

  // Parse and return the response
  return (await response.json()) as T;
}

/**
 * Get pipeline test report
 *
 * @param projectId - Project ID or path
 * @param pipelineId - Pipeline ID
 * @param options - API request options
 * @returns Pipeline test report
 */
export async function getPipelineTestReport(
  projectId: string | number,
  pipelineId: string | number,
  options: { gitlabUrl: string; oauthToken: string }
): Promise<any> {
  return gitlabApiRequest(
    `projects/${encodeURIComponent(String(projectId))}/pipelines/${pipelineId}/test_report`,
    {
      gitlabUrl: options.gitlabUrl,
      oauthToken: options.oauthToken
    }
  );
}

/**
 * Other custom API methods can be added here as needed
 */
