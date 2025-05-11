import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import AppSettings from '$lib/server/settings';
import { db } from '$lib/server/db';
import { job as jobSchema, tokenScopeJob, area, area_authorization, tokenScopeJobArea } from '$lib/server/db/base-schema';
import type { Job } from '$lib/server/db/base-schema';
import { JobStatus, CrawlCommand, AreaType } from '$lib/types';
import { eq, sql } from 'drizzle-orm';
import { getLogger } from '$lib/logging';
import { handleNewArea } from '$lib/server/job-manager';

const logger = getLogger(['backend', 'api', 'jobs', 'progress']);

const CRAWLER_API_TOKEN_FROM_SETTINGS = AppSettings().app?.CRAWLER_API_TOKEN;

if (!CRAWLER_API_TOKEN_FROM_SETTINGS) {
  logger.error(
    'CRITICAL: CRAWLER_API_TOKEN setting is not set. Progress update endpoint will be severely limited.'
  );
}

// Define the DiscoveredAreaData interface to match what the crawler sends
interface DiscoveredAreaData {
  type: 'group' | 'project';
  name: string;
  gitlabId: string;
  fullPath: string;
  webUrl?: string;
  description?: string | null;
  parentPath?: string | null;
  discoveredBy: string; // token or account identifier
}

// Extended payload interface to include areas for the new status type
interface ProgressUpdatePayload {
  taskId: string;
  status: string; // "started", "processing", "completed", "failed", "paused", "new_areas_discovered"
  processedItems?: number;
  totalItems?: number;
  currentDataType?: string;
  timestamp: string; // ISO string
  message?: string;
  error?: string | Record<string, any>;
  progress?: any; // For resume state, e.g., lastProcessedId or customParameters object
  areas?: DiscoveredAreaData[]; // New field for area discoveries
}

/**
 * Process newly discovered areas
 * This function inserts areas into the database and calls handleNewArea for each one
 */
async function processDiscoveredAreas(
  areas: DiscoveredAreaData[],
  jobRecord: Job
): Promise<{ groupsCount: number; projectsCount: number }> {
  if (!areas || areas.length === 0) {
    return { groupsCount: 0, projectsCount: 0 };
  }

  // Separate groups and projects
  const groups = areas.filter(area => area.type === 'group');
  const projects = areas.filter(area => area.type === 'project');
  
  logger.info(`Processing ${groups.length} groups and ${projects.length} projects for job ${jobRecord.id}`);

  // Transform areas for DB insertion
  const areaRecords = areas.map(area => ({
    full_path: area.fullPath,
    gitlab_id: area.gitlabId,
    name: area.name,
    type: area.type === 'group' ? AreaType.group : AreaType.project
  }));
  
  // Insert areas into database
  if (areaRecords.length > 0) {
    await db.insert(area).values(areaRecords).onConflictDoNothing();
    
    // Create area authorizations
    if (jobRecord.accountId) {
      const authorizations = areas.map(area => ({
        area_id: area.fullPath,
        accountId: jobRecord.accountId
      }));
      
      await db.insert(area_authorization).values(authorizations).onConflictDoNothing();
    }
    
    // Associate areas with tokenScopeJob if command is authorizationScope
    if (jobRecord.command === CrawlCommand.authorizationScope || 
        jobRecord.command === CrawlCommand.GROUP_PROJECT_DISCOVERY) {
      // Find the tokenScopeJob
      const scopeJob = await db.query.tokenScopeJob.findFirst({
        where: eq(tokenScopeJob.accountId, jobRecord.accountId)
      });
      
      if (scopeJob) {
        const scopeAreaRecords = areas.map(area => ({
          token_scope_job_id: scopeJob.id,
          full_path: area.fullPath
        }));
        
        await db.insert(tokenScopeJobArea).values(scopeAreaRecords).onConflictDoNothing();
      }
    }
  }
  
  // Trigger job creation for each discovered area
  for (const area of areas) {
    try {
      await handleNewArea(
        area.fullPath, 
        area.type === 'group' ? AreaType.group : AreaType.project, 
        area.gitlabId, 
        jobRecord.accountId
      );
    } catch (error) {
      logger.error(`Error handling new area ${area.fullPath}:`, { error });
      // Continue processing other areas
    }
  }
  
  return { groupsCount: groups.length, projectsCount: projects.length };
}

export const POST: RequestHandler = async ({ request }) => {
  // 1. Authentication
  const currentCrawlerApiToken = AppSettings().app?.CRAWLER_API_TOKEN;
  if (!currentCrawlerApiToken) {
    logger.error('Attempted to access progress update endpoint: CRAWLER_API_TOKEN setting not set.');
    return json({ error: 'Endpoint disabled due to missing configuration' }, { status: 503 });
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('Progress update: Missing or malformed Authorization header');
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = authHeader.substring('Bearer '.length);
  if (token !== currentCrawlerApiToken) {
    logger.warn('Progress update: Invalid CRAWLER_API_TOKEN provided');
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: ProgressUpdatePayload;
  try {
    payload = (await request.json()) as ProgressUpdatePayload;
  } catch (error) {
    logger.error('Error parsing progress update payload:', { error });
    return json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Basic validation for required fields
  if (!payload.taskId || !payload.status || !payload.timestamp) {
    logger.warn('Missing required fields in progress update payload:', { payload });
    return json({ error: 'Missing required fields: taskId, status, timestamp' }, { status: 400 });
  }

  const { taskId, status: crawlerStatus, timestamp, processedItems, totalItems, currentDataType, message, error: payloadError, progress: resumePayload, areas } = payload;

  try {
    const jobRecord = await db.query.job.findFirst({
      where: eq(jobSchema.id, taskId),
    });

    if (!jobRecord) {
      logger.warn(`Job not found for taskId: ${taskId}`);
      return json({ error: 'Job not found' }, { status: 404 });
    }

    // Special case for new_areas_discovered
    if (crawlerStatus.toLowerCase() === 'new_areas_discovered') {
      if (!areas || !Array.isArray(areas) || areas.length === 0) {
        logger.warn(`Received new_areas_discovered status but no areas in payload for job: ${taskId}`);
        return json({ error: 'Missing areas data in payload' }, { status: 400 });
      }

      // Process the discovered areas
      const { groupsCount, projectsCount } = await processDiscoveredAreas(areas, jobRecord);
      
      // Update the job record
      const updateData: Partial<Job> & { updated_at?: Date } = { 
        updated_at: new Date(),
        // Keep the job in running state
        status: JobStatus.running,
      };

      // Update job.progress blob to include the areas discovery
      const currentProgress = jobRecord.progress as Record<string, any> || {};
      const jobProgress = {
        ...currentProgress,
        processed: processedItems || currentProgress.processed,
        total: totalItems || currentProgress.total,
        currentDataType: currentDataType || currentProgress.currentDataType,
        lastAreasDiscovery: {
          timestamp,
          groupsCount,
          projectsCount,
          totalDiscovered: groupsCount + projectsCount
        },
        message: message || `Discovered ${groupsCount} groups and ${projectsCount} projects`
      };
      updateData.progress = jobProgress;

      await db.update(jobSchema).set(updateData).where(eq(jobSchema.id, taskId));
      
      // If this is an authorizationScope job, update tokenScopeJob counts
      if (jobRecord.command === CrawlCommand.authorizationScope || 
          jobRecord.command === CrawlCommand.GROUP_PROJECT_DISCOVERY) {
        await db.update(tokenScopeJob)
          .set({ 
            groupCount: sql`${tokenScopeJob.groupCount} + ${groupsCount}`,
            projectCount: sql`${tokenScopeJob.projectCount} + ${projectsCount}`,
            updated_at: new Date()
          })
          .where(eq(tokenScopeJob.accountId, jobRecord.accountId));
      }
      
      return json(
        {
          status: 'received',
          message: `Areas discovery processed for task ${taskId}: ${groupsCount} groups, ${projectsCount} projects`
        },
        { status: 200 }
      );
    }

    // Handle other standard statuses as before
    const updateData: Partial<Job> & { updated_at?: Date } = { updated_at: new Date() };
    let newJobStatus: JobStatus | null = null;

    switch (crawlerStatus.toLowerCase()) {
      case 'started':
        newJobStatus = JobStatus.running;
        if (jobRecord.status !== JobStatus.running) {
            updateData.started_at = new Date(timestamp);
        }
        break;
      case 'processing':
        newJobStatus = JobStatus.running;
        // No specific action if already running, updated_at will be set.
        // If it wasn't running, set started_at
        if (jobRecord.status !== JobStatus.running && !jobRecord.started_at) {
            updateData.started_at = new Date(timestamp);
        }
        break;
      case 'completed':
        newJobStatus = JobStatus.finished;
        updateData.finished_at = new Date(timestamp);
        updateData.resumeState = null; // Clear resume state on completion
        break;
      case 'failed':
        newJobStatus = JobStatus.failed;
        updateData.finished_at = new Date(timestamp);
        if (payloadError) {
          logger.error(`Job ${taskId} reported failure:`, { error: payloadError });
          // Storing complex errors might need a dedicated field or serialization
          // For now, if it's an object, stringify it for a simple text log or a progress message.
          // The 'job.progress' blob could store more detailed error info if needed.
        }
        // Preserve resumeState if present in payload, assuming it's for a retryable failure
        if (resumePayload) {
            updateData.resumeState = resumePayload;
        }
        break;
      case 'paused':
        newJobStatus = JobStatus.paused;
        if (resumePayload) {
          updateData.resumeState = resumePayload;
        }
        break;
      default:
        logger.warn(`Unknown status received from crawler: ${crawlerStatus} for taskId: ${taskId}`);
        // Potentially return an error or ignore, depending on desired strictness
        return json({ error: `Invalid status: ${crawlerStatus}` }, { status: 400 });
    }

    if (newJobStatus) {
      updateData.status = newJobStatus;
    }

    // Update job.progress blob
    const currentProgress = jobRecord.progress as Record<string, any> || {};
    const jobProgress = {
      ...currentProgress,
      processed: processedItems,
      total: totalItems,
      currentDataType: currentDataType,
      message: message,
      ...(crawlerStatus.toLowerCase() === 'failed' && payloadError ? { error: typeof payloadError === 'string' ? payloadError : JSON.stringify(payloadError) } : {})
    };
    updateData.progress = jobProgress;


    await db.update(jobSchema).set(updateData).where(eq(jobSchema.id, taskId));
    logger.info(`Job ${taskId} updated to status: ${updateData.status || jobRecord.status}`, { updateData });

    // Handle special case for authorizationScope completion
    if (newJobStatus === JobStatus.finished && 
        (jobRecord.command === CrawlCommand.authorizationScope || 
         jobRecord.command === CrawlCommand.GROUP_PROJECT_DISCOVERY)) {
      if (jobRecord.accountId) {
        await db.update(tokenScopeJob)
          .set({ isComplete: true, updated_at: new Date() })
          .where(eq(tokenScopeJob.accountId, jobRecord.accountId));
        logger.info(`Token scope job for account ${jobRecord.accountId} marked as complete.`);
      } else {
        logger.warn(`Job ${taskId} (authorizationScope/GROUP_PROJECT_DISCOVERY) finished but has no accountId. Cannot update tokenScopeJob.`);
      }
    }

    return json(
      {
        status: 'received',
        message: `Progress update acknowledged for task ${taskId}`
      },
      { status: 200 }
    );

  } catch (dbError) {
    logger.error(`Database error while processing progress update for taskId: ${taskId}:`, { error: dbError });
    return json({ error: 'Internal server error during progress update' }, { status: 500 });
  }
};