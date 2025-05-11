import { json, type RequestHandler } from "@sveltejs/kit";
import { getLogger } from "$lib/logging";
import AppSettings, { type Settings } from "$lib/server/settings"; // Use AppSettings
import { db } from "$lib/server/db";
import { account } from "$lib/server/db/auth-schema";
import { area, job, type Job } from "$lib/server/db/base-schema";
import { JobStatus, CrawlCommand } from "$lib/types";
import { and, asc, eq } from "drizzle-orm";

const logger = getLogger(["backend", "api", "jobs", "open"]);

const CRAWLER_API_TOKEN_FROM_SETTINGS = AppSettings().app?.CRAWLER_API_TOKEN;

if (!CRAWLER_API_TOKEN_FROM_SETTINGS) {
  logger.error(
    "CRITICAL: CRAWLER_API_TOKEN setting is not set. Task provisioning endpoint will be disabled."
  );
}

export const GET: RequestHandler = async ({ request, url, locals }) => {
  const currentCrawlerApiToken = AppSettings().app?.CRAWLER_API_TOKEN;
  if (!currentCrawlerApiToken) {
    logger.error("Attempted to access disabled task endpoint: CRAWLER_API_TOKEN setting not set at request time.");
    return json({ error: "Endpoint disabled due to missing configuration" }, { status: 503 });
  }

  if (!locals.isSocketRequest) {
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
        case "discover_all": // New case for GROUP_PROJECT_DISCOVERY
        case "group_project_discovery": // Alternative alias
          targetCommand = CrawlCommand.GROUP_PROJECT_DISCOVERY;
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

    // Fetch the oldest queued job with its associated account information
    const jobDetails = await db.query.job.findFirst({
      where: and(...jobQueryConditions),
      orderBy: [asc(job.created_at)],
      with: {
        usingAccount: true // Fetch related account
      }
    });

    if (!jobDetails) {
      logger.info("No suitable queued job found.");
      return new Response(null, { status: 204 });
    }

    // Check if the associated account data was successfully fetched
    if (!jobDetails.usingAccount) {
      logger.error(
        `Job ${jobDetails.id} with accountId ${jobDetails.accountId} is missing associated account data. Cannot process task.`
      );
      // Optionally, set job to failed, though it might indicate a deeper data integrity issue
      await db
        .update(job)
        .set({ status: JobStatus.failed, finished_at: new Date() })
        .where(eq(job.id, jobDetails.id));
      return new Response(null, { status: 204 }); // No content, as the job cannot be processed by this worker
    }

    /*
    const now = new Date();
    // Try to mark the job as running
    const updatedJobArray = await db
      .update(job)
      .set({ status: JobStatus.running, started_at: now })
      .where(eq(job.id, jobDetails.id))

    if (!updatedJobArray || updatedJobArray.length === 0) {
      logger.error(
        `Failed to update job ${jobDetails.id} to running. It might have been picked by another process.`
      );
      return new Response(null, { status: 204 }); // No content, job was taken
    }

    // Use the updated job record from now on, but retain the 'usingAccount' from the initial fetch
    const currentJob: Job & { usingAccount: typeof account.$inferSelect } = {
      ...updatedJobArray[0]!,
      usingAccount: jobDetails.usingAccount // Add the account details to the current job object
    };
    */
    const currentJob: Job & { usingAccount: typeof account.$inferSelect } = {
      ...jobDetails!,
      usingAccount: jobDetails.usingAccount // Add the account details to the current job object
    };

    // Retrieve provider_access_token
    const providerAccessToken = currentJob.usingAccount.accessToken;

    if (!providerAccessToken) {
      logger.error(
        `Account ${currentJob.usingAccount.id} for job ${currentJob.id} is missing accessToken. Cannot process task.`
      );
      await db
        .update(job)
        .set({ status: JobStatus.failed, finished_at: new Date() })
        .where(eq(job.id, currentJob.id));
      return new Response(null, { status: 204 });
    }

    // Retrieve provider_instance_url
    // 1. Primary Source: job.gitlabGraphQLUrl
    let providerInstanceUrl = currentJob.gitlabGraphQLUrl;

    // 2. Secondary Source: System Settings if gitlabGraphQLUrl is not available or not suitable
    if (!providerInstanceUrl) {
      const providerKey = currentJob.usingAccount.providerId; // e.g., "gitlab", "gitlabCloud"
      if (providerKey) {
        try {
          const provKey = providerKey as keyof Settings["auth"]["providers"]
          // Access baseUrl from AppSettings().auth.providers.{providerKey}.baseUrl
          // The providerKey needs to match one of the keys in AppSettings().auth.providers (e.g., "gitlab", "gitlabCloud", "jira")
          const providerSettings = AppSettings().auth?.providers?.[provKey];

          if (providerSettings && 'baseUrl' in providerSettings && providerSettings.baseUrl) {
            providerInstanceUrl = providerSettings.baseUrl;
          } else {
            logger.warn(
              `Could not retrieve instance URL (baseUrl) from settings for providerKey '${providerKey}'. Job ${currentJob.id}. Provider settings found: ${providerSettings ? Object.keys(providerSettings).join(', ') : 'not found'}`
            );
          }
        } catch (settingsError: any) {
          logger.error(
            `Error retrieving instance URL from settings for job ${currentJob.id} using providerKey '${providerKey}': ${settingsError.message}`
          );
        }
      } else {
        logger.warn(
          `Missing providerId on usingAccount for job ${currentJob.id}, cannot fetch instance URL from settings.`
        );
      }
    }

    if (!providerInstanceUrl) {
      logger.error(
        `Account ${currentJob.usingAccount.id} for job ${currentJob.id} is missing provider_instance_url (checked job.gitlabGraphQLUrl and system settings). Cannot process task.`
      );
      await db
        .update(job)
        .set({ status: JobStatus.failed, finished_at: new Date() })
        .where(eq(job.id, currentJob.id));
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
    case CrawlCommand.GROUP_PROJECT_DISCOVERY: // New case for GROUP_PROJECT_DISCOVERY
      resourceType = "instance"; // Or "discovery"
      dataTypes = ["discover_all_groups_projects"]; // Or ["group_project_discovery"]
      break;
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
      currentJob.command === CrawlCommand.users ||
      currentJob.command === CrawlCommand.GROUP_PROJECT_DISCOVERY // Add new command here
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
    logger.error('Error during task provisioning:', errorDetails);
    return json({ error: "Internal server error while provisioning task" }, { status: 500 });
  }
};