/**
 * GitLab REST API Crawler with IPC-based job planning
 *
 * A flexible, event-driven library for crawling GitLab instances via the REST API.
 * Modified to use IPC for job planning through the Supervisor.
 *
 * @packageDocumentation
 */

// Export main crawler class
export { GitLabCrawler } from "./gitlab-crawler";

// Export SupervisorClient wrapper for IPC-based job planning
export { CrawlerSupervisorClient } from "./client/supervisor-client";

// Export all types
export * from "./types";

// Export event system
export * from "./events";

// Export utility functions
export * from "./utils";

// Export registry
export * from "./registry";

/**
 * Library version
 */
export const VERSION = "1.0.1";
