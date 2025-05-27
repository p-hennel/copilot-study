import { authClient } from "$lib/auth-client";

export async function load(event) {
  const response = await authClient.getSession()
  const session = response.data?.session;
  const token = session?.token // authClient.getSession().then((response) => response.data?.session.token);

  return {
    tokenInfos: fetchAdminData(event.fetch, "tokenInfos", token),
    user: response.data?.user,
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
    console.error(`Failed to fetch ${part}:`, error);
    return [];
  }
}