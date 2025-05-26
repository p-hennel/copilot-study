import { db } from "$lib/server/db";
import { account } from "$lib/server/db/auth-schema";
import { area, area_authorization, job } from "$lib/server/db/base-schema";
import { getAccounts } from "$lib/server/db/jobFactory";
import { ensureUserIsAuthenticated, getMD } from "$lib/server/utils";
import {
  ContentType,
  type MarkdownContent,
  type AlertContent
} from "$lib/content-types";
import {
  AreaType,
  JobStatus,
  TokenProvider,
} from "$lib/types";
import { forProvider } from "$lib/utils";
import { m } from "$paraglide";
import { and, count, eq, isNotNull, sql } from "drizzle-orm";
import AppSettings from "../lib/server/settings";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, depends }) => {
  const linkedAccounts = [] as string[];
  const jobs = [] as Partial<typeof job.$inferSelect>[];
  const areas = [] as {
    name: string | null;
    gitlab_id: string | null;
    full_path: string;
    type: AreaType;
    jobsFinished: number;
    jobsTotal: number;
  }[];

  if (ensureUserIsAuthenticated(locals)) {
    const accounts = await getAccounts(locals.user!.id!);
    linkedAccounts.push(...accounts.map((x) => x.provider));

    accounts
      .filter((x) => x.id && x.provider && x.token && x.provider !== "credential")
      .forEach(async (x) => {
        if (x.provider.toLowerCase().indexOf("gitlab") < 0) return;
        jobs.push(
          ...(await db
            .select({
              provider: account.providerId,
              status: job.status,
              command: job.command,
              full_path: job.full_path
            })
            .from(job)
            .innerJoin(account, eq(job.accountId, account.id))
            .where(eq(account.userId, locals.user!.id!))
            .limit(100))
        );
        areas.push(
          ...(await db
            .select({
              full_path: area.full_path,
              gitlab_id: area.gitlab_id,
              name: area.name,
              type: area.type,
              jobsFinished:
                sql`TOTAL(CAST(${job.status} = ${JobStatus.finished} AS INTEGER))`.mapWith(Number),
              jobsTotal: count(job.status)
            })
            .from(area)
            .innerJoin(area_authorization, eq(area_authorization.area_id, area.full_path))
            //.innerJoin(account, eq(area_authorization.accountId, account.id))
            .leftJoin(job, eq(area.full_path, job.full_path))
            .where(
              and(
                eq(area_authorization.accountId, x.id),
                isNotNull(area.full_path),
                isNotNull(area.type)
              )
            )
            .groupBy(area.full_path)
            .orderBy(area.full_path)
            .limit(100))
        );

        type ProviderTypes = {
          provider: TokenProvider;
          baseUrl: string;
        };

        const opts = forProvider<ProviderTypes>(x.provider, {
          gitlabCloud: () => {
            const baseUrl = AppSettings().auth.providers.gitlabCloud.baseUrl;
            return {
              provider: TokenProvider.gitlabCloud,
              baseUrl
            };
          },
          gitlabOnPrem: () => {
            const baseUrl = AppSettings().auth.providers.gitlab.baseUrl ?? "";
            return {
              provider: TokenProvider.gitlab,
              baseUrl
            };
          }
        });

        if (!opts || !opts.baseUrl) return;

        const token = x.token ?? "";

        if (!token) return;

        // Trigger authorization scope job creation/check
        // FOR NOW NO ACCOUNT WILL AUTOMATICALLY START TO CRAWL OR TRIGGER "GROUP_PROJECT_DISCOVERY"
        // const apiUrl = `${opts.baseUrl}/api/graphql`;
        // await handleNewAuthorization(locals.user!.id!, x.id, opts.provider, token, apiUrl);
      });
  }

  const contents = await Promise.all([
    _getMD("what", depends, locals),
    _getMD("responsibility", depends, locals),
    _getMD("for-you", depends, locals),
    {
      type: ContentType.Alert,
      icon: "Gift",
      title: m["home.prize.title"](),
      content: m["home.prize.content"]()
    } as AlertContent,
    _getMD("questions", depends, locals)
  ]);

  return {
    userId: locals.user?.id,
    content: await getMD("start", depends, locals),
    contents,
    linkedAccounts,
    jobs,
    areas
  };
};

async function _getMD(
  slug: string,
  depends: (dep: string) => void,
  locals: App.Locals
): Promise<MarkdownContent> {
  const content = await getMD(slug, depends, locals);
  return {
    type: ContentType.Markdown,
    content
  } as MarkdownContent;
}
