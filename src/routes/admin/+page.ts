import { authClient } from "$lib/auth-client";

export async function load({ request }: { request: Request }) {
  const token = authClient.getSession().then((response) => response.data?.session.token);

  return {
    users: fetchAdminData("users", token),
    areas: fetchAdminData("areas", token),
    jobs: fetchAdminData("jobs", token),
    processes: fetchAdminData("processes", token),
    sessiontoken: token
  };
}
async function fetchAdminData(part: string, token: string | undefined | Promise<string| undefined>) {
  if (typeof token !== "string")
    token = await token;
  try {
    const response = await fetch(`/api/admin/${part}`, {
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