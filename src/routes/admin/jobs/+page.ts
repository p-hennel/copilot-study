import { authClient } from "$lib/auth-client";
import { getLogger } from "@logtape/logtape";
const logger = getLogger(["routes","admin","jobs"]);

export async function load(event: any) {
  const token = authClient.getSession().then((response) => response.data?.session.token);

  return {
    jobs: fetchAdminData(event.fetch, "jobs", token),
    sessiontoken: token
  };
}

async function fetchAdminData(
  _fetch: typeof fetch,
  part: string,
  token: string | undefined | Promise<string | undefined>
) {
  if (typeof token !== "string") token = await token;
  try {
    const response = await _fetch(`/api/admin/${part}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) throw new Error(`Failed to fetch ${part}: ${response.text()}`);
    return await response.json();
  } catch (error) {
    logger.error("Failed to fetch {part}: {error}", { part, error });
    return [];
  }
}