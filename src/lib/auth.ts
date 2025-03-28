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
import AppSettings from "./server/settings";

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

export const getUserFromJiraCloud = async (tokens: OAuth2Tokens): Promise<User | null> => {
  return _getUserFromJira(AppSettings.auth.providers.jiracloud.accessibleResourcesUrl, tokens);
}
export const getUserFromJira = async (tokens: OAuth2Tokens): Promise<User | null> => {
  return _getUserFromJira(AppSettings.auth.providers.jira.accessibleResourcesUrl, tokens);
}
const _getUserFromJira = async (url: string, tokens: OAuth2Tokens): Promise<User | null> => {
  const headers: HeadersInit = new Headers();
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${tokens.accessToken}`);

  const response = await fetch(url, {
    method: "GET",
    headers: headers
  });

  const accessibleResources = await response.json();
  const cloudId = accessibleResources[0].id;
  const accountId = response.headers.get("X-AACCOUNTID") ?? undefined;

  return getJiraAccountInfo(cloudId, headers, accountId, 2);
};

export const auth = betterAuth({
  trustedOrigins: AppSettings.auth.trustedOrigins,
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: schema
  }),
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: AppSettings.auth.trustedProviders,
      allowDifferentEmails: AppSettings.auth.allowDifferentEmails
    }
  },
  plugins: [
    admin(),
    jwt(),
    apiKey(),
    genericOAuth({
      config: [
        {
          providerId: "jiracloud",
          clientId: AppSettings.auth.providers.jiracloud.clientId,
          clientSecret: AppSettings.auth.providers.jiracloud.clientSecret,
          authorizationUrl: AppSettings.auth.providers.jiracloud.authorizationUrl,
          authorizationUrlParams: AppSettings.auth.providers.jiracloud.authorizationUrlParams,
          tokenUrl: AppSettings.auth.providers.jiracloud.tokenUrl,
          scopes: AppSettings.auth.providers.jiracloud.scopes,
          redirectURI: AppSettings.auth.providers.jiracloud.redirectURI,
          getUserInfo: getUserFromJiraCloud
        },
        {
          providerId: "jiralocal",
          clientId: AppSettings.auth.providers.jira.clientId,
          clientSecret: AppSettings.auth.providers.jira.clientSecret,
          authorizationUrl: AppSettings.auth.providers.jira.authorizationUrl,
          authorizationUrlParams: AppSettings.auth.providers.jira.authorizationUrlParams,
          tokenUrl: AppSettings.auth.providers.jira.tokenUrl,
          scopes: AppSettings.auth.providers.jira.scopes,
          redirectURI: AppSettings.auth.providers.jira.redirectURI,
          //`${jiraBaseURL}/plugins/servlet/oauth/access-token`,
          //'RSA-SHA1',
          //discoveryUrl: `${jiraBaseURL}/.well-known/openid-configuration`,
          getUserInfo: getUserFromJira,
        }
      ]
    })
  ],
  emailAndPassword: {
    enabled: true
  },
  socialProviders: {
    gitlab: {
      clientId: AppSettings.auth.providers.gitlab.clientId,
      clientSecret: AppSettings.auth.providers.gitlab.clientSecret,
      discoveryUrl: AppSettings.auth.providers.gitlab.discoveryUrl,
      scopes: AppSettings.auth.providers.gitlab.scopes,
      redirectURI: AppSettings.auth.providers.gitlab.redirectURI
    }
  }
});
