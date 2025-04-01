// src/crawler/jobManager.ts
import type {
  CrawlerCommand,
  Job,
  CrawlerState,
  CrawlerStatus,
  StartJobCommand,
  JobDataTypeProgress // Keep this type for in-memory progress tracking
} from "./types"
import type { SendMessageArgs } from "./ipc" // Import the type for the generic sender
import { Storage } from "./storage"
import { GitlabClient } from "./gitlab/client"
import type { ProjectSchema, GroupSchema } from "@gitbeaker/rest"
import { getLogger } from "../lib/logging" // Import logtape helper
import type { Logger } from "@logtape/logtape"

const logger = getLogger(["crawler", "jobManager"]) // Logger for this module

// Placeholder function to generate a unique job ID
// In a real system, this might involve checking the DB or using UUIDs
function generateJobId(targetPath: string, dataTypes: string[]): string {
  // Simple example: combine path and sorted types
  return `${targetPath}::${dataTypes.sort().join(",")}`
}

// IPC communication functions - will be set during initialization
// These are now primarily for status/heartbeat, job updates use the generic sender
let sendStatusUpdate: (logger: Logger, status: CrawlerStatus) => void = () => {}
let sendHeartbeat: () => void = () => {}
// Removed module-level sendJobCompletionUpdate, will use class member sendMessage

// Type for detailed job status updates (completion, failure, pause) via IPC
// Renamed back from JobCompletionUpdatePayload
export interface JobCompletionUpdate {
  type: "jobUpdate" // More general type identifier
  jobId: string
  status: "completed" | "failed" | "paused" // Allowed final/intermediate states
  error?: string // Include error message on failure
  progress?: Record<string, JobDataTypeProgress> // Send current/final progress state
  timestamp: number // Timestamp of the update
}

export class JobManager {
  private storage: Storage
  private jobQueue: Job[] = []
  private activeJob: Job | null = null
  private state: CrawlerState = "idle"
  private heartbeatInterval: Timer | null = null
  private logger: Logger
  // Add class member to hold the generic sendMessage function from IPC
  private sendMessage: (logger: Logger, args: SendMessageArgs) => void = () => {}

  constructor(logger: Logger, storage: Storage) {
    this.logger = logger
    this.storage = storage
    logger.info("JobManager initialized.") // Use logger
    this.startHeartbeat()
  }

  // Method to be called by crawler.ts to inject IPC functions
  setIPCFunctions(
    statusUpdater: (logger: Logger, status: CrawlerStatus) => void,
    heartbeater: () => void,
    // Accept the generic sendMessage function
    messageSender: (logger: Logger, args: SendMessageArgs) => void
  ) {
    sendStatusUpdate = statusUpdater
    sendHeartbeat = heartbeater
    // Assign the generic sender to the class member
    this.sendMessage = messageSender
    // Removed assignment to old module-level variable
    this.sendStatus() // Send initial status
  }

  private startHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval)
    this.heartbeatInterval = setInterval(() => {
      sendHeartbeat()
      this.sendStatus() // Continue sending general status
    }, 30000)
    logger.info("Heartbeat started.") // Use logger
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
      logger.info("Heartbeat stopped.") // Already updated
    }
  }

  private setState(newState: CrawlerState) {
    if (this.state !== newState) {
      this.state = newState
      logger.info(`Crawler state changed to: ${newState}`) // Already updated
      this.sendStatus()
    }
  }

  // Sends general crawler status (state, current job ID, queue size)
  private sendStatus() {
    const status: CrawlerStatus = {
      state: this.state,
      currentJobId: this.activeJob?.id ?? null,
      queueSize: this.jobQueue.length,
      lastHeartbeat: Date.now()
      // Remove direct error reporting here, send via JobCompletionUpdate
      // error: this.activeJob?.error,
    }
    if (typeof sendStatusUpdate === "function") {
      sendStatusUpdate(this.logger, status)
    }
  }

  // Sends detailed update when a job finishes (completed or failed)
  private sendCompletionUpdate(job: Job) {
    // Ensure status is either completed or failed before sending
    if (job.status !== "completed" && job.status !== "failed") {
      logger.warn(`sendCompletionUpdate called for job ${job.id} with unexpected status: ${job.status}`) // Already updated
      return
    }
    // Use the class member sendMessage
    if (typeof this.sendMessage === "function") {
      const payload: JobCompletionUpdate = {
        // Define the payload structure
        type: "jobUpdate",
        jobId: job.id,
        status: job.status,
        error: job.error,
        progress: job.progress,
        timestamp: Date.now()
      }
      // Call the generic sender with appropriate args
      this.sendMessage(this.logger, {
        target: "supervisor", // Job updates typically go to supervisor
        type: "jobUpdate",
        payload: payload
      })
      logger.info(`Sent ${job.status} update for job ${job.id} via IPC.`) // Already updated
    }
  }

  handleCommand(command: CrawlerCommand) {
    logger.info(`Handling command: ${command.type}`) // Already updated
    switch (command.type) {
      case "START_JOB":
        // Progress should ideally be passed in the command if resuming
        this.addJob(command)
        break
      case "PAUSE_CRAWLER":
        this.pause()
        break
      case "RESUME_CRAWLER":
        this.resume()
        break
      case "GET_STATUS":
        this.sendStatus()
        break
      case "SHUTDOWN":
        this.shutdown()
        break
      default: {
        // Added braces to allow lexical declaration
        const unknownCommand = command as unknown as { type?: string }
        logger.warn(`Received unknown command type: ${unknownCommand.type ?? "unknown"}`) // Already updated
        break // Ensure break is inside the block
      }
    } // End of switch
  } // End of handleCommand method

  // Add job to queue. Assumes fresh start unless progress is part of Job type definition
  // and passed in jobCommand (which it currently isn't explicitly defined for IPC)
  private addJob(jobCommand: StartJobCommand) {
    if (Object.keys(jobCommand).includes("payload")) jobCommand = (jobCommand as any).payload as StartJobCommand // Extract payload if wrapped
    if (
      !!this.activeJob &&
      (this.activeJob?.id === jobCommand.jobId || this.jobQueue.some((job) => job.id === jobCommand.jobId))
    ) {
      logger.warn(`Job with ID ${jobCommand.jobId} already exists or is active. Ignoring.`) // Use logger
      return
    }

    // Create the job object for internal use
    // Use progress from the command if provided (for resuming)
    const newJob: Job = {
      id: jobCommand.jobId,
      targetPath: jobCommand.targetPath,
      gitlabApiUrl: jobCommand.gitlabApiUrl,
      gitlabToken: jobCommand.gitlabToken,
      dataTypes: jobCommand.dataTypes,
      status: "pending",
      progress: jobCommand.progress ?? {}, // Use incoming progress or default to empty
      createdAt: new Date(),
      updatedAt: new Date()
    }
    this.jobQueue.push(newJob)
    logger.info(`Added job ${newJob.id} for path '${newJob.targetPath}' to queue.`) // Use logger
    this.sendStatus()
    this.tryStartNextJob()
  }

  private pause() {
    if (this.state === "running") {
      this.setState("paused")
      if (this.activeJob) {
        logger.info(`Pause requested for active job: ${this.activeJob.id}. Will pause before next API call.`) // Use logger
        // Actual pause happens in executeJob loop check
        // We should send an IPC message indicating the pause and current progress
        this.sendPausedUpdate(this.activeJob) // Send update when pause is requested
      }
      this.stopHeartbeat()
    } else {
      logger.info(`Cannot pause, crawler is not running. State: ${this.state}`) // Use logger
    }
  }

  // NEW: Send update when job is paused
  private sendPausedUpdate(job: Job) {
    // Use the class member sendMessage
    if (typeof this.sendMessage === "function") {
      const payload: JobCompletionUpdate = {
        // Define the payload structure
        type: "jobUpdate",
        jobId: job.id,
        status: "paused",
        error: job.error,
        progress: job.progress,
        timestamp: Date.now()
      }
      // Call the generic sender with appropriate args
      this.sendMessage(this.logger, {
        target: "supervisor", // Job updates typically go to supervisor
        type: "jobUpdate",
        payload: payload
      })
      logger.info(`Sent paused update for job ${job.id} via IPC.`) // Use logger
    }
  }

  private resume() {
    if (this.state === "paused") {
      logger.info("Resuming crawler...") // Use logger
      this.setState("idle") // Go to idle, tryStartNextJob will pick up
      this.startHeartbeat()
      this.tryStartNextJob() // Will attempt to resume the paused job
    } else {
      logger.info(`Cannot resume, crawler is not paused. State: ${this.state}`) // Use logger
    }
  }

  // Made public to be callable from crawler.ts on supervisor shutdown signal
  public async shutdown() {
    logger.info("Shutdown command received. Stopping crawler...") // Use logger
    this.stopHeartbeat()
    this.jobQueue = [] // Clear queue

    if (this.activeJob) {
      logger.info(`Attempting to stop active job: ${this.activeJob.id}`) // Use logger
      // Mark as paused to signal executeJob to stop gracefully
      this.activeJob.status = "paused"
      // Send final paused update for the active job on shutdown
      this.sendPausedUpdate(this.activeJob)
    }
    this.activeJob = null // Clear active job reference
    this.setState("idle") // Final state after shutdown attempt
    logger.info("Crawler shut down.") // Use logger
    // process.exit(0); // Optional: Exit process
  }

  private async tryStartNextJob() {
    if (this.state !== "idle" && this.state !== "paused") {
      logger.info(`Cannot start next job, crawler is busy or paused. State: ${this.state}`) // Use logger
      return
    }

    if (this.jobQueue.length === 0 && !this.activeJob) {
      logger.info("Job queue is empty and no active job. Crawler remains idle.") // Use logger
      this.setState("idle")
      return
    }

    // --- Resume Logic ---
    if (this.state === "paused") {
      if (this.activeJob && this.activeJob.status === "paused") {
        logger.info(`Resuming paused job: ${this.activeJob.id}`) // Use logger
        this.activeJob.status = "running" // Mark as running again locally
        // Send IPC message indicating resume? Optional.
        this.setState("running")
        let gitlabClient: GitlabClient | null = null
        const jobId = this.activeJob.id // Store ID

        try {
          gitlabClient = new GitlabClient(
            this.logger.getChild("GitLab Client"),
            this.activeJob.gitlabApiUrl,
            this.activeJob.gitlabToken
          )
          await this.executeJob(this.activeJob, gitlabClient)

          // Check status after executeJob returns (it might have been paused again or failed)
          if (this.activeJob && this.activeJob.id === jobId) {
            // Ensure it's still the same job
            if (this.activeJob.status === "running") {
              // Finished naturally
              this.activeJob.status = "completed"
              logger.info(`Resumed job ${jobId} completed successfully.`) // Use logger
              this.sendCompletionUpdate(this.activeJob) // Send final completed update
            } else if (this.activeJob.status === "failed") {
              logger.error(`Resumed job ${jobId} failed during execution.`) // Use logger
              this.sendCompletionUpdate(this.activeJob) // Send final failed update
            } else if (this.activeJob.status === "paused") {
              logger.info(`Resumed job ${jobId} was paused again.`) // Use logger
              // Pause update already sent from within executeJob or pause()
            }
          }
        } catch (error) {
          // Catch errors not handled within executeJob (e.g., client init)
          if (this.activeJob && this.activeJob.id === jobId) {
            this.activeJob.status = "failed"
            this.activeJob.error = error instanceof Error ? error.message : String(error)
            logger.error(`Resumed job ${jobId} failed critically:`, { error }) // Use logger
            this.sendCompletionUpdate(this.activeJob) // Send final failed update
          }
        } finally {
          // Clear active job only if it truly finished (completed or failed)
          if (
            this.activeJob &&
            this.activeJob.id === jobId &&
            (this.activeJob.status === "completed" || this.activeJob.status === "failed")
          ) {
            this.activeJob = null
          }
          this.setState("idle")
          logger.info(`Finished processing resumed job attempt for ${jobId}.`) // Use logger
          this.tryStartNextJob() // Check queue
        }
      } else {
        logger.warn("Crawler paused but no active paused job found. Resetting to idle.") // Use logger
        this.setState("idle")
        this.tryStartNextJob()
      }
      return // Handled resume attempt
    }

    // --- Start New Job Logic ---
    if (this.state === "idle" && this.jobQueue.length > 0) {
      this.activeJob = this.jobQueue.shift()!
      this.activeJob.status = "running" // Set local status
      this.activeJob.updatedAt = new Date()
      this.activeJob.error = undefined
      // Send IPC message indicating job start? Optional.
      this.setState("running")
      logger.info(`Starting job ${this.activeJob.id} for path '${this.activeJob.targetPath}'...`) // Use logger
      let gitlabClient: GitlabClient | null = null
      const jobId = this.activeJob.id // Store ID

      try {
        gitlabClient = new GitlabClient(
          this.logger.getChild("GitLab Client"),
          this.activeJob.gitlabApiUrl,
          this.activeJob.gitlabToken
        )
        await this.executeJob(this.activeJob, gitlabClient)

        // Check status after executeJob returns
        if (this.activeJob && this.activeJob.id === jobId) {
          // Ensure it's still the same job
          if (this.activeJob.status === "running") {
            // Finished naturally
            this.activeJob.status = "completed"
            logger.info(`Job ${jobId} completed successfully.`) // Use logger
            this.sendCompletionUpdate(this.activeJob) // Send final completed update
          } else if (this.activeJob.status === "failed") {
            logger.error(`Job ${jobId} failed during execution.`) // Use logger
            this.sendCompletionUpdate(this.activeJob) // Send final failed update
          } else if (this.activeJob.status === "paused") {
            logger.info(`Job ${jobId} was paused.`) // Use logger
            // Pause update already sent from within executeJob or pause()
          }
        }
      } catch (error) {
        // Catch errors not handled within executeJob (e.g., client init)
        if (this.activeJob && this.activeJob.id === jobId) {
          this.activeJob.status = "failed"
          this.activeJob.error = error instanceof Error ? error.message : String(error)
          logger.error(`Job ${jobId} failed critically:`, { error }) // Use logger
          this.sendCompletionUpdate(this.activeJob) // Send final failed update
        }
      } finally {
        // Clear active job only if it truly finished (completed or failed)
        if (
          this.activeJob &&
          this.activeJob.id === jobId &&
          (this.activeJob.status === "completed" || this.activeJob.status === "failed")
        ) {
          this.activeJob = null
        }
        this.setState("idle") // Go back to idle
        logger.info(`Finished processing job attempt for ${jobId}.`) // Use logger
        this.tryStartNextJob() // Check queue
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
    logger.info(`Executing job ${job.id}: Fetching ${job.dataTypes.join(", ")} for ${job.targetPath}`) // Use logger

    for (const dataType of job.dataTypes) {
      // Check if job is still running before starting/continuing a data type
      if (job.status !== "running") {
        logger.info(`Job ${job.id} status is ${job.status}, stopping execution for ${dataType}.`) // Use logger
        break // Stop processing data types for this job
      }

      logger.info(`  - Starting fetch for ${dataType}...`) // Use logger
      let hasNextPage = true
      job.progress[dataType] = job.progress[dataType] || {} // Ensure progress object exists
      const currentProgress = job.progress[dataType]
      let afterCursor: string | undefined = currentProgress.afterCursor

      if (afterCursor) {
        logger.info(`  - Resuming ${dataType} from cursor: ${afterCursor}`) // Use logger
      }

      while (hasNextPage) {
        // Check for pause *before* each API call
        if (this.state === "paused") {
          // Check global state first
          logger.info(`Job ${job.id} paused (global state) during pagination of ${dataType}. Saving progress.`) // Use logger
          job.status = "paused" // Set local job status
          currentProgress.afterCursor = afterCursor // Save cursor
          job.updatedAt = new Date()
          // Send paused update via IPC - handled by the pause() method initiator
          // No need to send duplicate update here, just return
          return // Exit executeJob
        }

        try {
          const pageInfo = afterCursor ? { after: afterCursor } : undefined
          const result = await client.fetchData(dataType, job.targetPath, pageInfo)

          if (result.data.length > 0) {
            await this.storage.storeRecords(dataType, job.targetPath, result.data)
            logger.debug(`  - Stored ${result.data.length} records for ${dataType}.`) // Use debug for potentially noisy logs

            // --- NEW: Job Discovery and Spawning Logic ---
            try {
              // Check if the current job is for discovering projects or subgroups
              if (dataType === "groupProjects") {
                // Attempt to use ProjectSchema type, handle potential Camelize wrapper if necessary
                for (const project of result.data as ProjectSchema[]) {
                  // Use path_with_namespace for projects
                  const discoveredPath = project?.path_with_namespace
                  if (discoveredPath) {
                    logger.info(`  - Discovered project: ${discoveredPath}. Spawning jobs...`) // Use logger
                    const projectDataTypes = [
                      "memberships",
                      "issues",
                      "commits",
                      "mergeRequests",
                      "labels",
                      "milestones",
                      "releases",
                      "pipelines",
                      "vulnerabilities",
                      "branches",
                      "timelogs" // Updated list
                    ]
                    const newJobId = generateJobId(discoveredPath, projectDataTypes)
                    this.addJob({
                      type: "START_JOB",
                      jobId: newJobId,
                      targetPath: discoveredPath,
                      gitlabApiUrl: job.gitlabApiUrl,
                      gitlabToken: job.gitlabToken,
                      dataTypes: projectDataTypes
                    })
                  }
                  // Note: Removed the 'else if' for discoveredKind === 'group' as project discovery is now handled by 'groupProjects' dataType
                }
              } else if (dataType === "groupSubgroups") {
                // Attempt to use GroupSchema type
                for (const group of result.data as GroupSchema[]) {
                  // Use full_path for groups
                  const discoveredPath = group?.full_path
                  if (discoveredPath) {
                    logger.info(`  - Discovered sub-group: ${discoveredPath}. Spawning jobs...`) // Use logger
                    const groupDataTypes = [
                      "groupProjects",
                      "groupSubgroups", // Discovery types
                      "memberships",
                      "issues",
                      "mergeRequests",
                      "labels",
                      "milestones",
                      "timelogs" // Updated list
                    ]
                    const newJobId = generateJobId(discoveredPath, groupDataTypes)
                    this.addJob({
                      type: "START_JOB",
                      jobId: newJobId,
                      targetPath: discoveredPath,
                      gitlabApiUrl: job.gitlabApiUrl,
                      gitlabToken: job.gitlabToken,
                      dataTypes: groupDataTypes
                    })
                  }
                }
              }
              // Example: Discover commits for specific branches? (Less common to spawn from here)
              // if (dataType === 'branches') { ... }
            } catch (spawnError) {
              logger.error(`  - Error during job spawning logic for ${dataType}:`, { error: spawnError }) // Use logger
              // Decide if this should fail the parent job or just log
            }
            // --- END NEW Logic ---
          } else {
            logger.debug(`  - No new records found for ${dataType} on this page.`) // Use debug
          }

          // Check if pageInfo exists before accessing its properties
          hasNextPage = result.pageInfo?.hasNextPage ?? false // Default to false if no pageInfo
          // Handle potential null value for endCursor from GraphQL PageInfo type
          afterCursor = result.pageInfo?.endCursor ?? undefined // Use optional chaining

          // Update progress state in memory
          currentProgress.afterCursor = afterCursor // Assigns string | undefined
          currentProgress.lastAttempt = Date.now()
          job.updatedAt = new Date()
          // Send incremental progress update via IPC? Optional, could be chatty.
          // For now, only send final/paused updates.
          // this.sendStatus(); // General status update is sufficient per page?
        } catch (error) {
          logger.error(`  - Error fetching page for ${dataType}:`, { error }) // Use logger
          job.error = `Failed fetching ${dataType}: ${error instanceof Error ? error.message : String(error)}`
          currentProgress.errorCount = (currentProgress.errorCount || 0) + 1
          currentProgress.lastAttempt = Date.now()
          hasNextPage = false // Stop pagination for this type
          job.status = "failed" // Mark job as failed
          // Send failure update via IPC - handled in the calling try/catch block
          return // Exit executeJob as it failed
        }

        // Optional delay
        if (hasNextPage) {
          await new Promise((resolve) => setTimeout(resolve, 200))
        }
      } // End while(hasNextPage)

      // If pagination completed successfully for this type
      if (job.status === "running") {
        logger.info(`  - Finished fetching all pages for ${dataType}.`) // Use logger
        delete currentProgress.afterCursor // Clear cursor on success
        job.updatedAt = new Date()
        // Send progress update via IPC now that a type is fully done? Optional.
        // this.sendProgressUpdate(job); // Example
      }
    } // End for(dataType)

    // If the loop finishes and the job wasn't paused or failed mid-way
    logger.info(`Finished processing all data types for job ${job.id}. Final status: ${job.status}`) // Use logger
    // Final status (completed/failed/paused) is set and sent via IPC by the calling function (tryStartNextJob)
  }

  // Public method to start processing loop if idle
  startProcessing() {
    if (this.state === "idle") {
      logger.info("Starting job processing...") // Use logger
      this.tryStartNextJob()
    }
  }
}
