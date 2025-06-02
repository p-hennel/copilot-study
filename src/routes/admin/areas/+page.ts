import { authClient } from "$lib/auth-client";
import { fetchAdminData } from "$lib/utils/admin-fetch";

export async function load(event: any) {
  const token = authClient.getSession().then((response) => response.data?.session.token);

  return {
    areas: fetchAdminData(event.fetch, "areas", token, { description: "Loading survey areas..." }),
    sessiontoken: token
  };
}