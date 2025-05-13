import { json, type RequestHandler } from "@sveltejs/kit";
import { getLogger } from "$lib/logging";
import AppSettings from "$lib/server/settings"; // Use AppSettings
import { db } from "$lib/server/db";
import { account } from "$lib/server/db/auth-schema";
import { area, job, type Job } from "$lib/server/db/base-schema";
import { JobStatus, CrawlCommand } from "$lib/types";
import { and, asc, eq, or, sql } from "drizzle-orm";
// import { TokenProvider } from '$lib/types'; // TokenProvider might not be needed if URL fallbacks are removed
import { isAdmin } from "$lib/server/utils";

const logger = getLogger(["backend", "api", "jobs", "open"]);

export const GET: RequestHandler = async ({ request, url, locals }) => {
  const currentCrawlerApiToken = AppSettings().app?.CRAWLER_API_TOKEN;
  if (!currentCrawlerApiToken && !locals.isSocketRequest && !isAdmin(locals)) {
    logger.error("Attempted to access disabled task endpoint: CRAWLER_API_TOKEN setting not set at request time.");
    return json({ error: "Endpoint disabled due to missing configuration" }, { status: 503 });
  }

  if (!locals.isSocketRequest && !isAdmin(locals)) {
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
  // const limitParam = parseInt(url.searchParams.get("limit") || "1", 10); // Limit param is now handled by iterative fetching
  // const fetchLimit = Math.max(1, Math.min(limitParam, 10));
  const batchSize = 10;
  const maxFetchAttempts = 5;

  logger.info(`Task request received. Resource: ${resourceParam || "any"}. Will fetch in batches of ${batchSize}, max ${maxFetchAttempts} attempts.`);

  try {
    const jobQueryConditions = [
      or(eq(job.status, JobStatus.queued), eq(job.status, JobStatus.failed))
    ];

    if (resourceParam) {
      let targetCommand: CrawlCommand | undefined;
      switch (resourceParam.toLowerCase()) {
        case "projects": targetCommand = CrawlCommand.project; break;
        case "groups": targetCommand = CrawlCommand.group; break;
        case "users": targetCommand = CrawlCommand.users; break;
        case "discover_all":
        case "group_project_discovery": targetCommand = CrawlCommand.GROUP_PROJECT_DISCOVERY; break;
        case "authorizationscope": targetCommand = CrawlCommand.authorizationScope; break;
        case "commits": targetCommand = CrawlCommand.commits; break;
        case "issues": targetCommand = CrawlCommand.issues; break;
        case "mergerequests": targetCommand = CrawlCommand.mergeRequests; break;
        case "vulnerabilities": targetCommand = CrawlCommand.vulnerabilities; break;
        case "pipelines": targetCommand = CrawlCommand.pipelines; break;
      }
      if (targetCommand) {
        jobQueryConditions.push(eq(job.command, targetCommand));
        logger.info(`Filtering jobs by command: ${targetCommand} for resource: ${resourceParam}`);
      } else {
        logger.warn(
          `Resource parameter '${resourceParam}' does not map to a specific command. Will pick from any command based on prioritization.`
        );
      }
    }

    for (let fetchAttempt = 0; fetchAttempt < maxFetchAttempts; fetchAttempt++) {
      const offset = fetchAttempt * batchSize;
      logger.info(`Fetching job batch ${fetchAttempt + 1}/${maxFetchAttempts}, offset: ${offset}, limit: ${batchSize}`);

      const jobDetailsList = await db.query.job.findMany({
        where: and(...jobQueryConditions),
        orderBy: [
          sql`CASE status WHEN ${JobStatus.queued} THEN 1 ELSE 2 END`,
          sql`CASE WHEN "resume_state" IS NOT NULL THEN 1 ELSE 2 END`,
          asc(job.finished_at),
          asc(job.created_at)
        ],
        with: {
          usingAccount: true
        },
        limit: batchSize,
        offset: offset
      });

      if (!jobDetailsList || jobDetailsList.length === 0) {
        logger.info(`No more jobs found in batch ${fetchAttempt + 1}. Stopping fetch attempts.`);
        break; // No more jobs to fetch that match criteria, exit outer loop
      }
    
      for (const jobDetailsCandidate of jobDetailsList) {
        if (!jobDetailsCandidate) {
          logger.warn("Encountered null/undefined job candidate in list, skipping.");
          continue;
        }

        const currentJob: Job & { usingAccount: typeof account.$inferSelect } = {
          ...jobDetailsCandidate,
          usingAccount: jobDetailsCandidate.usingAccount
        };

        if (!currentJob.usingAccount) {
          logger.error(
            `Job ${currentJob.id} (candidate) with accountId ${currentJob.accountId} is missing associated account data. Marking as failed.`
          );
          await db
            .update(job)
            .set({ status: JobStatus.failed, finished_at: new Date(), progress: { error: "Missing account data" } })
            .where(eq(job.id, currentJob.id));
          continue; // Try next candidate in this batch
        }

        const providerAccessToken = currentJob.usingAccount.accessToken;
        if (!providerAccessToken) {
          logger.error(
            `Account ${currentJob.usingAccount.id} for job ${currentJob.id} (candidate) is missing accessToken. Marking as failed.`
          );
          await db
            .update(job)
            .set({ status: JobStatus.failed, finished_at: new Date(), progress: { error: "Missing access token" } })
            .where(eq(job.id, currentJob.id));
          continue; // Try next candidate in this batch
        }

        const jobGitlabGraphQLUrl = currentJob.gitlabGraphQLUrl;
        if (!jobGitlabGraphQLUrl) {
          logger.error(
            `Job ${currentJob.id} (candidate) is missing gitlabGraphQLUrl. This field is mandatory. Marking as failed.`
          );
          await db
            .update(job)
            .set({ status: JobStatus.failed, finished_at: new Date(), progress: { error: "Missing gitlabGraphQLUrl" } })
            .where(eq(job.id, currentJob.id));
          continue; // Try next candidate in this batch
        }

        let gitlabApiUrl;
        try {
          const parsedUrl = new URL(jobGitlabGraphQLUrl);
          gitlabApiUrl = parsedUrl.origin // `${parsedUrl.origin}/api/v4`;
          logger.debug(`Constructed gitlabApiUrl: ${gitlabApiUrl} from jobGitlabGraphQLUrl: ${jobGitlabGraphQLUrl} for job ${currentJob.id}`);
        } catch (urlError: any) {
          logger.error(
            `Job ${currentJob.id} (candidate): Invalid format for gitlabGraphQLUrl '${jobGitlabGraphQLUrl}': ${urlError.message}. Marking as failed.`
          );
          await db
            .update(job)
            .set({ status: JobStatus.failed, finished_at: new Date(), progress: { error: `Invalid gitlabGraphQLUrl: ${urlError.message}` } })
            .where(eq(job.id, currentJob.id));
          continue; // Try next candidate in this batch
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
        case CrawlCommand.GROUP_PROJECT_DISCOVERY:
          resourceType = "instance";
          dataTypes = ["discover_all_groups_projects"];
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
          
          const firstAreaRecord = areaRecords?.[0];
          if (firstAreaRecord?.gitlab_id) {
            resourceId = firstAreaRecord.gitlab_id;
          } else {
            logger.warn(`Area record not found for full_path: ${currentJob.full_path}, or gitlab_id missing. Using full_path as resourceId.`, {jobId: currentJob.id});
            resourceId = currentJob.full_path;
          }
        } else if (
          currentJob.command === CrawlCommand.authorizationScope ||
          currentJob.command === CrawlCommand.users ||
          currentJob.command === CrawlCommand.GROUP_PROJECT_DISCOVERY
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

        logger.debug(`Value of providerAccessToken before taskObject assembly: '${providerAccessToken}'`);

        const archivePath = AppSettings().paths.archive; // Corrected: paths instead of path
        const intendedOutputConfig = {
          storageType: "filesystem",
          basePath: archivePath, // Use archive path from settings
          format: "json"
        };
        logger.debug(`Intended outputConfig before taskObject assembly: ${JSON.stringify(intendedOutputConfig, null, 2)}`);
        
        logger.debug(`currentJob.usingAccount before taskObject assembly: ${JSON.stringify(currentJob.usingAccount, null, 2)}`);

        const appSettings = AppSettings();
        let clientId: string | undefined;
        let clientSecret: string | undefined;

        const providerId = currentJob.usingAccount.providerId;
        if (providerId === "gitlab" || providerId === "gitlab-onprem") {
          clientId = appSettings.auth?.providers?.gitlab?.clientId;
          clientSecret = appSettings.auth?.providers?.gitlab?.clientSecret;
        } else if (providerId === "gitlabCloud" || providerId === "gitlab-cloud") {
          clientId = appSettings.auth?.providers?.gitlabCloud?.clientId;
          clientSecret = appSettings.auth?.providers?.gitlabCloud?.clientSecret;
        } else {
          logger.warn(`Unknown or unsupported providerId '${providerId}' for job ${currentJob.id}. Cannot determine OAuth client credentials.`);
        }

        if (!clientId || !clientSecret) {
          logger.error(
            `Job ${currentJob.id} (candidate) is missing OAuth clientId or clientSecret in application settings for provider '${providerId}'. Marking as failed.`
          );
          await db
            .update(job)
            .set({ status: JobStatus.failed, finished_at: new Date(), progress: { error: "Missing OAuth client credentials in settings" } })
            .where(eq(job.id, currentJob.id));
          continue; // Try next candidate in this batch
        }

        const taskObject = {
          taskId: currentJob.id,
          gitlabApiUrl: gitlabApiUrl,
          credentials: {
            accessToken: providerAccessToken,
            refreshToken: currentJob.usingAccount.refreshToken,
            tokenType: 'oauth2',
            clientId: clientId,
            clientSecret: clientSecret,
          },
          resourceType: resourceType,
          resourceId: resourceId,
          dataTypes: dataTypes,
          outputConfig: {
            storageType: "filesystem",
            basePath: archivePath, // Use archive path from settings
            format: "json"
          },
          lastProcessedId: lastProcessedId,
          customParameters: customParameters
        };

        logger.info("Task constructed and ready to be returned") //, { taskId: taskObject.taskId, resourceType: taskObject.resourceType, resourceId: taskObject.resourceId });
        logger.debug(`Full task object for ${taskObject.taskId}: ${JSON.stringify(taskObject)}`);
        return json([taskObject], { status: 200 }); // Return the first suitable job
      }
      // If inner loop finishes for this batch, continue to next fetchAttempt (outer loop)
    }

    // If the outer loop finishes (all attempts made or broke early due to no more jobs), no suitable job was found.
    logger.info("No suitable job found after checking all fetched candidates across all attempts.");
    return json([], { status: 200 });

  } catch (e: unknown) {
    const errorDetails: Record<string, unknown> = { message: "An unexpected error occurred" };
    if (e instanceof Error) {
      errorDetails.errorMessage = e.message;
      errorDetails.errorStack = e.stack; // Be cautious about logging full stack traces in production
    } else if (typeof e === 'string') {
      errorDetails.errorMessage = e;
    }
    logger.error('Error during task provisioning:', errorDetails);
    return json([], { status: 500 }); // Return empty array on error
  }
};