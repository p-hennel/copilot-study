// src/crawler/jobManager.ts
import type {
  CrawlerCommand,
  Job,
  CrawlerState,
  CrawlerStatus,
  StartJobCommand,
  JobDataTypeProgress, // Keep this type for in-memory progress tracking
} from './types';
import { Storage } from './storage';
import { GitlabClient } from './gitlab/client';

// IPC communication functions - will be set during initialization
let sendStatusUpdate: (status: CrawlerStatus) => void = () => {};
let sendHeartbeat: () => void = () => {};
// NEW: Function to send detailed job completion/failure updates
let sendJobCompletionUpdate: (update: JobCompletionUpdate) => void = () => {};


// NEW: Type for detailed job status updates (completion, failure, pause) via IPC
export interface JobCompletionUpdate {
    type: 'jobUpdate'; // More general type identifier
    jobId: string;
    status: 'completed' | 'failed' | 'paused'; // Allowed final/intermediate states
    error?: string; // Include error message on failure
    progress?: Record<string, JobDataTypeProgress>; // Send current/final progress state
    timestamp: number; // Timestamp of the update
}


export class JobManager {
  private storage: Storage;
  private jobQueue: Job[] = [];
  private activeJob: Job | null = null;
  private state: CrawlerState = 'idle';
  private heartbeatInterval: Timer | null = null;

  constructor(storage: Storage) {
    this.storage = storage;
    console.log('JobManager initialized.');
    this.startHeartbeat();
  }

  // Method to be called by crawler.ts to inject IPC functions
  setIPCFunctions(
      statusUpdater: (status: CrawlerStatus) => void,
      heartbeater: () => void,
      jobUpdater: (update: JobCompletionUpdate) => void // Renamed parameter for clarity
  ) {
    sendStatusUpdate = statusUpdater;
    sendHeartbeat = heartbeater;
    sendJobCompletionUpdate = jobUpdater; // Assign to the correct variable
    // Removed duplicate/incorrect assignment below
    this.sendStatus(); // Send initial status
  }

  private startHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = setInterval(() => {
      sendHeartbeat();
      this.sendStatus(); // Continue sending general status
    }, 30000);
    console.log('Heartbeat started.');
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      console.log('Heartbeat stopped.');
    }
  }

  private setState(newState: CrawlerState) {
    if (this.state !== newState) {
      this.state = newState;
      console.log(`Crawler state changed to: ${newState}`);
      this.sendStatus();
    }
  }

  // Sends general crawler status (state, current job ID, queue size)
  private sendStatus() {
    const status: CrawlerStatus = {
      state: this.state,
      currentJobId: this.activeJob?.id ?? null,
      queueSize: this.jobQueue.length,
      lastHeartbeat: Date.now(),
      // Remove direct error reporting here, send via JobCompletionUpdate
      // error: this.activeJob?.error,
    };
    if (typeof sendStatusUpdate === 'function') {
        sendStatusUpdate(status);
    }
  }

  // Sends detailed update when a job finishes (completed or failed)
  private sendCompletionUpdate(job: Job) {
      // Ensure status is either completed or failed before sending
      if (job.status !== 'completed' && job.status !== 'failed') {
          console.warn(`sendCompletionUpdate called for job ${job.id} with unexpected status: ${job.status}`);
          return;
      }
      if (typeof sendJobCompletionUpdate === 'function') {
          const update: JobCompletionUpdate = {
              type: 'jobUpdate', // Use the updated type identifier
              jobId: job.id,
              status: job.status, // Directly use the job's status
              error: job.error,
              progress: job.progress, // Use the 'progress' field name
              timestamp: Date.now() // Use the 'timestamp' field name
          };
          sendJobCompletionUpdate(update);
          console.log(`Sent ${job.status} update for job ${job.id} via IPC.`);
      }
  }


  handleCommand(command: CrawlerCommand) {
    console.log(`JobManager handling command: ${command.type}`);
    switch (command.type) {
      case 'START_JOB':
        // Progress should ideally be passed in the command if resuming
        this.addJob(command);
        break;
      case 'PAUSE_CRAWLER':
        this.pause();
        break;
      case 'RESUME_CRAWLER':
        this.resume();
        break;
      case 'GET_STATUS':
        this.sendStatus();
        break;
      case 'SHUTDOWN':
        this.shutdown();
        break;
      default:
        console.warn(`Received unknown command type: ${(command as any).type}`);
    }
  }

  // Add job to queue. Assumes fresh start unless progress is part of Job type definition
  // and passed in jobCommand (which it currently isn't explicitly defined for IPC)
  private addJob(jobCommand: StartJobCommand) {
    if (
        this.activeJob?.id === jobCommand.jobId ||
        this.jobQueue.some(job => job.id === jobCommand.jobId)
    ) {
        console.warn(`Job with ID ${jobCommand.jobId} already exists or is active. Ignoring.`);
        return;
    }

    // Create the job object for internal use
    // Initialize progress as empty. The backend should send existing progress
    // if resuming is intended, requiring modification to StartJobCommand type.
    const newJob: Job = {
      id: jobCommand.jobId,
      targetPath: jobCommand.targetPath,
      gitlabApiUrl: jobCommand.gitlabApiUrl,
      gitlabToken: jobCommand.gitlabToken,
      dataTypes: jobCommand.dataTypes,
      status: 'pending',
      progress: {}, // Start with empty progress
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.jobQueue.push(newJob);
    console.log(`Added job ${newJob.id} for path '${newJob.targetPath}' to queue.`);
    this.sendStatus();
    this.tryStartNextJob();
  }

  private pause() {
    if (this.state === 'running') {
      this.setState('paused');
      if (this.activeJob) {
        console.log(`Pause requested for active job: ${this.activeJob.id}. Will pause before next API call.`);
        // Actual pause happens in executeJob loop check
        // We should send an IPC message indicating the pause and current progress
        this.sendPausedUpdate(this.activeJob); // Send update when pause is requested
      }
      this.stopHeartbeat();
    } else {
        console.log(`Cannot pause, crawler is not running. State: ${this.state}`);
    }
  }

  // NEW: Send update when job is paused
  private sendPausedUpdate(job: Job) {
      if (typeof sendJobCompletionUpdate === 'function') {
          const update: JobCompletionUpdate = {
              type: 'jobUpdate', // Use the updated type identifier
              jobId: job.id,
              status: 'paused', // Explicitly paused status
              error: job.error, // Include error if relevant during pause? Optional.
              progress: job.progress, // Use 'progress' field name
              timestamp: Date.now() // Use 'timestamp' field name
          };
          sendJobCompletionUpdate(update);
          console.log(`Sent paused update for job ${job.id} via IPC.`);
      }
  }


  private resume() {
    if (this.state === 'paused') {
      console.log('Resuming crawler...');
      this.setState('idle'); // Go to idle, tryStartNextJob will pick up
      this.startHeartbeat();
      this.tryStartNextJob(); // Will attempt to resume the paused job
    } else {
        console.log(`Cannot resume, crawler is not paused. State: ${this.state}`);
    }
  }

  // Made async to potentially await sending final update
  private async shutdown() {
    console.log('Shutdown command received. Stopping crawler...');
    this.stopHeartbeat();
    this.jobQueue = []; // Clear queue

    if (this.activeJob) {
        console.log(`Attempting to stop active job: ${this.activeJob.id}`);
        // Mark as paused to signal executeJob to stop gracefully
        this.activeJob.status = 'paused';
        // Send final paused update for the active job on shutdown
        this.sendPausedUpdate(this.activeJob);
    }
    this.activeJob = null; // Clear active job reference
    this.setState('idle'); // Final state after shutdown attempt
    console.log('Crawler shut down.');
    // process.exit(0); // Optional: Exit process
  }

  private async tryStartNextJob() {
    if (this.state !== 'idle' && this.state !== 'paused') {
        console.log(`Cannot start next job, crawler is busy or paused. State: ${this.state}`);
        return;
    }

    if (this.jobQueue.length === 0 && !this.activeJob) {
        console.log('Job queue is empty and no active job. Crawler remains idle.');
        this.setState('idle');
        return;
    }

    // --- Resume Logic ---
    if (this.state === 'paused') {
        if (this.activeJob && this.activeJob.status === 'paused') {
            console.log(`Resuming paused job: ${this.activeJob.id}`);
            this.activeJob.status = 'running'; // Mark as running again locally
            // Send IPC message indicating resume? Optional.
            this.setState('running');
            let gitlabClient: GitlabClient | null = null;
            const jobId = this.activeJob.id; // Store ID

            try {
                gitlabClient = new GitlabClient(this.activeJob.gitlabApiUrl, this.activeJob.gitlabToken);
                await this.executeJob(this.activeJob, gitlabClient);

                // Check status after executeJob returns (it might have been paused again or failed)
                if (this.activeJob && this.activeJob.id === jobId) { // Ensure it's still the same job
                    if (this.activeJob.status === 'running') { // Finished naturally
                        this.activeJob.status = 'completed';
                        console.log(`Resumed job ${jobId} completed successfully.`);
                        this.sendCompletionUpdate(this.activeJob); // Send final completed update
                    } else if (this.activeJob.status === 'failed') {
                        console.error(`Resumed job ${jobId} failed during execution.`);
                        this.sendCompletionUpdate(this.activeJob); // Send final failed update
                    } else if (this.activeJob.status === 'paused') {
                        console.log(`Resumed job ${jobId} was paused again.`);
                        // Pause update already sent from within executeJob or pause()
                    }
                }
            } catch (error) { // Catch errors not handled within executeJob (e.g., client init)
                if (this.activeJob && this.activeJob.id === jobId) {
                    this.activeJob.status = 'failed';
                    this.activeJob.error = error instanceof Error ? error.message : String(error);
                    console.error(`Resumed job ${jobId} failed critically:`, error);
                    this.sendCompletionUpdate(this.activeJob); // Send final failed update
                }
            } finally {
                 // Clear active job only if it truly finished (completed/failed)
                 if (this.activeJob && this.activeJob.id === jobId && this.activeJob.status !== 'paused') {
                     this.activeJob = null;
                 }
                 this.setState('idle');
                 console.log(`Finished processing resumed job attempt for ${jobId}.`);
                 this.tryStartNextJob(); // Check queue
            }
        } else {
            console.warn("Crawler paused but no active paused job found. Resetting to idle.");
            this.setState('idle');
            this.tryStartNextJob();
        }
        return; // Handled resume attempt
    }

    // --- Start New Job Logic ---
    if (this.state === 'idle' && this.jobQueue.length > 0) {
      this.activeJob = this.jobQueue.shift()!;
      this.activeJob.status = 'running'; // Set local status
      this.activeJob.updatedAt = new Date();
      this.activeJob.error = undefined;
      // Send IPC message indicating job start? Optional.
      this.setState('running');
      console.log(`Starting job ${this.activeJob.id} for path '${this.activeJob.targetPath}'...`);
      let gitlabClient: GitlabClient | null = null;
      const jobId = this.activeJob.id; // Store ID

      try {
        gitlabClient = new GitlabClient(this.activeJob.gitlabApiUrl, this.activeJob.gitlabToken);
        await this.executeJob(this.activeJob, gitlabClient);

        // Check status after executeJob returns
        if (this.activeJob && this.activeJob.id === jobId) { // Ensure it's still the same job
            if (this.activeJob.status === 'running') { // Finished naturally
                this.activeJob.status = 'completed';
                console.log(`Job ${jobId} completed successfully.`);
                this.sendCompletionUpdate(this.activeJob); // Send final completed update
            } else if (this.activeJob.status === 'failed') {
                console.error(`Job ${jobId} failed during execution.`);
                this.sendCompletionUpdate(this.activeJob); // Send final failed update
            } else if (this.activeJob.status === 'paused') {
                console.log(`Job ${jobId} was paused.`);
                // Pause update already sent from within executeJob or pause()
            }
        }

      } catch (error) { // Catch errors not handled within executeJob (e.g., client init)
        if (this.activeJob && this.activeJob.id === jobId) {
          this.activeJob.status = 'failed';
          this.activeJob.error = error instanceof Error ? error.message : String(error);
          console.error(`Job ${jobId} failed critically:`, error);
          this.sendCompletionUpdate(this.activeJob); // Send final failed update
        }
      } finally {
        // Clear active job only if it truly finished (completed/failed)
        if (this.activeJob && this.activeJob.id === jobId && this.activeJob.status !== 'paused') {
            this.activeJob = null;
        }
        this.setState('idle'); // Go back to idle
        console.log(`Finished processing job attempt for ${jobId}.`);
        this.tryStartNextJob(); // Check queue
      }
    }
  }

  /**
   * Executes the actual data fetching for a job. Sends progress updates via IPC.
   * Handles pagination and pausing.
   * @param job The job to execute.
   * @param client The GitlabClient instance to use.
   */
  private async executeJob(job: Job, client: GitlabClient): Promise<void> {
    console.log(`Executing job ${job.id}: Fetching ${job.dataTypes.join(', ')} for ${job.targetPath}`);

    for (const dataType of job.dataTypes) {
      // Check if job is still running before starting/continuing a data type
      if (job.status !== 'running') {
          console.log(`Job ${job.id} status is ${job.status}, stopping execution for ${dataType}.`);
          break; // Stop processing data types for this job
      }

      console.log(`  - Starting fetch for ${dataType}...`);
      let hasNextPage = true;
      job.progress[dataType] = job.progress[dataType] || {}; // Ensure progress object exists
      let currentProgress = job.progress[dataType];
      let afterCursor: string | undefined = currentProgress.afterCursor;

      if (afterCursor) {
        console.log(`  - Resuming ${dataType} from cursor: ${afterCursor}`);
      }

      while (hasNextPage) {
        // Check for pause *before* each API call
        if (this.state === 'paused') { // Check global state first
          console.log(`Job ${job.id} paused (global state) during pagination of ${dataType}. Saving progress.`);
          job.status = 'paused'; // Set local job status
          currentProgress.afterCursor = afterCursor; // Save cursor
          job.updatedAt = new Date();
          // Send paused update via IPC - handled by the pause() method initiator
          // No need to send duplicate update here, just return
          return; // Exit executeJob
        }

        try {
          const pageInfo = afterCursor ? { after: afterCursor } : undefined;
          const result = await client.fetchData(dataType, job.targetPath, pageInfo);

          if (result.data.length > 0) {
            await this.storage.storeRecords(dataType, job.targetPath, result.data);
            console.log(`  - Stored ${result.data.length} records for ${dataType}.`);
          } else {
            console.log(`  - No new records found for ${dataType} on this page.`);
          }

          hasNextPage = result.pageInfo.hasNextPage;
          // Handle potential null value for endCursor from GraphQL PageInfo type
          afterCursor = result.pageInfo.endCursor ?? undefined;

          // Update progress state in memory
          currentProgress.afterCursor = afterCursor; // Assigns string | undefined
          currentProgress.lastAttempt = Date.now();
          job.updatedAt = new Date();
          // Send incremental progress update via IPC? Optional, could be chatty.
          // For now, only send final/paused updates.
          // this.sendStatus(); // General status update is sufficient per page?

        } catch (error) {
          console.error(`  - Error fetching page for ${dataType}:`, error);
          job.error = `Failed fetching ${dataType}: ${error instanceof Error ? error.message : String(error)}`;
          currentProgress.errorCount = (currentProgress.errorCount || 0) + 1;
          currentProgress.lastAttempt = Date.now();
          hasNextPage = false; // Stop pagination for this type
          job.status = 'failed'; // Mark job as failed
          // Send failure update via IPC - handled in the calling try/catch block
          return; // Exit executeJob as it failed
        }

        // Optional delay
        if (hasNextPage) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      } // End while(hasNextPage)

      // If pagination completed successfully for this type
      if (job.status === 'running') {
        console.log(`  - Finished fetching all pages for ${dataType}.`);
        delete currentProgress.afterCursor; // Clear cursor on success
        job.updatedAt = new Date();
        // Send progress update via IPC now that a type is fully done? Optional.
        // this.sendProgressUpdate(job); // Example
      }
    } // End for(dataType)

    // If the loop finishes and the job wasn't paused or failed mid-way
    console.log(`Finished processing all data types for job ${job.id}. Final status: ${job.status}`);
    // Final status (completed/failed/paused) is set and sent via IPC by the calling function (tryStartNextJob)
  }

  // Public method to start processing loop if idle
  startProcessing() {
    if (this.state === 'idle') {
      console.log('Starting job processing...');
      this.tryStartNextJob();
    }
  }
}