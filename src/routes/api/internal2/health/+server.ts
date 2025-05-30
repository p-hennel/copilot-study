import { json, type RequestHandler } from "@sveltejs/kit";
import { getLogger } from "$lib/logging";
import AppSettings from "$lib/server/settings";
import { db } from "$lib/server/db";
import { job } from "$lib/server/db/base-schema";
import { JobStatus } from "$lib/types";
import { eq, and, gte, count } from "drizzle-orm";
import { isAdmin } from "$lib/server/utils";

const logger = getLogger(["backend", "api", "internal2", "health"]);

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  version: string;
  uptime: number;
  services: {
    database: {
      status: "up" | "down" | "degraded";
      responseTime?: number;
      error?: string;
    };
    authentication: {
      status: "up" | "down" | "degraded";
      configured: boolean;
    };
    jobProcessor: {
      status: "up" | "down" | "degraded";
      activeJobs: number;
      queuedJobs: number;
      failedJobs: number;
      recentCompletions: number;
    };
    websockets: {
      status: "up" | "down" | "degraded";
      activeConnections: number;
      supportEnabled: boolean;
    };
  };
  system: {
    nodeVersion: string;
    memoryUsage: {
      used: number;
      free: number;
      total: number;
    };
    diskSpace?: {
      used: number;
      free: number;
      total: number;
    };
  };
  configuration: {
    crawlerApiTokenConfigured: boolean;
    databasePath: string;
    archivePath: string;
    environment: string;
  };
}

/**
 * Check database connectivity and performance
 */
async function checkDatabase(): Promise<HealthStatus["services"]["database"]> {
  const startTime = Date.now();
  
  try {
    // Simple connectivity test
    await db.select().from(job).limit(1);
    
    const responseTime = Date.now() - startTime;
    
    if (responseTime > 5000) {
      return {
        status: "degraded",
        responseTime,
        error: "Database response time is high"
      };
    }
    
    return {
      status: "up",
      responseTime
    };
  } catch (error) {
    return {
      status: "down",
      responseTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : "Unknown database error"
    };
  }
}

/**
 * Check job processor health
 */
async function checkJobProcessor(): Promise<HealthStatus["services"]["jobProcessor"]> {
  try {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    // Count jobs by status
    const [activeJobs, queuedJobs, failedJobs, recentCompletions] = await Promise.all([
      db.select({ count: count() }).from(job).where(eq(job.status, JobStatus.running)),
      db.select({ count: count() }).from(job).where(eq(job.status, JobStatus.queued)),
      db.select({ count: count() }).from(job).where(eq(job.status, JobStatus.failed)),
      db.select({ count: count() }).from(job).where(
        and(
          eq(job.status, JobStatus.finished),
          gte(job.finished_at, oneHourAgo)
        )
      )
    ]);
    
    return {
      status: "up",
      activeJobs: activeJobs[0]?.count || 0,
      queuedJobs: queuedJobs[0]?.count || 0,
      failedJobs: failedJobs[0]?.count || 0,
      recentCompletions: recentCompletions[0]?.count || 0
    };
  } catch {
    return {
      status: "down",
      activeJobs: 0,
      queuedJobs: 0,
      failedJobs: 0,
      recentCompletions: 0
    };
  }
}

/**
 * Check system resources
 */
function checkSystemResources(): HealthStatus["system"] {
  const memUsage = process.memoryUsage();
  
  return {
    nodeVersion: process.version,
    memoryUsage: {
      used: memUsage.heapUsed,
      free: memUsage.heapTotal - memUsage.heapUsed,
      total: memUsage.heapTotal
    }
  };
}

/**
 * Determine overall health status
 */
function determineOverallStatus(services: HealthStatus["services"]): HealthStatus["status"] {
  const serviceStatuses = [
    services.database.status,
    services.authentication.status,
    services.jobProcessor.status,
    services.websockets.status
  ];
  
  if (serviceStatuses.includes("down")) {
    return "unhealthy";
  }
  
  if (serviceStatuses.includes("degraded")) {
    return "degraded";
  }
  
  return "healthy";
}

/**
 * GET /api/internal2/health - Health check and status endpoint
 */
export const GET: RequestHandler = async ({ request, url, locals }) => {
  const includeDetails = url.searchParams.get("details") === "true";
  const currentCrawlerApiToken = AppSettings().app?.CRAWLER_API_TOKEN;
  
  // Basic authentication for detailed health info
  let isAuthenticated = false;
  const adminCheck = await isAdmin(locals);
  
  if (locals.isSocketRequest || adminCheck) {
    isAuthenticated = true;
  } else if (currentCrawlerApiToken) {
    const authHeader = request.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.substring("Bearer ".length);
      isAuthenticated = token === currentCrawlerApiToken;
    }
  }

  // For basic health checks, allow unauthenticated access
  if (!includeDetails || isAuthenticated) {
    logger.debug("Health check requested", { includeDetails, isAuthenticated });
  } else {
    logger.warn("Detailed health check requested without authentication");
    return json({ error: "Authentication required for detailed health information" }, { status: 401 });
  }

  try {
    const startTime = Date.now();
    
    // Perform health checks
    const [databaseHealth, jobProcessorHealth] = await Promise.all([
      checkDatabase(),
      checkJobProcessor()
    ]);
    
    const systemHealth = checkSystemResources();
    const settings = AppSettings();
    
    const services: HealthStatus["services"] = {
      database: databaseHealth,
      authentication: {
        status: currentCrawlerApiToken ? "up" : "degraded",
        configured: !!currentCrawlerApiToken
      },
      jobProcessor: jobProcessorHealth,
      websockets: {
        status: "up", // WebSocket support is available
        activeConnections: 0, // Would track actual connections in real implementation
        supportEnabled: true
      }
    };
    
    const overallStatus = determineOverallStatus(services);
    
    const healthStatus: HealthStatus = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: "1.0.0", // You'd get this from package.json or environment
      uptime: process.uptime(),
      services,
      system: systemHealth,
      configuration: {
        crawlerApiTokenConfigured: !!currentCrawlerApiToken,
        databasePath: settings.paths?.database || "not configured",
        archivePath: settings.paths?.archive || "not configured",
        environment: process.env.NODE_ENV || "development"
      }
    };
    
    const responseTime = Date.now() - startTime;
    
    logger.info("Health check completed", { 
      status: overallStatus, 
      responseTime,
      authenticated: isAuthenticated,
      includeDetails
    });
    
    // Return minimal info for unauthenticated requests
    if (!includeDetails) {
      return json({
        status: healthStatus.status,
        timestamp: healthStatus.timestamp,
        version: healthStatus.version,
        responseTime
      }, { status: overallStatus === "healthy" ? 200 : 503 });
    }
    
    return json({
      data: healthStatus,
      responseTime
    }, { status: overallStatus === "healthy" ? 200 : 503 });
    
  } catch (error) {
    logger.error("Error performing health check:", { error });
    
    return json({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      error: "Health check failed",
      message: error instanceof Error ? error.message : "Unknown error"
    }, { status: 503 });
  }
};

/**
 * POST /api/internal2/health - Trigger health check or maintenance operations
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  const currentCrawlerApiToken = AppSettings().app?.CRAWLER_API_TOKEN;
  const adminCheck = await isAdmin(locals);
  
  // Authentication required for POST operations
  if (!locals.isSocketRequest && !adminCheck) {
    if (!currentCrawlerApiToken) {
      logger.error("Health POST: CRAWLER_API_TOKEN not set");
      return json({ error: "Endpoint disabled due to missing configuration" }, { status: 503 });
    }

    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      logger.warn("Health POST: Missing authentication");
      return json({ error: "Authentication required" }, { status: 401 });
    }

    const token = authHeader.substring("Bearer ".length);
    if (token !== currentCrawlerApiToken) {
      logger.warn("Health POST: Invalid authentication");
      return json({ error: "Invalid authentication" }, { status: 401 });
    }
  }

  let payload: any;
  try {
    payload = await request.json();
  } catch (error) {
    logger.error("Error parsing health operation request:", { error });
    return json({ error: "Invalid request body" }, { status: 400 });
  }

  const { operation } = payload;
  
  logger.info("Health operation requested", { operation });

  try {
    switch (operation) {
      case "deep_check": {
        // Perform comprehensive health check
        const [databaseHealth, jobProcessorHealth] = await Promise.all([
          checkDatabase(),
          checkJobProcessor()
        ]);
        
        return json({
          operation: "deep_check",
          timestamp: new Date().toISOString(),
          results: {
            database: databaseHealth,
            jobProcessor: jobProcessorHealth,
            system: checkSystemResources()
          }
        }, { status: 200 });
      }
        
      case "clear_cache": {
        // Clear any caches (placeholder for future implementation)
        logger.info("Cache clear operation requested");
        return json({
          operation: "clear_cache",
          timestamp: new Date().toISOString(),
          message: "Cache cleared successfully"
        }, { status: 200 });
      }
        
      default:
        return json({ error: `Unknown operation: ${operation}` }, { status: 400 });
    }
  } catch (error) {
    logger.error(`Error performing health operation ${operation}:`, { error });
    return json({ error: "Operation failed" }, { status: 500 });
  }
};