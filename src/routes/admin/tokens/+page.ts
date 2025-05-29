import { authClient } from "$lib/auth-client";
import { fetchAdminData } from "$lib/utils/admin-fetch";

export async function load(event) {
  const response = await authClient.getSession()
  const session = response.data?.session;
  const token = session?.token

  return {
    tokenInfos: fetchAdminData(event.fetch, "tokenInfos", token, { description: "Loading token information..." }),
    user: response.data?.user,
    sessiontoken: token
  };
}