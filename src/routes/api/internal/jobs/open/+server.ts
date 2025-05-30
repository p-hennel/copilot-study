import { json, type RequestHandler } from "@sveltejs/kit";
import { getLogger } from "$lib/logging";
import AppSettings from "$lib/server/settings"; // Use AppSettings
import { db } from "$lib/server/db";
import { account } from "$lib/server/db/auth-schema";
import { area, job, type Job } from "$lib/server/db/base-schema";
import { JobStatus } from "$lib/types";
import type { DataType, CrawlCommandName } from "$lib/server/types/area-discovery";
import { CrawlCommand } from "$lib/types";
import { crawlCommandConfig } from "$lib/server/types/area-discovery";
import { and, asc, eq, or, sql, inArray } from "drizzle-orm";
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
      const lowerResourceParam = resourceParam.toLowerCase();

      if (resourceParam === CrawlCommand.GROUP_PROJECT_DISCOVERY) {
        logger.info(`Filtering jobs where command is '${CrawlCommand.GROUP_PROJECT_DISCOVERY}' for resource parameter '${resourceParam}'`);
        jobQueryConditions.push(eq(job.command, CrawlCommand.GROUP_PROJECT_DISCOVERY as CrawlCommand));
      } else {
        let typesToFilterBy: DataType[] | undefined;
        // Check if resourceParam is a CrawlCommandName (e.g., "project", "group")
        // This should exclude 'GROUP_PROJECT_DISCOVERY' here as it's handled above.
        if (lowerResourceParam in crawlCommandConfig && lowerResourceParam !== CrawlCommand.GROUP_PROJECT_DISCOVERY.toLowerCase()) {
          typesToFilterBy = crawlCommandConfig[lowerResourceParam as CrawlCommandName];
          if (typesToFilterBy && typesToFilterBy.length > 0) {
            logger.info(`Filtering jobs where command is one of [${typesToFilterBy.join(', ')}] for resource parameter (CrawlCommandName) '${lowerResourceParam}'`);
          }
        }
        // Check if resourceParam is a specific DataType (e.g., "ProjectDetails")
        else if (lowerResourceParam !== CrawlCommand.GROUP_PROJECT_DISCOVERY.toLowerCase()) { // also ensure it's not GPD here
          const allKnownDataTypes = Object.values(crawlCommandConfig).flat();
          const actualDataType = allKnownDataTypes.find(dt => dt.toLowerCase() === lowerResourceParam);
          if (actualDataType) {
             typesToFilterBy = [actualDataType];
             logger.info(`Filtering jobs where command is '${actualDataType}' for resource parameter (DataType) '${resourceParam}'`);
          }
        }

        if (typesToFilterBy && typesToFilterBy.length > 0) {
          jobQueryConditions.push(inArray(job.command, typesToFilterBy as unknown as CrawlCommand[])); // job.command stores DataType strings
        } else if (lowerResourceParam !== CrawlCommand.GROUP_PROJECT_DISCOVERY.toLowerCase() && !(lowerResourceParam in crawlCommandConfig)) {
          // Avoid warning if it was GPD (handled by first 'if') or a known CrawlCommandName that yielded no typesToFilterBy
          logger.warn(
            `Resource parameter '${resourceParam}' does not map to a known CrawlCommandName or DataType. Will pick from any command based on prioritization.`
          );
        }
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
        let gitlabApiUrl: string | undefined;
        const appSettings = AppSettings(); // Get app settings once (this is the one we keep)

        if (jobGitlabGraphQLUrl) {
          try {
            const parsedUrl = new URL(jobGitlabGraphQLUrl);
            gitlabApiUrl = parsedUrl.origin;
            logger.debug(`Constructed gitlabApiUrl: ${gitlabApiUrl} from job.gitlabGraphQLUrl: ${jobGitlabGraphQLUrl} for job ${currentJob.id}`);
          } catch (urlError: any) {
            logger.warn(
              `Job ${currentJob.id} (candidate): Invalid format for job.gitlabGraphQLUrl '${jobGitlabGraphQLUrl}': ${urlError.message}. Will attempt fallback.`
            );
            // Don't fail yet, try fallback
          }
        }

        if (!gitlabApiUrl) { // If GraphQL URL didn't provide it or was invalid
          const providerId = currentJob.usingAccount.providerId;
          if (providerId === "gitlabCloud" || providerId === "gitlab-cloud") {
            gitlabApiUrl = "https://gitlab.com";
            logger.info(`Using default gitlabApiUrl: ${gitlabApiUrl} for providerId '${providerId}' for job ${currentJob.id}.`);
          } else if (providerId === "gitlab" || providerId === "gitlab-onprem") {
            const onPremBaseUrl = appSettings.auth?.providers?.gitlab?.baseUrl; // Changed to baseUrl
            if (onPremBaseUrl) {
              try {
                const parsedBaseUrl = new URL(onPremBaseUrl);
                gitlabApiUrl = parsedBaseUrl.origin;
                logger.info(`Constructed gitlabApiUrl: ${gitlabApiUrl} from AppSettings for providerId '${providerId}' ('${onPremBaseUrl}') for job ${currentJob.id}.`);
              } catch (urlError: any) {
                logger.error(
                  `Job ${currentJob.id} (candidate): Invalid format for AppSettings baseUrl '${onPremBaseUrl}' for providerId '${providerId}': ${urlError.message}.`
                );
                // Fall through to the final !gitlabApiUrl check to fail the job
              }
            } else {
              logger.warn(
                `Job ${currentJob.id} (candidate): AppSettings missing 'auth.providers.gitlab.baseUrl' for on-prem providerId '${providerId}'. Cannot determine gitlabApiUrl.`
              );
              // Fall through to the final !gitlabApiUrl check to fail the job
            }
          } else {
            logger.warn(`Job ${currentJob.id} (candidate): Unknown or unhandled providerId '${providerId}' for gitlabApiUrl determination.`);
            // Fall through to the final !gitlabApiUrl check to fail the job
          }
        }

        if (!gitlabApiUrl) {
          logger.error(
            `Job ${currentJob.id} (candidate): Could not determine gitlabApiUrl. job.gitlabGraphQLUrl was '${jobGitlabGraphQLUrl}', providerId was '${currentJob.usingAccount.providerId}'. Marking as failed.`
          );
          await db
            .update(job)
            .set({ status: JobStatus.failed, finished_at: new Date(), progress: { error: "Missing or invalid GitLab URL configuration" } })
            .where(eq(job.id, currentJob.id));
          continue; // Try next candidate in this batch
        }
        
        let determinedResourceType: CrawlCommandName | undefined;
        let taskDataTypes: DataType[] | string[] = [];
        let taskCommand: CrawlCommand | DataType | string;
        let resourceId: string | number | null = null;

        if (currentJob.command === CrawlCommand.GROUP_PROJECT_DISCOVERY) {
          determinedResourceType = 'GROUP_PROJECT_DISCOVERY' as CrawlCommandName;
          taskDataTypes = ["discover_all_groups_projects"];
          taskCommand = CrawlCommand.GROUP_PROJECT_DISCOVERY;
          resourceId = null;
          logger.info(`Job ${currentJob.id} is a GROUP_PROJECT_DISCOVERY command. Task resourceType: '${determinedResourceType}'.`);
        } else {
          const currentDataType = currentJob.command as unknown as DataType;
          taskCommand = currentDataType;

          for (const cmdNameKey in crawlCommandConfig) {
            const cmdName = cmdNameKey as CrawlCommandName;
            if (cmdName === CrawlCommand.GROUP_PROJECT_DISCOVERY) continue;

            if (crawlCommandConfig[cmdName].includes(currentDataType)) {
              determinedResourceType = cmdName;
              break;
            }
          }

          if (!determinedResourceType) {
            logger.error(`Could not determine CrawlCommandName (resourceType) for DataType: '${currentDataType}'. Job ID: ${currentJob.id}. Marking as failed.`);
            await db
              .update(job)
              .set({ status: JobStatus.failed, finished_at: new Date(), progress: { error: `Unknown DataType mapping for ${currentDataType}` } })
              .where(eq(job.id, currentJob.id));
            continue;
          }
          taskDataTypes = [currentDataType];

          if (determinedResourceType === 'instance') {
              resourceId = null;
          } else if (currentJob.full_path) {
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
                logger.warn(`Area record not found for full_path: ${currentJob.full_path}, or gitlab_id missing. Using full_path as resourceId for job ${currentJob.id}.`);
                resourceId = currentJob.full_path;
              }
          } else {
              if (determinedResourceType === 'user' && currentDataType === ('Users' as DataType)) {
                  resourceId = null;
              } else {
                  logger.warn(`Job ${currentJob.id} for ${determinedResourceType}/${currentDataType} (DataType) is missing full_path. resourceId will be null.`);
                  resourceId = null;
              }
          }
        }
        
        if (!determinedResourceType) {
          // This check ensures determinedResourceType is set, especially if logic changes.
          // For GPD, it's set directly. For DataType, it's found via crawlCommandConfig.
          logger.error(`Critical: determinedResourceType is undefined for job ${currentJob.id} with command ${currentJob.command}. Marking as failed.`);
          await db
            .update(job)
            .set({ status: JobStatus.failed, finished_at: new Date(), progress: { error: `Undetermined resourceType for command ${currentJob.command}` } })
            .where(eq(job.id, currentJob.id));
          continue;
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

        // const appSettings = AppSettings(); // This declaration is removed as it's now at line 135
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
          command: taskCommand, // Added: The actual command (DataType string or CrawlCommand enum value)
          gitlabApiUrl: gitlabApiUrl,
          credentials: {
            accessToken: providerAccessToken,
            refreshToken: currentJob.usingAccount.refreshToken,
            tokenType: 'oauth2',
            clientId: clientId,
            clientSecret: clientSecret,
          },
          resourceType: determinedResourceType, // This is CrawlCommandName
          resourceId: resourceId,
          dataTypes: taskDataTypes, // For DataType commands, [DataType]. For GPD, [].
          outputConfig: {
            storageType: "filesystem",
            basePath: archivePath,
            format: "json"
          },
          lastProcessedId: lastProcessedId,
          customParameters: customParameters
        };

        logger.info("✅ JOB-OPEN: Task constructed and ready to be returned", {
          taskId: taskObject.taskId,
          resourceType: taskObject.resourceType,
          resourceId: taskObject.resourceId,
          command: taskObject.command,
          gitlabApiUrl: taskObject.gitlabApiUrl
        });
        logger.debug(`📤 JOB-OPEN: Full task object for ${taskObject.taskId}: ${JSON.stringify(taskObject)}`);
        console.log(`🚀 JOB-OPEN: Returning job ${taskObject.taskId} with command ${taskObject.command} to external crawler`);
        return json([taskObject], { status: 200 }); // Return the first suitable job
      }
      // If inner loop finishes for this batch, continue to next fetchAttempt (outer loop)
    }

    // If the outer loop finishes (all attempts made or broke early due to no more jobs), no suitable job was found.
    logger.info("📭 JOB-OPEN: No suitable job found after checking all fetched candidates across all attempts.");
    console.log("📭 JOB-OPEN: Returning empty array - no jobs available");
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