import { authClient } from "$lib/auth-client";
import { fetchAdminData } from "$lib/utils/admin-fetch";

export async function load(event) {
  const token = authClient.getSession().then((response) => response.data?.session.token);

  return {
    crawler: fetchAdminData(event.fetch, "crawler", token, { description: "Loading crawler status..." }),
    sessiontoken: token
  };
}