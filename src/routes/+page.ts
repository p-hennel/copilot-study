import { invalidate } from "$app/navigation"
import { browser } from "$app/environment"
import { authClient } from "$lib/auth-client"

let jobProgressTimer: Timer | null = null
const token = authClient.getSession().then((response) => response.data?.session.token)
export async function load(event) {
  return {
    jobInfo: fetchPrefetch(event),
    ...event.data
  }
}

const fetchPrefetch = async (event: any) => {
  let result: any = null
  const data: any = await event.fetch("/api/prefetch", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${await token}`
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
  console.log(result)
  return result
}
