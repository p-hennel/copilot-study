import { db } from "$lib/server/db";
import { account } from "$lib/server/db/auth-schema";
import { area, area_authorization, job } from "$lib/server/db/base-schema";
import { getAccounts } from "$lib/server/db/jobFactory";
import { handleNewAuthorization } from "$lib/server/job-manager";
import fetchAllGroupsAndProjects from "$lib/server/mini-crawler/main";
import { manageOAuthToken, type TokenManagerOptions } from "$lib/server/mini-crawler/token-check";
import { ensureUserIsAuthenticated, getMD } from "$lib/server/utils";
import {
  AreaType,
  ContentType,
  JobStatus,
  TokenProvider,
  type MarkdownContent
} from "$lib/content-types";
import { type AlertContent } from "$lib/AlertContent";
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

        const options = {
          verifyUrl: "/oauth/verify",
          refreshUrl: "/oauth/token",
          clientId: "",
          clientSecret: ""
        };

        type ProviderTypes = {
          provider: TokenProvider;
          baseUrl: string;
          options: TokenManagerOptions;
        };

        const opts = forProvider<ProviderTypes>(x.provider, {
          gitlabCloud: () => {
            const baseUrl = AppSettings().auth.providers.gitlabCloud.baseUrl;
            return {
              provider: TokenProvider.gitlabCloud,
              baseUrl,
              options: {
                verifyUrl: `${baseUrl}${options.verifyUrl}`,
                refreshUrl: `${baseUrl}${options.refreshUrl}`,
                clientId: AppSettings().auth.providers.gitlabCloud.clientId ?? options.clientId,
                clientSecret:
                  AppSettings().auth.providers.gitlabCloud.clientSecret ?? options.clientSecret
              }
            };
          },
          gitlabOnPrem: () => {
            const baseUrl = AppSettings().auth.providers.gitlabCloud.baseUrl;
            return {
              provider: TokenProvider.gitlab,
              baseUrl,
              options: {
                verifyUrl: `${baseUrl}${options.verifyUrl}`,
                refreshUrl: `${baseUrl}${options.refreshUrl}`,
                clientId: AppSettings().auth.providers.gitlab.clientId ?? options.clientId,
                clientSecret:
                  AppSettings().auth.providers.gitlab.clientSecret ?? options.clientSecret
              }
            };
          }
        });

        if (!opts || !opts.baseUrl || !opts.options) return;

        const updatedTokens = await manageOAuthToken(
          x.token ?? "",
          x.refreshToken ?? "",
          opts.options
        );

        let token = x.token ?? "";
        if (
          updatedTokens &&
          (updatedTokens.accessToken != x.token || updatedTokens?.refreshToken != x.refreshToken)
        ) {
          // Save the updated tokens for later use
          await db
            .update(account)
            .set({
              refreshToken: updatedTokens.refreshToken,
              accessToken: updatedTokens.accessToken,
              accessTokenExpiresAt: updatedTokens.expiresAt
                ? new Date(updatedTokens.expiresAt)
                : null
            })
            .where(eq(account.id, x.id));
          token = updatedTokens.accessToken;
        }

        if (!token) return;

        // Trigger authorization scope job creation/check
        await handleNewAuthorization(locals.user!.id!, x.id, opts.provider);

        const apiUrl = `${opts.baseUrl}/api/graphql`;
        console.log("starting fetch all");
        fetchAllGroupsAndProjects(locals.user.id, x.id, opts.provider, apiUrl, token);
      });
  }

  /*
  if (ensureUserIsAuthenticated(locals)) {
    const accounts = await getAccounts(locals.user!.id!)
    linkedAccounts = accounts.map((x) => x.provider)

    retriggerJob(locals.user, fetch)

    await scopingJobsFromAccounts(accounts, locals.user!.id!)

    
  }
  */

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
