import { json, type RequestHandler } from "@sveltejs/kit";
import { getLogger } from "$lib/logging";
// Ensure CRAWLER_API_TOKEN is defined in your .env file and SvelteKit's type generation has run (e.g., `npx svelte-kit sync`)
// For example, in .env: CRAWLER_API_TOKEN="your_secure_token"
// And in src/app.d.ts (or similar, often auto-generated):
// declare global {
//   namespace App {
//     interface Locals {}
//     interface PageData {}
//     interface Error {}
//     interface Platform {}
//     interface PrivateEnv {
//       CRAWLER_API_TOKEN: string;
//     }
//   }
// }
// export {};
import AppSettings from "$lib/server/settings"; // Use AppSettings
import { db } from "$lib/server/db";
import { account } from "$lib/server/db/auth-schema";
import { area, job, type Job } from "$lib/server/db/base-schema";
import { JobStatus, CrawlCommand } from "$lib/types";
import { and, asc, eq } from "drizzle-orm";

const logger = getLogger(["backend", "api", "crawler_tasks", "open"]);

const CRAWLER_API_TOKEN_FROM_SETTINGS = AppSettings().app?.CRAWLER_API_TOKEN;

if (!CRAWLER_API_TOKEN_FROM_SETTINGS) {
  logger.error(
    "CRITICAL: CRAWLER_API_TOKEN setting is not set. Task provisioning endpoint will be disabled."
  );
}

export const GET: RequestHandler = async ({ request, url }) => {
  const currentCrawlerApiToken = AppSettings().app?.CRAWLER_API_TOKEN;
  if (!currentCrawlerApiToken) {
    logger.error("Attempted to access disabled task endpoint: CRAWLER_API_TOKEN setting not set at request time.");
    return json({ error: "Endpoint disabled due to missing configuration" }, { status: 503 });
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logger.warn("Missing or malformed Authorization header");
    return json({ error: "Invalid or missing taskApiToken" }, { status: 401 });
  }

  const token = authHeader.substring("Bearer ".length);
  if (token !== currentCrawlerApiToken) {
    logger.warn("Invalid taskApiToken provided", {
      tokenProvided: token ? "****" + token.slice(-4) : "null"
    });
    return json({ error: "Invalid or missing taskApiToken" }, { status: 401 });
  }

  const resourceParam = url.searchParams.get("resource");
  logger.info(`Task request received. Resource parameter: ${resourceParam || "not provided"}`);

  try {
    const jobQueryConditions = [eq(job.status, JobStatus.queued)];

    if (resourceParam) {
      let targetCommand: CrawlCommand | undefined;
      switch (resourceParam.toLowerCase()) {
        case "projects":
          targetCommand = CrawlCommand.project;
          break;
        case "groups":
          targetCommand = CrawlCommand.group;
          break;
        case "users":
          targetCommand = CrawlCommand.users;
          break;
      }
      if (targetCommand) {
        jobQueryConditions.push(eq(job.command, targetCommand));
        logger.info(`Filtering jobs by command: ${targetCommand} for resource: ${resourceParam}`);
      } else {
        logger.info(
          `Resource parameter '${resourceParam}' does not map to a specific primary command. Will pick any oldest queued job.`
        );
      }
    }

    const potentialJobs = await db
      .select()
      .from(job)
      .where(and(...jobQueryConditions))
      .orderBy(asc(job.created_at))
      .limit(1)
      .execute();

    if (!potentialJobs || potentialJobs.length === 0) {
      logger.info("No suitable queued job found.");
      return new Response(null, { status: 204 });
    }

    // After the check above, potentialJobs[0] is guaranteed to exist.
    let currentJob: Job = potentialJobs[0]!;

    const now = new Date();
    const updatedJobs = await db
      .update(job)
      .set({ status: JobStatus.running, started_at: now })
      .where(eq(job.id, currentJob.id))
      .returning();

    if (!updatedJobs || updatedJobs.length === 0) {
      logger.error(`Failed to update job ${currentJob.id} to running. It might have been picked by another process.`);
      return new Response(null, { status: 204 });
    }
    // After this check, updatedJobs[0] is guaranteed to exist.
    currentJob = updatedJobs[0]!;

    const associatedAccounts = await db
      .select()
      .from(account)
      .where(eq(account.id, currentJob.accountId))
      .limit(1)
      .execute();

    if (!associatedAccounts || associatedAccounts.length === 0) {
      logger.error(`No account found for job ${currentJob.id} with accountId ${currentJob.accountId}. Cannot process task.`);
      await db.update(job).set({ status: JobStatus.failed, finished_at: new Date() }).where(eq(job.id, currentJob.id));
      return new Response(null, { status: 204 });
    }

    // After this check, associatedAccounts[0] is guaranteed to exist.
    const acc: typeof account.$inferSelect = associatedAccounts[0]!;
    
    const providerInstanceUrl = (acc as any).provider_instance_url as string | undefined;
    const providerAccessToken = (acc as any).provider_access_token as string | undefined || acc.accessToken;

    if (!providerInstanceUrl) {
      logger.error(`Account ${acc.id} for job ${currentJob.id} is missing provider_instance_url. Cannot process task.`);
      await db.update(job).set({ status: JobStatus.failed, finished_at: new Date() }).where(eq(job.id, currentJob.id));
      return new Response(null, { status: 204 });
    }
    if (!providerAccessToken) {
      logger.error(`Account ${acc.id} for job ${currentJob.id} is missing provider_access_token/accessToken. Cannot process task.`);
      await db.update(job).set({ status: JobStatus.failed, finished_at: new Date() }).where(eq(job.id, currentJob.id));
      return new Response(null, { status: 204 });
    }

    let gitlabApiUrl = providerInstanceUrl;
    if (!gitlabApiUrl.endsWith("/api/v4")) {
      gitlabApiUrl = gitlabApiUrl.endsWith("/") ? `${gitlabApiUrl}api/v4` : `${gitlabApiUrl}/api/v4`;
    }

    let resourceType: string;
    let dataTypes: string[];

    switch (currentJob.command) {
      case CrawlCommand.project:
        resourceType = "project";
        dataTypes = ["details", "members"];
        break;
      case CrawlCommand.group:
        resourceType = "group";
        dataTypes = ["details", "members", "projects", "subgroups"];
        break;
      case CrawlCommand.users:
        resourceType = "user";
        dataTypes = ["users_list"];
        break;
      case CrawlCommand.authorizationScope:
        resourceType = "instance";
        dataTypes = ["discover_groups", "discover_projects"];
        break;
      case CrawlCommand.commits:
        resourceType = "project"; dataTypes = ["commits"]; break;
      case CrawlCommand.issues:
        resourceType = "project"; dataTypes = ["issues"]; break;
      case CrawlCommand.mergeRequests:
        resourceType = "project"; dataTypes = ["merge_requests"]; break;
      case CrawlCommand.vulnerabilities:
        resourceType = "project"; dataTypes = ["vulnerabilities"]; break;
      case CrawlCommand.pipelines:
        resourceType = "project"; dataTypes = ["pipelines"]; break;
      default:
        logger.warn(`Unhandled job command '${currentJob.command}' for resourceType/dataTypes mapping.`, {jobId: currentJob.id, command: currentJob.command});
        resourceType = "unknown";
        dataTypes = ["unknown"];
    }

    let resourceId: string | number | null = null;
    if (currentJob.full_path) {
      const areaRecords = await db
        .select({ gitlab_id: area.gitlab_id })
        .from(area)
        .where(eq(area.full_path, currentJob.full_path))
        .limit(1)
        .execute();
      
      const firstAreaRecord = areaRecords?.[0]; // Use optional chaining
      if (firstAreaRecord?.gitlab_id) { // Check gitlab_id on the potentially existing record
        resourceId = firstAreaRecord.gitlab_id;
      } else {
        logger.warn(`Area record not found for full_path: ${currentJob.full_path}, or gitlab_id missing. Using full_path as resourceId.`, {jobId: currentJob.id});
        resourceId = currentJob.full_path;
      }
    } else if (
      currentJob.command === CrawlCommand.authorizationScope ||
      currentJob.command === CrawlCommand.users
    ) {
      resourceId = null;
    }

    const customParameters: Record<string, any> = {};
    if (currentJob.branch) customParameters.branch = currentJob.branch;
    if (currentJob.from) customParameters.from = currentJob.from.toISOString();
    if (currentJob.to) customParameters.to = currentJob.to.toISOString();

    let lastProcessedId: string | null = null;
    if (currentJob.resumeState) {
      if (typeof currentJob.resumeState === 'string') {
        lastProcessedId = currentJob.resumeState;
      } else if (typeof currentJob.resumeState === 'object' && currentJob.resumeState !== null) {
        customParameters.resumeState = currentJob.resumeState;
        const resumeStateObj = currentJob.resumeState as any;
        if ('cursor' in resumeStateObj && typeof resumeStateObj.cursor === 'string') {
            lastProcessedId = resumeStateObj.cursor;
        }
      }
    }

    const taskObject = {
      taskId: currentJob.id,
      gitlabApiUrl: gitlabApiUrl,
      credentials: { token: providerAccessToken },
      resourceType: resourceType,
      resourceId: resourceId,
      dataTypes: dataTypes,
      outputConfig: {
        storageType: "filesystem",
        basePath: "./crawled_data_output",
        format: "json"
      },
      lastProcessedId: lastProcessedId,
      customParameters: customParameters
    };

    logger.info("Task constructed and ready to be returned", { taskId: taskObject.taskId, resourceType: taskObject.resourceType, resourceId: taskObject.resourceId });
    return json(taskObject, { status: 200 });

  } catch (e: unknown) {
    const errorDetails: Record<string, unknown> = { message: "An unexpected error occurred" };
    if (e instanceof Error) {
      errorDetails.errorMessage = e.message;
      errorDetails.errorStack = e.stack;
    } else if (typeof e === 'string') {
      errorDetails.errorMessage = e;
    }
    logger.error("Error during task provisioning:", errorDetails);
    return json({ error: "Internal server error while provisioning task" }, { status: 500 });
  }
};