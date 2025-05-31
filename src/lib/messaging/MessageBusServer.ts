import { db } from "$lib/server/db";
import { job, type Job, type UpdateJobType } from "$lib/server/db/base-schema";
import { getAvailableJobs, spawnNewJobs } from "$lib/server/db/jobFactory";
import { TokenProvider } from "$lib/types";
import { JobStatus } from "$lib/types";
import { CrawlCommand } from "$lib/types";
import { eq } from "drizzle-orm/sql";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["MessageBus", "Server"]);

/**
 * MessageBusServer acts as the server-side central message handler.
 * It uses process.on('message') to listen for IPC messages from runner processes
 * and process.send() to respond back with available job data or acknowledgment of progress updates.
 *
 * The two primary message types are:
 *  - "requestJob": the runner is asking for a job.
 *  - "jobProgress": the runner is reporting progress (completed or failed).
 */
export class MessageBusServer {
  constructor() {
    // Start listening for IPC messages
    process.on("message", async (msg: any) => {
      if (msg && typeof msg === "object" && msg.type) {
        switch (msg.type) {
          case "requestJob":
            await this.handleJobRequest();
            break;
          case "jobProgress":
            await this.handleJobProgress(msg.data);
            break;
          default:
            logger.debug("[MessageBusServer] Unrecognized message type: {type}", { type: msg.type });
        }
      }
    });
  }

  /**
   * handleJobRequest is called when a runner sends a "requestJob" message.
   * It fetches an available job from the database and sends it back via IPC.
   */
  private async handleJobRequest() {
    try {
      // For example, we filter jobs by 'queued' status.
      const status: JobStatus = JobStatus.queued;
      // For simplicity, we use no cursor and perPage=1.
      const jobs = await getAvailableJobs(status, null, 1);
      if (jobs && jobs.length > 0) {
        const job = jobs[0]!; // Remove incorrect : Job type annotation, let TS infer
        // Send back the job to the runner via IPC.
        if (process.send) {
          process.send({ type: "job", data: job });
        }
      } else {
        // If no job is available, you might send a specific message or do nothing.
        if (process.send) {
          process.send({ type: "job", data: null });
        }
      }
    } catch (error: any) {
      logger.error("[MessageBusServer] Error handling job request: {error}", { error });
      if (process.send) {
        process.send({ type: "job", data: null, error: error?.message });
      }
    }
  }

  /**
   * handleJobProgress is called when a runner sends a "jobProgress" message.
   * It updates the job status in the database.
   *
   * @param data - Object containing { jobId, status, details }
   */
  private async handleJobProgress(data: { jobId: string; status: JobStatus; details?: any }) {
    try {
      // Look up the current job
      const currentJob: Job | undefined = await db.query.job.findFirst({
        where: (table, { eq }) => eq(table.id, data.jobId)
      });
      if (!currentJob) {
        logger.error("[MessageBusServer] Job not found: {jobId}", { jobId: data.jobId });
        return;
      }
      if (currentJob.status === data.status) {
        logger.warn("[MessageBusServer] Job status did not change: {jobId}", { jobId: data.jobId });
        return;
      }
      if (currentJob.status === JobStatus.finished) {
        logger.warn("[MessageBusServer] Job already finished: {jobId}", { jobId: data.jobId });
        return;
      }

      // Prepare updates based on new status
      const updates: UpdateJobType = { status: data.status };
      if (data.status === JobStatus.finished) {
        updates.finishedAt = new Date();
        if (currentJob.command === CrawlCommand.authorizationScope) {
          spawnNewJobs(
            data.status ? (data.details?.provider ?? TokenProvider.gitlab) : TokenProvider.gitlab,
            data.details,
            currentJob
          );
        }
      } else if (data.status === JobStatus.running) {
        updates.startedAt = new Date();
      }
      const result = await db.update(job).set(updates).where(eq(job.id, data.jobId));
      if (result.rowsAffected < 1) {
        logger.error("[MessageBusServer] Could not update job in DB: {jobId}", { jobId: data.jobId });
      } else {
        logger.info("[MessageBusServer] Job updated successfully: {jobId}", { jobId: data.jobId });
      }
    } catch (error) {
      logger.error("[MessageBusServer] Error handling job progress: {error}", { error });
    }
  }
}

// Instantiate the server bus immediately when imported.
export default new MessageBusServer();
