import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { eq, count, gte } from 'drizzle-orm';
import { job } from '$lib/server/db/base-schema';
import { account } from '$lib/server/db/auth-schema';
import { JobStatus } from '$lib/types';
import { getLogger } from "$lib/logging";
import { isAdmin } from '$lib/server/utils';
import directCommunicationManager from '$lib/server/direct-communication-manager';

const logger = getLogger(["api", "admin", "statistics"]);

export const GET: RequestHandler = async ({ locals }) => {
  logger.debug("Admin statistics request received");

  // Check if user is admin
  if (!(await isAdmin(locals))) {
    logger.warn("Non-admin user attempted to access statistics", {
      userId: locals.user?.id,
      userEmail: locals.user?.email
    });
    return json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    // Job statistics by status
    const jobStats = await db
      .select({
        status: job.status,
        count: count()
      })
      .from(job)
      .groupBy(job.status);

    // Account statistics
    const accountStats = await db
      .select({
        providerId: account.providerId,
        count: count()
      })
      .from(account)
      .groupBy(account.providerId);

    // Recent job activity (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentJobs = await db
      .select({
        count: count()
      })
      .from(job)
      .where(gte(job.created_at, oneDayAgo));

    // Running jobs count
    const runningJobs = await db
      .select({
        count: count()
      })
      .from(job)
      .where(eq(job.status, JobStatus.running));

    // Failed jobs count
    const failedJobs = await db
      .select({
        count: count()
      })
      .from(job)
      .where(eq(job.status, JobStatus.failed));

    // Get crawler/communication system status
    const crawlerStatus = {
      connected: directCommunicationManager.isConnected(),
      connectionMethod: "direct_socket",
      clients: directCommunicationManager.getAuthorizedClients(),
      totalClients: directCommunicationManager.getAuthorizedClients().length,
      activeClients: directCommunicationManager.getAuthorizedClients().filter(client => 
        Date.now() - client.lastActivity < 60000
      ).length,
      systemInfo: {
        communicationSystem: "DirectCommunicationManager",
        authenticationSystem: "DirectSocketAuth",
        migrationComplete: true,
        socketPath: process.env.SOCKET_PATH || "not configured"
      }
    };

    // Build comprehensive statistics response
    const statistics = {
      jobs: {
        total: jobStats.reduce((sum, stat) => sum + stat.count, 0),
        byStatus: jobStats.reduce((acc, stat) => {
          acc[stat.status] = stat.count;
          return acc;
        }, {} as Record<string, number>),
        running: runningJobs[0]?.count || 0,
        failed: failedJobs[0]?.count || 0,
        recentActivity: recentJobs[0]?.count || 0
      },
      accounts: {
        total: accountStats.reduce((sum, stat) => sum + stat.count, 0),
        byProvider: accountStats.reduce((acc, stat) => {
          acc[stat.providerId] = stat.count;
          return acc;
        }, {} as Record<string, number>)
      },
      crawler: crawlerStatus,
      system: {
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        nodeVersion: process.version,
        platform: process.platform,
        environment: process.env.NODE_ENV || 'development',
        memoryUsage: process.memoryUsage(),
        communicationArchitecture: {
          version: "2.0",
          type: "direct_socket",
          features: [
            "connection_based_auth",
            "message_deduplication", 
            "circuit_breaker",
            "heartbeat_monitoring",
            "automatic_reconnection"
          ]
        }
      },
      database: {
        connectionStatus: "connected", // Assume connected if we got this far
        lastQuery: new Date().toISOString()
      }
    };

    logger.debug("Returning statistics:", {
      totalJobs: statistics.jobs.total,
      totalAccounts: statistics.accounts.total,
      crawlerConnected: statistics.crawler.connected,
      runningJobs: statistics.jobs.running
    });

    return json(statistics);

  } catch (error) {
    logger.error("Error getting statistics:", { error });
    return json({ 
      error: "Failed to get statistics",
      details: error instanceof Error ? error.message : String(error),
      system: {
        timestamp: new Date().toISOString(),
        communicationArchitecture: {
          version: "2.0",
          type: "direct_socket",
          status: "error"
        }
      }
    }, { status: 500 });
  }
};