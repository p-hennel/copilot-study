import { authClient } from "$lib/auth-client";
import { fetchAdminData } from "$lib/utils/admin-fetch";

export async function load(event: any) {
  const token = authClient.getSession().then((response) => response.data?.session.token);

  return {
    users: fetchAdminData(event.fetch, "users", token, { description: "Loading user accounts..." }),
    sessiontoken: token
  };
}