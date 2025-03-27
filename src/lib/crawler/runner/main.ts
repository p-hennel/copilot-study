import { parseArgs } from "util";
import { configureLogging } from "../../logging";
import { JobStatus, normalizeURL } from "$lib/utils";
import type { AvailableJobType } from "$lib/utils";
import { Crawler } from "../gitlab";
import MessageBusClient from "$lib/messaging/MessageBusClient";

declare module "bun" {
  interface Env {
    GITLAB_GQL_URL: string;
    GITLAB_REST_URL: string;
    JIRA_BASE_URL: string;
    PUBLIC_API_URL: string;
    HMAC_KEY: string;
    HASH_ALG: string;
    DATA_ROOT_PATH?: string;
  }
}

function getParams() {
  const { values } = parseArgs({
    args: Bun.argv,
    options: {
      test: { type: "boolean", multiple: false },
      token: { type: "string", short: "t", multiple: false },
      url: { type: "string", short: "u", multiple: false },
      gql: { type: "string", short: "g", multiple: false },
      rest: { type: "string", short: "r", multiple: false },
      base: { type: "string", short: "b", multiple: false },
      out: { type: "string", short: "o", multiple: false },
      debug: { type: "boolean", short: "d", multiple: false },
      verbose: { type: "boolean", short: "v", multiple: false }
    },
    strict: true,
    allowNegative: true,
    allowPositionals: true
  });

  if (!values.test) {
    if (!values.url || !values.token) {
      throw new Error("Need both url together with token arguments!");
    }
  }
  if (!values.url) values.url = "http://localhost:4000";

  if (!!values.base) {
    values.base = normalizeURL(values.base);
    if (!values.gql) values.gql = `${values.base}/api/graphql`;
    if (!values.rest) values.rest = values.base;
  }
  return values;
}

const params = getParams();
const logger = await configureLogging("runner", params.verbose, params.debug);
logger.debug("parsed params", params);

/**
 * Fallback: Fetch a job using the API.
 */
async function getJobFromAPI(url: string, token: string): Promise<AvailableJobType | undefined> {
  try {
    const jobsResponse = await fetch(`${url}/api/jobs?perPage=1`, {
      headers: { Auth: `Bearer ${token}` }
    });
    if (!jobsResponse.ok) {
      let text = "";
      try {
        text = await jobsResponse.text();
      } catch (e) {}
      logger.error("Job request failed", {
        status: jobsResponse.status,
        statusText: jobsResponse.statusText,
        text
      });
      return undefined;
    }
    const result = await jobsResponse.json();
    if (result && result.length > 0) return result[0];
  } catch (error) {
    logger.error("Error fetching job from API: {error}", {error});
  }
  return undefined;
}

/**
 * Process a job by instantiating a GitLab crawler and executing the crawl() method.
 */
async function processJob(job: AvailableJobType): Promise<void> {
  if (job.provider === "gitlab") {
    const gitlabCrawler = new Crawler(
      logger.getChild("gitlab"),
      Bun.env.GITLAB_GQL_URL,
      Bun.env.GITLAB_REST_URL,
      job.accessToken ?? "",
      job.fullPath ?? undefined
    );
    await gitlabCrawler.crawl(job.command, job.fullPath);
  }
  // Report progress: if IPC is available, use MessageBus; otherwise, log it.
  if (process.send) {
    MessageBusClient.reportProgress(job.id, JobStatus.finished, { message: "Job processed successfully" });
  } else {
    logger.info(`Job ${job.id} processed successfully`);
  }
}

/**
 * Main runner loop:
 *  - First, try to request a job via IPC (MessageBus)
 *  - If that fails (or IPC is not available), fallback to API polling
 *  - Process the job and then loop for the next job.
 */
async function runRunnerContinuously() {
  while (true) {
    let job: AvailableJobType | undefined;
    if (process.send) {
      try {
        job = await MessageBusClient.requestJob(10000);
        logger.info("Received job via IPC", job);
      } catch (error) {
        logger.error("IPC job request failed, falling back to API polling: {error}", { error });
      }
    }
    if (!job) {
      job = await getJobFromAPI(params.url!, params.token!);
      if (job) {
        logger.info("Received job via API", job);
      }
    }
    if (job) {
      await processJob(job);
    } else {
      logger.info("No job available. Waiting before polling again.");
      // Wait a bit before trying again (e.g., 5 seconds)
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

await runRunnerContinuously();