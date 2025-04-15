/**
 * GitLab REST API Crawler
 *
 * A flexible, event-driven library for crawling GitLab instances via the REST API.
 * Optimized for the Bun JavaScript runtime and designed for real-world usage.
 *
 * @packageDocumentation
 */

// Export main crawler class
export { GitLabCrawler } from "./gitlab-crawler";

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
export const VERSION = "1.0.0";
