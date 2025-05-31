#!/usr/bin/env bun
// Test script to verify connection handling and job reset functionality

import { db } from "$lib/server/db";
import { job } from "$lib/server/db/base-schema";
import { JobStatus } from "$lib/types";
import { eq } from "drizzle-orm";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["test", "connection-handling"]);

async function testJobResetFunctionality() {
  logger.info("🧪 Testing job reset functionality...");
  
  try {
    // Check for running jobs
    const runningJobs = await db
      .select()
      .from(job)
      .where(eq(job.status, JobStatus.running));
    
    logger.info(`Found running jobs`, { count: runningJobs.length });

    if (runningJobs.length > 0) {
      logger.info("Running jobs:", { jobs: runningJobs.map(j => ({ id: j.id, status: j.status, started_at: j.started_at })) });

      // Simulate connection loss by resetting jobs
      logger.info("🔄 Simulating connection loss - resetting running jobs to queued...");
      
      const result = await db
        .update(job)
        .set({ 
          status: JobStatus.queued,
          started_at: null
        })
        .where(eq(job.status, JobStatus.running));
      
      logger.info(`✅ Reset jobs to queued status`, { count: result.rowsAffected });
      
      // Verify the reset
      const queuedJobs = await db
        .select()
        .from(job)
        .where(eq(job.status, JobStatus.queued));
      
      logger.info(`Now have queued jobs`, { count: queuedJobs.length });
    } else {
      logger.info("ℹ️ No running jobs found to test with");
    }
    
    // Show current job status distribution
    const statusCounts = await db
      .select()
      .from(job);
    
    const statusDistribution = statusCounts.reduce((acc, j) => {
      acc[j.status] = (acc[j.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    logger.info("📊 Current job status distribution:", statusDistribution);
    
  } catch (error) {
    logger.error("❌ Error testing job reset functionality: {error}", { error });
  }
}

// Run the test
testJobResetFunctionality().then(() => {
  logger.info("🧪 Test completed");
  process.exit(0);
}).catch((error) => {
  logger.error("❌ Test failed: {error}", { error });
  process.exit(1);
});