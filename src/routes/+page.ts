import { browser } from "$app/environment";
import { invalidate } from "$app/navigation";
import { authClient } from "$lib/auth-client";
import type { PageLoad } from './$types';

let jobProgressTimer: Timer | null = null;
let scopingUrls: string[] | undefined = [];
const token = authClient.getSession().then((response) => response.data?.session?.token);

export const load: PageLoad = async ({ data, fetch }) => {
  scopingUrls = getUrls(data.linkedAccounts);
  return {
    jobInfo: fetchScopingInfo(fetch),
    ...data
  };
}

export type ScopingJob = {
  provider: string;
  createdAt: Date;
  updated_at: Date;
  isComplete: boolean;
  groupCount: number;
  projectCount: number;
  groupTotal: number | null;
  projectTotal: number | null;
};

const getUrls = (linkedAccounts?: string[]) => {
  if (!linkedAccounts || linkedAccounts.length <= 0) return undefined;
  return linkedAccounts
    .filter((x) => x != "credential")
    .map((x) => new URL(`http://localhost/api/scoping/${x}`).pathname);
};

const fetchScopingInfo = async (_fetch: typeof fetch = fetch) => {
  const _token = await token;
  if (!_token || _token.length <= 0 || !scopingUrls || scopingUrls.length <= 0) return [];

  const results = (
    await Promise.all(
      scopingUrls.map(async (url) => {
        const data = await _fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${_token}`
          }
        }).catch(() => ({ok: false} as Response));
        if (!data.ok) {
          return undefined;
        } else {
          return (await data.json()) as ScopingJob;
        }
      })
    )
  ).filter((x) => x != undefined && x != null);

  if (browser) {
    if (!jobProgressTimer) {
      jobProgressTimer = setInterval(() => {
        invalidate((url) => scopingUrls != undefined && scopingUrls.includes(url.pathname));
      }, 30000);
    }
  }

  return results;
};

/*
const fetchPrefetch = async (event: any) => {
  const _token = await token
  if (!_token || _token.length <= 0)
    return

  let result: any = null
  const data: any = await event.fetch("/api/prefetch", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${_token}`
    }
  })
  if (!data.ok) {
    result = null
    if (jobProgressTimer) clearInterval(jobProgressTimer)
  } else {
    result = (await data.json()) as any
    if (result.isComplete) {
      if (jobProgressTimer) clearInterval(jobProgressTimer)
    } else if (browser && !jobProgressTimer) {
      jobProgressTimer = setInterval(() => {
        invalidate("/api/prefetch")
      }, 30000)
    }
  }
  
  return result
}
*/
