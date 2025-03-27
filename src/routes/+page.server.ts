import { ensureUserIsAuthenticated, getMD } from "$lib/server/utils";
import { getAccounts, scopingJobsFromAccounts } from "$lib/server/db/jobFactory";
import { db } from "$lib/server/db";
import { area, area_authorization, job } from "$lib/server/db/base-schema";
import { AreaType } from "$lib/utils";
import { account } from "$lib/server/db/auth-schema";
import { eq, isNotNull, and, count, sql } from "drizzle-orm";
import { JobStatus } from "$lib/utils";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, locals, depends }) => {
  let linkedAccounts = [] as string[];
  let jobs = [] as Partial<typeof job.$inferSelect>[];
  let areas = [] as {
    name: string | null;
    gitlab_id: string | null;
    full_path: string;
    type: AreaType;
    jobsFinished: number;
    jobsTotal: number;
  }[];

  if (ensureUserIsAuthenticated(locals)) {
    const accounts = await getAccounts(locals.user!.id!);
    linkedAccounts = accounts.map((x) => x.provider);

    await scopingJobsFromAccounts(accounts, locals.user!.id!);

    jobs = await db
      .select({
        provider: account.providerId,
        status: job.status,
        command: job.command,
        full_path: job.full_path
      })
      .from(job)
      .innerJoin(account, eq(job.accountId, account.id))
      .where(eq(account.userId, locals.user!.id!));
    areas = await db
      .select({
        full_path: area.full_path,
        gitlab_id: area.gitlab_id,
        name: area.name,
        type: area.type,
        jobsFinished: sql`TOTAL(${job.status} = '${JobStatus.finished}')`.mapWith(Number),
        jobsTotal: count(job.status)
      })
      .from(area)
      .innerJoin(area_authorization, eq(area_authorization.area_id, area.full_path))
      .innerJoin(account, eq(area_authorization.accountId, account.id))
      .leftJoin(job, eq(area.full_path, job.full_path))
      .groupBy(area.full_path)
      .orderBy(area.full_path)
      .where(
        and(eq(account.userId, locals.user!.id!), isNotNull(area.full_path), isNotNull(area.type))
      );
  }

  return {
    content: await getMD("start", depends, locals),
    linkedAccounts,
    jobs,
    areas
  };
};
