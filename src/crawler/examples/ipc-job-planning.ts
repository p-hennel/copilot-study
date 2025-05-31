/**
 * Example showing how to use the GitLab Crawler with IPC-based job planning
 * 
 * This demonstrates creating a crawler that uses the supervisor client
 * for inter-process communication to plan jobs instead of creating them directly.
 */

import { SupervisorClient } from "../../subvisor/client";
import { EventType } from "../events/event-types";
import { GitLabCrawlerWithIPC } from "../gitlab-crawler-ipc";
import { type AuthConfig, type CrawlerConfig } from "../types/config-types";
import { JobType } from "../types/job-types";
import { getLogger } from "@logtape/logtape";
const logger = getLogger(["crawler","examples"]);

// Initialize the SupervisorClient (for Unix socket IPC)
const supervisorClient = new SupervisorClient();

// Connect to the supervisor
await supervisorClient.connect();

// Define crawler configuration
const config: CrawlerConfig = {
  gitlabUrl: "https://gitlab.com",
  auth: {
    oauthToken: process.env.GITLAB_TOKEN || "",
    clientId: process.env.GITLAB_CLIENT_ID,
    clientSecret: process.env.GITLAB_CLIENT_SECRET,
  } as AuthConfig,
  outputDir: "./output",
  requestsPerSecond: 10,
  // Required properties according to the type definition
  concurrency: 5,
  maxRetries: 3,
  retryDelayMs: 1000,
  // No need for hooks as the GitLabCrawlerWithIPC handles this automatically
};

// Create the crawler with the supervisor client
const crawler = new GitLabCrawlerWithIPC(config, supervisorClient);

// Listen for crawler events
crawler.on(EventType.CRAWLER_STARTED, (event) => {
  logger.info(`Crawler started at ${event.timestamp.toISOString()}`);
});

crawler.on(EventType.JOB_COMPLETED, (event) => {
  if (event.type === EventType.JOB_COMPLETED) {
    logger.info(`Job ${event.job.id} completed in ${event.duration}ms`);
    
    // The crawler will automatically use the hook to report discovered jobs
    // but you can also do it directly if needed
    if (event.discoveredJobs && event.discoveredJobs.length > 0) {
      logger.info(`Discovered ${event.discoveredJobs.length} jobs`);
    }
  }
});

// Start a specific resource type crawl
await crawler.startResourceType(
  JobType.GROUP_DETAILS,
  "your-group-id", 
  { resourcePath: "your-group/path" }
);

// Stay running for the life of the process
process.on("SIGINT", () => {
  logger.info("Received SIGINT, shutting down...");
  crawler.stop();
  supervisorClient.disconnect();
  process.exit(0);
});
