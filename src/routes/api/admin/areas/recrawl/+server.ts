import { json } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { area, area_authorization, job } from "$lib/server/db/base-schema";
import { eq, desc } from "drizzle-orm";
import { getLogger } from "@logtape/logtape";
import { CrawlCommand, AreaType } from "$lib/types";
import { getCrawlCommandsForAreaType } from "$lib/server/job-manager";

const logger = getLogger(["routes","api","admin","areas","recrawl"]);

export async function POST({ locals, request }: { locals: any, request: Request }) {
  if (!locals.session || !locals.user?.id || locals.user.role !== "admin") {
    return json({ error: "Unauthorized!" }, { status: 401 });
  }

  try {
    const body = await request.json() as { fullPath?: string };
    const { fullPath } = body;

    if (!fullPath || typeof fullPath !== "string") {
      return json({ error: "Invalid fullPath provided" }, { status: 400 });
    }

    // Find the area to get its type
    const areaData = await db
      .select({ type: area.type, gitlabId: area.gitlab_id })
      .from(area)
      .where(eq(area.full_path, fullPath))
      .limit(1);

    if (areaData.length === 0) {
      return json({ error: "Area not found" }, { status: 404 });
    }

    const { type, gitlabId } = areaData[0]!;

    // Get authorized accounts for this area
    const authorizedAccounts = await db
      .select({ accountId: area_authorization.accountId })
      .from(area_authorization)
      .where(eq(area_authorization.area_id, fullPath));

    if (authorizedAccounts.length === 0) {
      return json({ error: "No authorized accounts found for this area" }, { status: 400 });
    }

    // Get an existing job for this area to inherit GitLab URL and provider info
    // This ensures new jobs have the same configuration as previous ones
    const existingJob = await db.query.job.findFirst({
      where: eq(job.full_path, fullPath),
      columns: {
        gitlabGraphQLUrl: true,
        provider: true
      },
      orderBy: [desc(job.created_at)]
    });

    if (!existingJob?.gitlabGraphQLUrl) {
      logger.warn("No GitLab URL found from existing jobs for area", { fullPath });
      return json({ error: "No GitLab URL configuration found for this area" }, { status: 400 });
    }

    // Determine which crawler commands to run based on area type
    const crawlCommands = getCrawlCommandsForAreaType(type as AreaType);
    
    let jobsCreated = 0;

    // Create jobs for each authorized account and each crawler command
    for (const account of authorizedAccounts) {
      for (const command of crawlCommands) {
        const jobData = {
          full_path: fullPath,
          accountId: account.accountId,
          command,
          gitlabGraphQLUrl: existingJob.gitlabGraphQLUrl,
          provider: existingJob.provider
        };

        try {
          await db.insert(job).values(jobData);
          jobsCreated++;
          logger.debug("Created job", { fullPath, accountId: account.accountId, command });
        } catch (error) {
          // If job already exists, skip it (handle unique constraint violation)
          logger.warn("Failed to create job (possibly duplicate)", { 
            fullPath, 
            accountId: account.accountId, 
            command, 
            error 
          });
        }
      }
    }

    logger.info("Re-crawl initiated", { fullPath, jobsCreated, accountCount: authorizedAccounts.length });

    return json({ 
      success: true, 
      jobsCreated,
      message: `Created ${jobsCreated} jobs for ${fullPath}`
    });

  } catch (error) {
    logger.error("Error creating re-crawl jobs", { error });
    return json({ error: "Failed to create re-crawl jobs" }, { status: 500 });
  }
}