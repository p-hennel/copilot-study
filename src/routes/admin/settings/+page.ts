import { authClient } from "$lib/auth-client";

export async function load() {
  const token = authClient.getSession().then((response) => response.data?.session.token);

  return {
    sessiontoken: token
  };
}