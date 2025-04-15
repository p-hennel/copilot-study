# GitLab Crawler CLI

A command-line tool that indefinitely waits for configurations and crawl jobs via a socket and then crawls GitLab instances via their API.

## Features

- Runs as a standalone daemon that accepts GitLab crawl job configurations
- Processes a queue of crawl jobs with individual authentication tokens 
- Communicates with the controlling application via socket using SupervisorClient
- Reports progress and job status back to the supervisor
- Can be paused/resumed on demand
- Supports individual authentication tokens for each job

## Usage

```bash
# Start the crawler with default settings
bun src/crawler/cli.ts

# Start with custom options
bun src/crawler/cli.ts --heartbeat 10000 --outputDir ./gitlab-data --gitlabUrl https://gitlab.example.com --concurrency 10
```

## Command Line Options

- `--heartbeat`: Interval in milliseconds for sending heartbeat signals (default: 5000)
- `--outputDir`: Directory where crawled data will be stored (default: "./data")
- `--gitlabUrl`: Base URL of the GitLab instance (default: "https://gitlab.com")
- `--concurrency`: Maximum number of concurrent jobs (default: 5)

## Socket Communication

The crawler communicates via a socket using the SupervisorClient from the `src/subvisor` module.

### Messages Sent by the Crawler:

- `ready`: Sent when the crawler is ready to accept jobs
- `jobAccepted`: Sent when a job is successfully queued
- `jobStarted`: Sent when a job starts processing
- `jobCompleted`: Sent when a job is successfully completed
- `jobFailed`: Sent when a job fails
- `jobError`: Sent when there was an error processing the job configuration
- `heartbeat`: Sent periodically to indicate that the crawler is alive
- `queueStats`: Sent periodically with current queue statistics
- `status`: Sent in response to status requests

### Messages Received by the Crawler:

- `crawlerConfig`: Updated crawler configuration
- `crawlJob`: New job to be added to the queue
- `pause`: Pause the crawler
- `resume`: Resume the crawler
- `stop`: Stop the crawler
- `getStatus`: Request crawler status

## Job Configuration Example

To add a job to the crawler's queue, send a `crawlJob` message with the following structure:

```typescript
{
  // Unique identifier for the job
  id: "myjob-123",
  
  // Job type from the JobType enum
  type: JobType.PROJECT_DETAILS,
  
  // Resource identifier (projectId, groupId, etc.)
  resourceId: "12345",
  
  // Optional resource path
  resourcePath: "my-group/my-project",
  
  // Optional additional data needed for the job
  data: { /* any additional data */ },
  
  // Optional job-specific authentication
  auth: {
    oauthToken: "job-specific-token-here",
    // Other optional auth properties:
    refreshToken: "refresh-token-here",
    clientId: "client-id-here",
    clientSecret: "client-secret-here",
    tokenExpiresAt: new Date("2025-01-01"),
  },
  
  // Optional parent job ID
  parentJobId: "parent-job-123"
}
```

## Using with the Supervisor

To use the crawler with the supervisor, you need to:

1. Configure the supervisor to launch the crawler
2. Connect to the supervisor to send commands and receive status updates
3. Send job configurations to the crawler through the supervisor

See the Supervisor documentation in `src/subvisor` for more details.
