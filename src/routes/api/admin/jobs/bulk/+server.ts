import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { eq, and, gte, lte } from "drizzle-orm";
import { job } from "$lib/server/db/base-schema";
import { JobStatus, TokenProvider } from "$lib/types";
import { getLogger } from "@logtape/logtape";
const logger = getLogger(["routes","api","admin","jobs","bulk"]);

export async function POST({ locals, request }: RequestEvent) {
  if (!locals.session || !locals.user?.id || locals.user.role !== "admin") {
    return json({ error: "Unauthorized!" }, { status: 401 });
  }

  try {
    const body = await request.json() as {
      filters?: {
        status?: JobStatus;
        provider?: TokenProvider;
        dateFrom?: string;
        dateTo?: string;
        command?: string;
        accountId?: string;
      };
      confirm?: boolean;
    };

    const { filters, confirm } = body;

    if (!confirm) {
      return json({ error: "Confirmation required for bulk deletion. Set confirm: true" }, { status: 400 });
    }

    // Build filter conditions
    const conditions: ReturnType<typeof eq>[] = [];
    
    if (filters?.status && Object.values(JobStatus).includes(filters.status)) {
      conditions.push(eq(job.status, filters.status));
    }
    
    if (filters?.provider && Object.values(TokenProvider).includes(filters.provider)) {
      conditions.push(eq(job.provider, filters.provider));
    }
    
    if (filters?.command) {
      conditions.push(eq(job.command, filters.command as any));
    }
    
    if (filters?.accountId) {
      conditions.push(eq(job.accountId, filters.accountId));
    }
    
    if (filters?.dateFrom) {
      const fromDate = new Date(filters.dateFrom);
      if (!isNaN(fromDate.getTime())) {
        conditions.push(gte(job.created_at, fromDate));
      }
    }
    
    if (filters?.dateTo) {
      const toDate = new Date(filters.dateTo);
      if (!isNaN(toDate.getTime())) {
        conditions.push(lte(job.created_at, toDate));
      }
    }

    if (conditions.length === 0) {
      return json({ error: "At least one filter condition is required for bulk deletion" }, { status: 400 });
    }

    // Use transaction for bulk deletion with filters
    const result = await db.transaction(async (tx) => {
      const deletedJobs = await tx.delete(job).where(and(...conditions)).returning();
      return deletedJobs;
    });

    logger.info(`Admin ${locals.user.email} performed bulk deletion of ${result.length} jobs with filters:`, filters);
    return json({ 
      success: true, 
      message: `${result.length} jobs deleted successfully with applied filters`,
      deletedCount: result.length,
      deletedJobs: result,
      appliedFilters: filters
    });
  } catch (error) {
    logger.error("Error in bulk job deletion:", {error});
    return json({ error: "Failed to perform bulk job deletion" }, { status: 500 });
  }
}

export async function DELETE({ locals, request }: RequestEvent) {
  if (!locals.session || !locals.user?.id || locals.user.role !== "admin") {
    return json({ error: "Unauthorized!" }, { status: 401 });
  }

  try {
    const body = await request.json() as {
      confirm?: boolean;
      confirmPhrase?: string;
    };

    const { confirm, confirmPhrase } = body;

    // Safety checks for deleting all jobs
    if (!confirm) {
      return json({ error: "Confirmation required for deleting all jobs. Set confirm: true" }, { status: 400 });
    }

    if (confirmPhrase !== "DELETE ALL JOBS") {
      return json({ 
        error: "Confirmation phrase required. Set confirmPhrase: 'DELETE ALL JOBS'" 
      }, { status: 400 });
    }

    // Use transaction to delete all jobs
    const result = await db.transaction(async (tx) => {
      const deletedJobs = await tx.delete(job).returning();
      return deletedJobs;
    });

    logger.info(`Admin ${locals.user.email} performed COMPLETE deletion of ALL ${result.length} jobs`);
    return json({ 
      success: true, 
      message: `ALL ${result.length} jobs deleted successfully`,
      deletedCount: result.length,
      warning: "All jobs have been permanently deleted"
    });
  } catch (error) {
    logger.error("Error in complete job deletion:", {error});
    return json({ error: "Failed to delete all jobs" }, { status: 500 });
  }
}