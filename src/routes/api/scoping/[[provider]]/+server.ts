import { db } from "$lib/server/db";
import { tokenScopeJob } from "$lib/server/db/base-schema";
import { unauthorizedResponse } from "$lib/server/utils";
import { TokenProvider } from "$lib/types";
import { json } from "@sveltejs/kit";
import { and, eq } from "drizzle-orm";

export async function GET({ params: { provider }, locals }) {
  if (!locals.session || !locals.user || !locals.user.id)
    return unauthorizedResponse()
  
  if (!provider || provider.length <= 0)
    return json(undefined, { status: 400 })

  provider = provider.toLowerCase()
  let _provider: TokenProvider
  if (provider === "gitlab" || provider === "gitlab-cloud") {
    _provider = TokenProvider.gitlabCloud
  } else if (provider === "gitlab-onprem") {
    _provider = TokenProvider.gitlab
  } else if (provider === "jira") {
    _provider = TokenProvider.jira
  } else if (provider === "jiraCloud") {
    _provider = TokenProvider.jiraCloud
  } else {
    console.log("unknown provider", provider)
    return json(undefined, { status: 400 })
  }

  const job = await db.query.tokenScopeJob.findFirst({
    columns: {
      provider: true,
      createdAt: true,
      updated_at: true,
      isComplete: true,
      groupCount: true,
      projectCount: true,
      groupTotal: true,
      projectTotal: true
    },
    where: and(eq(tokenScopeJob.userId, locals.user.id), eq(tokenScopeJob.provider, _provider))
  })

  if (!job)
    return json(undefined, { status: 404 })
  else
    return json(job)
}
