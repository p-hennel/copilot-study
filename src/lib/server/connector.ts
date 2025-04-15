// processes/data-processor.ts
import { dev } from "$app/environment";
import type { CrawlerConfig, Job, JobFailedEvent, JobResult } from "$lib/../crawler";
import { SupervisorClient } from "$lib/../subvisor/client";
import { JobStatus } from "$lib/types";
import { eq } from "drizzle-orm";
import { getLogger } from "nodemailer/lib/shared";
import { db } from "./db";
import { job } from "./db/base-schema";
import AppSettings from "./settings";

let client: SupervisorClient;

export async function crawlJob(job: Job) {
  client.emit("crawlJob", { job });
}

export function getHeartbeats() {
  return heartbeats;
}

const heartbeats = {} as Record<string, Date>;

export async function boot() {
  const logger = getLogger(["connector", "main"]);
  client = new SupervisorClient();

  // Handle process-specific events
  client.on("connected", () => {
    console.log("Connected to supervisor");
  });

  client.on("disconnected", () => {
    console.log("Disconnected from supervisor, will attempt to reconnect");
  });

  client.on("stop", () => {
    console.log("Received stop command from supervisor");

    // Clean up
    setTimeout(() => {
      client.disconnect();
      process.exit(0);
    }, 1000);
  });

  client.on("needsConfig", () => {
    client.emit("config", {
      gitlabUrl: `${dev ? AppSettings().auth.providers.gitlabCloud.baseUrl : AppSettings().auth.providers.gitlab.baseUrl}`, // /api/v4
      auth: {
        clientId: dev
          ? AppSettings().auth.providers.gitlabCloud.clientId
          : AppSettings().auth.providers.gitlab.clientId,
        clientSecret: dev
          ? AppSettings().auth.providers.gitlabCloud.clientSecret
          : AppSettings().auth.providers.gitlab.clientSecret
      },
      outputDir: AppSettings().paths.archive,
      requestsPerSecond: 2,
      concurrency: 3,
      maxRetries: 3,
      retryDelayMs: 10000
    } as CrawlerConfig);
  });

  client.on("jobCompleted", (event: { job: Job; result: JobResult }) => {
    try {
      db.update(job)
        .set({
          status: event.result.success ? JobStatus.finished : JobStatus.failed,
          finished_at: new Date()
        })
        .where(eq(job.id, event.job.id));
    } catch {}
  });
  client.on("jobFailed", (event: { job: Job; event: JobFailedEvent }) => {
    try {
      db.update(job)
        .set({
          status: JobStatus.failed
        })
        .where(eq(job.id, event.job.id));
    } catch {
    } finally {
      logger.error("job {id} failed: {event}", {
        id: job.id,
        job,
        msg: event.event.error,
        event: event.event
      });
    }
  });

  client.on("heartbeat", (originId) => {
    heartbeats[originId] = new Date();
  });

  client.on("stateChange", (originId, newState, oldState) => {
    console.log(`Process ${originId} changed state from ${oldState} to ${newState}`);
  });

  // Connect to the supervisor
  await client.connect();

  // Keep process running
  process.stdin.resume();

  // Handle process termination signals
  process.on("SIGINT", async () => {
    console.log("Received SIGINT, shutting down gracefully");
    client.disconnect();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("Received SIGTERM, shutting down gracefully");
    client.disconnect();
    process.exit(0);
  });
}

/*
boot().catch(err => {
  console.error(`Error in data processor: ${err}`);
  process.exit(1);
});
*/
