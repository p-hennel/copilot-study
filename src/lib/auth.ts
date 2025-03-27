import { betterAuth, type User } from "better-auth";
import { admin } from "better-auth/plugins";
import { apiKey } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./server/db/index";
import { jwt } from "better-auth/plugins";
import * as schema from "./server/db/schema";
import { env } from "$env/dynamic/private";
import { genericOAuth } from "better-auth/plugins";
import { type OAuth2Tokens } from "better-auth/oauth2";
import { normalizeURL } from "./utils";

const gitlabBaseURL = normalizeURL(env.GITLAB_BASE_URL ?? "https://gitlab.com");
const jiraBaseURL = normalizeURL(env.JIRA_BASE_URL ?? "https://auth.atlassian.com/");

export const ProviderScopes = {
  gitlab: ["read:jira-work", "read:jira-user", "read:me", "read:account"],
  jira: ["read:jira-work", "read:jira-user", "read:me", "read:account"]
};

export const getJiraAccountInfo = async (
  cloudId: string,
  headers: HeadersInit,
  accountId?: string,
  retriesLeft: number = 0
): Promise<User | null> => {
  const response = await fetch(
    `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/user?accountId=${accountId}`,
    {
      method: "GET",
      headers: headers
    }
  );

  if (!accountId) accountId = response.headers.get("X-AACCOUNTID") ?? undefined;

  if (response.ok) {
    const data = await response.json();
    return {
      id: accountId,
      email: data.emailAddress,
      emailVerified: true,
      name: data.displayName
      //createdAt: new Date(),
      //updatedAt: new Date()
    } as User;
  } else {
    return retriesLeft > 0
      ? await getJiraAccountInfo(cloudId, headers, accountId, retriesLeft - 1)
      : null;
  }
};

export const getUserFromJira = async (tokens: OAuth2Tokens): Promise<User | null> => {
  const headers: HeadersInit = new Headers();
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${tokens.accessToken}`);

  const response = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
    method: "GET",
    headers: headers
  });

  const accessibleResources = await response.json();
  const cloudId = accessibleResources[0].id;
  const accountId = response.headers.get("X-AACCOUNTID") ?? undefined;

  return getJiraAccountInfo(cloudId, headers, accountId, 2);
};

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: schema
  }),
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["gitlab", "jira"],
      allowDifferentEmails: true
    }
  },
  plugins: [
    admin({
      adminUserIds: [env.ADMIN_ID]
    }),
    jwt(),
    apiKey(),
    genericOAuth({
      config: [
        {
          providerId: "jiracloud",
          clientId: env.JIRA_CLIENT_ID,
          clientSecret: env.JIRA_CLIENT_SECRET,
          authorizationUrl: "https://auth.atlassian.com/authorize",
          authorizationUrlParams: {
            audience: "api.atlassian.com"
          },
          tokenUrl: "https://auth.atlassian.com/oauth/token",
          scopes: ProviderScopes.jira,
          redirectURI: `http://localhost:5173/api/auth/oauth2/callback/jiracloud`,
          getUserInfo: getUserFromJira
        },
        {
          providerId: "jiralocal",
          clientId: env.JIRA_CLIENT_ID,
          clientSecret: env.JIRA_CLIENT_SECRET,
          tokenUrl: `${jiraBaseURL}/plugins/servlet/oauth/request-token`,
          authorizationUrl: `${jiraBaseURL}/plugins/servlet/oauth/authorize`,
          authorizationUrlParams: {
            audience: "api.atlassian.com"
          },
          //`${jiraBaseURL}/plugins/servlet/oauth/access-token`,
          //'RSA-SHA1',
          //discoveryUrl: `${jiraBaseURL}/.well-known/openid-configuration`,
          scopes: ProviderScopes.jira,
          getUserInfo: getUserFromJira,
          redirectURI: `http://localhost:5173/api/auth/oauth2/callback/jira`
        }
      ]
    })
  ],
  emailAndPassword: {
    enabled: true
  },
  socialProviders: {
    gitlab: {
      clientId: env.GITLAB_CLIENT_ID as string,
      clientSecret: env.GITLAB_CLIENT_SECRET as string,
      discoveryUrl: `${gitlabBaseURL}/.well-known/openid-configuration`,
      scopes: ProviderScopes.gitlab
    }
  }
});
