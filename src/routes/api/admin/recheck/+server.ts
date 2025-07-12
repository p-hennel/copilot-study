import { json } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { job } from "$lib/server/db/base-schema";
import { CrawlCommand, JobStatus } from "$lib/types";
import { and, eq } from "drizzle-orm";
import { triggerDiscoveryForAccount } from "$lib/server/job-manager";

export async function POST({ locals, request }: { request: Request, locals: any }) {
  if (!locals.session || !locals.user?.id || locals.user.role !== "admin") {
    return json({ error: "Unauthorized!" }, { status: 401 });
  }

  const body: any = await request.json();
  const accountId = body.accountId;
  const userId = body.userId;
  const provider = body.provider;

  if (!accountId || !userId || !provider) {
    return json({ error: "Missing accountId, userId, or provider" }, { status: 400 });
  }

  await triggerDiscoveryForAccount(userId, accountId, provider); 

  await db.update(job).set({
    status: JobStatus.queued
  }).where(and(
    eq(job.userId, userId),
    eq(job.accountId, accountId),
    eq(job.command, CrawlCommand.GROUP_PROJECT_DISCOVERY)
  ));
  
  return json({});
}