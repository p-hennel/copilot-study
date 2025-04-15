#!/usr/bin/env bun
import { parseArgs } from "util";

// processes/data-processor.ts
import { SupervisorClient } from "../subvisor/client";
import { ProcessState } from "../subvisor/types";
import { GitLabCrawler } from "./gitlab-crawler";
import type { CrawlerConfig } from "./types";

type NestedOmit<Schema, Path extends string> = Path extends `${infer Head}.${infer Tail}`
  ? Head extends keyof Schema
    ? {
        [K in keyof Schema]: K extends Head ? NestedOmit<Schema[K], Tail> : Schema[K];
      }
    : Schema
  : Omit<Schema, Path>;

const { values } = parseArgs({
  args: Bun.argv,
  options: {
    heartbeat: {
      type: "string",
      default: "5000"
    }
  },
  strict: true,
  allowPositionals: true
});

async function main() {
  console.log("Data processor starting up...");

  const client = new SupervisorClient();

  // Handle process-specific events
  client.on("connected", () => {
    console.log("Connected to supervisor");
    client.emit("needConfig");
  });

  let crawler: GitLabCrawler | undefined;
  let lastState = ProcessState.STARTING;

  const updateState = (newState: ProcessState) => {
    if (newState == lastState) return;
    lastState = newState;
    client.updateState(newState);
  };

  const checkIdleOrBusy = async () => {
    if (!crawler) updateState(ProcessState.STOPPED);
    else if (crawler.isActive()) {
      const stats = crawler.getQueueStats();
      const busy = Object.values(stats).some(({ queued, running }) => {
        return queued > 0 || running > 0;
      });
      updateState(busy ? ProcessState.BUSY : ProcessState.IDLE);
    }
  };

  client.on(
    "config",
    (
      _originId,
      config?: NestedOmit<
        NestedOmit<
          NestedOmit<Omit<CrawlerConfig, "hooks">, "includeResources.projectFilterFn">,
          "includeResources.groupFilterFn"
        >,
        "auth.tokenRefreshCallback"
      >
    ) => {
      config = {
        ...config,
        hooks: {
          afterJobComplete: (job, result) => {
            client.emit("jobCompleted", { job, result });
            checkIdleOrBusy();
          },
          jobFailed: (job, event) => {
            client.emit("jobFailed", { job, event });
            checkIdleOrBusy();
          }
        }
      } as CrawlerConfig;
      crawler = new GitLabCrawler(config as CrawlerConfig);
      crawler.isActive();
      updateState(ProcessState.IDLE);
    }
  );

  client.on("disconnected", () => {
    console.log("Disconnected from supervisor, will attempt to reconnect");
  });

  client.on("pause", () => {
    if (crawler && crawler.isActive()) crawler.pause();
  });

  client.on("resume", () => {
    if (crawler && !crawler.isActive()) crawler.resume();
  });

  client.on("stop", () => {
    console.log("Received stop command from supervisor");
    updateState(ProcessState.STOPPING);
    if (crawler) crawler.stop();

    // Clean up
    setTimeout(() => {
      client.disconnect();
      process.exit(0);
    }, 1000);
  });

  // Listen for state changes from other processes
  client.on("crawlJob", (_originId, newJob) => {
    crawler?.enqueueJob(newJob);
  });

  // Connect to the supervisor
  await client.connect();

  // Simulate some work
  console.log("Data processor is now running...");

  let heartbeat = 5000;
  try {
    heartbeat = parseInt(values.heartbeat);
  } catch {}
  if (heartbeat > 0) {
    setInterval(() => {
      client.emit("heartbeat");
      /*
      if (isBusy) {
        console.log('Processing data...');
        
        // Simulate sending a message to another process
        client.sendMessage('api-service', 'dataUpdate', {
          timestamp: Date.now(),
          records: Math.floor(Math.random() * 100)
        });
      }
      */
    }, heartbeat);
  }

  // Keep process running
  process.stdin.resume();

  // Handle process termination signals
  process.on("SIGINT", async () => {
    console.log("Received SIGINT, shutting down gracefully");
    updateState(ProcessState.STOPPING);
    client.disconnect();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("Received SIGTERM, shutting down gracefully");
    updateState(ProcessState.STOPPING);
    client.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(`Error in data processor: ${err}`);
  process.exit(1);
});
