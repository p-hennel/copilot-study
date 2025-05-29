import { authClient } from "$lib/auth-client";
import { fetchAdminData } from "$lib/utils/admin-fetch";

export async function load(event) {
  const token = authClient.getSession().then((response) => response.data?.session.token);

  return {
    // Dashboard overview data - lightweight data for summary stats
    users: fetchAdminData(event.fetch, "users", token, { description: "Loading users..." }),
    areas: fetchAdminData(event.fetch, "areas", token, { description: "Loading areas..." }),
    jobs: fetchAdminData(event.fetch, "jobs", token, { description: "Loading jobs..." }),
    tokenInfos: fetchAdminData(event.fetch, "tokenInfos", token, { description: "Loading tokens..." }),
    crawler: fetchAdminData(event.fetch, "crawler", token, { description: "Loading crawler status..." }),
    sessiontoken: token
  };
}
