// Use environment variable or default to development mode detection
const dev = process.env.NODE_ENV !== 'production';
import { CrawlCommand, JobStatus, TokenProvider } from "$lib/types";
import { getLogger } from "@logtape/logtape";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { job } from "./db/base-schema";
import AppSettings from "./settings";

// Keep track of service heartbeats
const heartbeats: Record<string, Date> = {};

// Keep track of crawler states
const crawlerStates: Record<string, {
  queueStats?: any,
  runningJobs?: string[],
  queuedJobs?: string[],
  resourceCounts?: Record<string, number>,
  lastActive: Date
}> = {};

/**
 * Get the current heartbeats for all connected services
 */
export function getHeartbeats() {
  return heartbeats;
}

/**
 * Get the current states of all connected crawlers
 */
export function getCrawlerStates() {
  return crawlerStates;
}


async function getAccountIdFromJob(jobId: string|undefined|null) {
  if (!jobId || jobId.length <= 0)
    return null
  return (await db.query.job.findFirst({
    columns: {
      accountId: true
    },
    where: eq(job.id, jobId)
  }))?.accountId
}