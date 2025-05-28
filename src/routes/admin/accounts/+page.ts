import { authClient } from "$lib/auth-client";

export async function load(event) {
  const token = authClient.getSession().then((response) => response.data?.session.token);

  return {
    users: fetchAdminData(event.fetch, "users", token),
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
    
    if (!response.ok) {
      console.error(`Failed to fetch ${part}:`, response);
      throw new Error(`Failed to fetch ${part}: ${response.text()}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`Failed to fetch ${part}:`, error);
    return [];
  }
}