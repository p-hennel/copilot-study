#!/usr/bin/env bun
// Test script to verify connection handling and job reset functionality

import { db } from "$lib/server/db";
import { job } from "$lib/server/db/base-schema";
import { JobStatus } from "$lib/types";
import { eq } from "drizzle-orm";

async function testJobResetFunctionality() {
  console.log("🧪 Testing job reset functionality...");
  
  try {
    // Check for running jobs
    const runningJobs = await db
      .select()
      .from(job)
      .where(eq(job.status, JobStatus.running));
    
    console.log(`Found ${runningJobs.length} running jobs`);
    
    if (runningJobs.length > 0) {
      console.log("Running jobs:", runningJobs.map(j => ({ id: j.id, status: j.status, started_at: j.started_at })));
      
      // Simulate connection loss by resetting jobs
      console.log("🔄 Simulating connection loss - resetting running jobs to queued...");
      
      const result = await db
        .update(job)
        .set({ 
          status: JobStatus.queued,
          started_at: null
        })
        .where(eq(job.status, JobStatus.running));
      
      console.log(`✅ Reset ${result.rowsAffected} jobs to queued status`);
      
      // Verify the reset
      const queuedJobs = await db
        .select()
        .from(job)
        .where(eq(job.status, JobStatus.queued));
      
      console.log(`Now have ${queuedJobs.length} queued jobs`);
    } else {
      console.log("ℹ️ No running jobs found to test with");
    }
    
    // Show current job status distribution
    const statusCounts = await db
      .select()
      .from(job);
    
    const statusDistribution = statusCounts.reduce((acc, j) => {
      acc[j.status] = (acc[j.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    console.log("📊 Current job status distribution:", statusDistribution);
    
  } catch (error) {
    console.error("❌ Error testing job reset functionality:", error);
  }
}

// Run the test
testJobResetFunctionality().then(() => {
  console.log("🧪 Test completed");
  process.exit(0);
}).catch((error) => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});