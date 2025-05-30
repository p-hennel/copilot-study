import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import AppSettings from '$lib/server/settings';
import { db } from '$lib/server/db';
import { job as jobSchema, area, area_authorization, jobArea } from '$lib/server/db/base-schema'; // Removed tokenScopeJob, tokenScopeJobArea
import type { Job } from '$lib/server/db/base-schema';
import { JobStatus, CrawlCommand, AreaType, type CredentialStatusUpdate } from '$lib/types';
import { eq } from 'drizzle-orm';
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
  status: string; // "started", "processing", "completed", "failed", "paused", "new_areas_discovered", "credential_expiry", "credential_renewal", "credential_resumed"
  processedItems?: number;
  totalItems?: number;
  currentDataType?: string;
  timestamp: string; // ISO string
  message?: string;
  error?: string | Record<string, any>;
  progress?: any; // For resume state, e.g., lastProcessedId or customParameters object
  areas?: DiscoveredAreaData[]; // New field for area discoveries
  credentialStatus?: CredentialStatusUpdate; // New field for credential status updates
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
  
  logger.info(`Processing ${groups.length} groups and ${projects.length} projects for job ${jobRecord.id}. Areas received:`, { areas });

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
    
    // Associate areas with the GROUP_PROJECT_DISCOVERY job
    if (jobRecord.command === CrawlCommand.GROUP_PROJECT_DISCOVERY && jobRecord.id) {
      const jobAreaRecords = areas.map(discoveredArea => ({
        jobId: jobRecord.id, // Use the ID of the current GROUP_PROJECT_DISCOVERY job
        full_path: discoveredArea.fullPath
      }));
      
      if (jobAreaRecords.length > 0) {
        await db.insert(jobArea).values(jobAreaRecords).onConflictDoNothing();
        logger.info(`Associated ${jobAreaRecords.length} areas with job ${jobRecord.id}`);
      }
    }
  }
  
  // Trigger job creation for each discovered area
  for (const area of areas) {
    try {
      logger.debug(`Calling handleNewArea for area: ${area.fullPath}, type: ${area.type}, gitlabId: ${area.gitlabId}, accountId: ${jobRecord.accountId}`);
      await handleNewArea(
        area.fullPath,
        area.type === 'group' ? AreaType.group : AreaType.project,
        area.gitlabId,
        jobRecord.accountId
      );
    } catch (error) {
      logger.error(`Error handling new area ${area.fullPath}:`, { error, areaDetails: area });
      // Continue processing other areas
    }
  }
  
  logger.info(`Finished processing discovered areas for job ${jobRecord.id}. Groups: ${groups.length}, Projects: ${projects.length}`);
  return { groupsCount: groups.length, projectsCount: projects.length };
}

export const POST: RequestHandler = async ({ request, locals }) => { // Added locals
  // 1. Authentication
  const currentCrawlerApiToken = AppSettings().app?.CRAWLER_API_TOKEN;

  if (!locals.isSocketRequest) { // Check token only if not a socket request
    if (!currentCrawlerApiToken) {
      logger.error('Attempted to access progress update endpoint: CRAWLER_API_TOKEN setting not set for non-socket request.');
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
  } // End of if (!locals.isSocketRequest)

  let payload: ProgressUpdatePayload;
  try {
    payload = (await request.json()) as ProgressUpdatePayload;
    logger.info('📥 PROGRESS: Received progress update payload:', { payload });
    console.log(`📥 PROGRESS: Status update for task ${payload.taskId}: ${payload.status}`);
  } catch (error) {
    logger.error('❌ PROGRESS: Error parsing progress update payload:', { error, requestBody: await request.text().catch(() => 'Could not read request body') });
    return json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Basic validation for required fields
  if (!payload.taskId || !payload.status || !payload.timestamp) {
    logger.warn('Missing required fields in progress update payload:', { payload });
    return json({ error: 'Missing required fields: taskId, status, timestamp' }, { status: 400 });
  }

  const { taskId, status: crawlerStatus, timestamp, processedItems, totalItems, currentDataType, message, error: payloadError, progress: resumePayload, areas, credentialStatus } = payload;

  try {
    const jobRecord = await db.query.job.findFirst({
      where: eq(jobSchema.id, taskId),
    });

    if (!jobRecord) {
      logger.warn(`Job not found for taskId: ${taskId}. Payload was:`, { payload });
      return json({ error: 'Job not found' }, { status: 404 });
    }
    logger.info(`Found jobRecord for taskId ${taskId}:`, { jobRecord });

    // Special case for new_areas_discovered
    if (crawlerStatus.toLowerCase() === 'new_areas_discovered') {
      logger.info(`Processing 'new_areas_discovered' for job ${taskId}. Areas:`, { areas });
      if (!areas || !Array.isArray(areas) || areas.length === 0) {
        logger.warn(`Received new_areas_discovered status but no areas in payload for job: ${taskId}. Payload:`, { payload });
        return json({ error: 'Missing areas data in payload' }, { status: 400 });
      }

      // Process the discovered areas
      const { groupsCount, projectsCount } = await processDiscoveredAreas(areas, jobRecord);
      logger.info(`processDiscoveredAreas returned: groupsCount=${groupsCount}, projectsCount=${projectsCount} for job ${taskId}`);
      
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
      logger.debug(`Update data for 'new_areas_discovered' (before main update) for job ${taskId}:`, { updateData });

      await db.update(jobSchema).set(updateData).where(eq(jobSchema.id, taskId));
      logger.info(`Updated job ${taskId} after 'new_areas_discovered' processing.`);
      
      // If this is a GROUP_PROJECT_DISCOVERY job, update its progress with counts
      if (jobRecord.command === CrawlCommand.GROUP_PROJECT_DISCOVERY) {
        logger.debug(`Updating progress specifically for GROUP_PROJECT_DISCOVERY job ${jobRecord.id}. Current progress:`, { currentJobProgress: jobRecord.progress });
        const currentJobProgress = jobRecord.progress as Record<string, any> || {};
        const newProgress = {
          ...currentJobProgress,
          groupCount: (currentJobProgress.groupCount || 0) + groupsCount,
          projectCount: (currentJobProgress.projectCount || 0) + projectsCount,
          // Potentially update groupTotal and projectTotal if known
        };
        await db.update(jobSchema)
          .set({
            progress: newProgress,
            updated_at: new Date() // Ensure updated_at is also set here
          })
          .where(eq(jobSchema.id, jobRecord.id)); // Update the specific job
        logger.info(`Updated progress for GROUP_PROJECT_DISCOVERY job ${jobRecord.id} with ${groupsCount} groups, ${projectsCount} projects. New progress:`, { newProgress });
      }
      
      return json(
        {
          status: 'received',
          message: `Areas discovery processed for task ${taskId}: ${groupsCount} groups, ${projectsCount} projects`
        },
        { status: 200 }
      );
    }

    // Handle credential status updates
    if (crawlerStatus.toLowerCase() === 'credential_expiry' || 
        crawlerStatus.toLowerCase() === 'credential_renewal' || 
        crawlerStatus.toLowerCase() === 'credential_resumed') {
      
      logger.warn(`[CREDENTIAL STATUS] Received ${crawlerStatus} for job ${taskId}`, { credentialStatus, message });
      
      const updateData: Partial<Job> & { updated_at?: Date } = { 
        updated_at: new Date(),
      };

      // Set appropriate job status based on credential status
      switch (crawlerStatus.toLowerCase()) {
        case 'credential_expiry':
          updateData.status = JobStatus.credential_expired;
          logger.error(`[HIGH SEVERITY] Credential expiry detected for job ${taskId}. Administrative action required.`);
          break;
        case 'credential_renewal':
          updateData.status = JobStatus.waiting_credential_renewal;
          logger.warn(`[MEDIUM SEVERITY] Job ${taskId} waiting for credential renewal.`);
          break;
        case 'credential_resumed':
          updateData.status = JobStatus.credential_renewed;
          logger.info(`[LOW SEVERITY] Job ${taskId} credentials renewed, ready to resume.`);
          break;
      }

      // Update job.progress blob with credential status information
      const currentProgress = jobRecord.progress as Record<string, any> || {};
      const jobProgress = {
        ...currentProgress,
        processed: processedItems || currentProgress.processed,
        total: totalItems || currentProgress.total,
        currentDataType: currentDataType || currentProgress.currentDataType,
        credentialStatus: {
          ...credentialStatus,
          timestamp,
          lastUpdate: crawlerStatus
        },
        message: message || `Credential status: ${crawlerStatus}`
      };
      updateData.progress = jobProgress;

      await db.update(jobSchema).set(updateData).where(eq(jobSchema.id, taskId));
      logger.info(`Job ${taskId} updated with credential status: ${crawlerStatus}`);

      // Return appropriate response
      return json(
        {
          status: 'received',
          message: `Credential status update processed for task ${taskId}: ${crawlerStatus}`,
          credentialGuidance: credentialStatus?.adminGuidance || []
        },
        { status: 200 }
      );
    }

    // Handle other standard statuses as before
    const updateData: Partial<Job> & { updated_at?: Date } = { updated_at: new Date() };
    let newJobStatus: JobStatus | null = null;

    switch (crawlerStatus.toLowerCase()) {
      case 'started':
        console.log(`🟡 PROGRESS: Job ${taskId} transitioning from ${jobRecord.status} to RUNNING (started)`);
        newJobStatus = JobStatus.running;
        if (jobRecord.status !== JobStatus.running) {
            updateData.started_at = new Date(timestamp);
        }
        break;
      case 'processing':
        console.log(`🟡 PROGRESS: Job ${taskId} transitioning from ${jobRecord.status} to RUNNING (processing)`);
        newJobStatus = JobStatus.running;
        // No specific action if already running, updated_at will be set.
        // If it wasn't running, set started_at
        if (jobRecord.status !== JobStatus.running && !jobRecord.started_at) {
            updateData.started_at = new Date(timestamp);
        }
        break;
      case 'completed':
        console.log(`🟢 PROGRESS: Job ${taskId} transitioning from ${jobRecord.status} to FINISHED`);
        newJobStatus = JobStatus.finished;
        updateData.finished_at = new Date(timestamp);
        updateData.resumeState = null; // Clear resume state on completion
        break;
      case 'failed':
        console.log(`🔴 PROGRESS: Job ${taskId} transitioning from ${jobRecord.status} to FAILED`);
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
        console.log(`🟠 PROGRESS: Job ${taskId} transitioning from ${jobRecord.status} to PAUSED`);
        newJobStatus = JobStatus.paused;
        if (resumePayload) {
          updateData.resumeState = resumePayload;
        }
        break;
      default:
        logger.warn(`❌ PROGRESS: Unknown status received from crawler: ${crawlerStatus} for taskId: ${taskId}`);
        console.log(`❌ PROGRESS: Invalid status "${crawlerStatus}" for job ${taskId}`);
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
    logger.debug(`Update data for standard status update for job ${taskId}:`, { updateData, crawlerStatus });

    await db.update(jobSchema).set(updateData).where(eq(jobSchema.id, taskId));
    console.log(`✅ PROGRESS: Job ${taskId} database updated to status: ${updateData.status || jobRecord.status}. Crawler status was: ${crawlerStatus}`);
    logger.info(`Job ${taskId} updated to status: ${updateData.status || jobRecord.status}. Crawler status was: ${crawlerStatus}`);

    // If a GROUP_PROJECT_DISCOVERY job finishes, its status is already set to 'finished'.
    // No separate 'isComplete' flag to manage on the job itself.
    // The progress and resumeState fields on the job record hold the relevant completion/state info.
    if (newJobStatus === JobStatus.finished && jobRecord.command === CrawlCommand.GROUP_PROJECT_DISCOVERY) {
      logger.info(`GROUP_PROJECT_DISCOVERY job ${jobRecord.id} for account ${jobRecord.accountId} marked as finished.`);
      // Any finalization of progress (e.g. setting total counts if now known) should happen here or in the processor.
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