import { betterAuth, type User } from "better-auth"
import { admin } from "better-auth/plugins"
import { apiKey } from "better-auth/plugins"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { db } from "./server/db/index"
import { eq, count } from "drizzle-orm" // Import count
import { jwt } from "better-auth/plugins"
import * as schema from "./server/db/schema"
import { genericOAuth } from "better-auth/plugins"
import { type OAuth2Tokens } from "better-auth/oauth2"
import AppSettings from "./server/settings" // Use named import
import { getLogger } from "$lib/logging" // Import logtape helper

const logger = getLogger(["backend", "auth"]) // Logger for this module

// Get settings instance
const settings = AppSettings()

// Define simple interfaces for expected Jira API responses
interface JiraUserResponse {
  emailAddress?: string
  displayName?: string
  // Add other fields if needed
}

interface JiraAccessibleResource {
  id: string // Expecting at least an ID
  // Add other fields if needed
}

export const getJiraAccountInfo = async (
  cloudId: string,
  headers: HeadersInit,
  accountId?: string,
  retriesLeft: number = 0
): Promise<User | null> => {
  const response = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/user?accountId=${accountId}`, {
    method: "GET",
    headers: headers
  })

  if (!accountId) accountId = response.headers.get("X-AACCOUNTID") ?? undefined

  if (response.ok) {
    // Assert the type of the JSON response
    const data = (await response.json()) as JiraUserResponse
    return {
      id: accountId,
      email: data.emailAddress ?? "", // Use nullish coalescing for safety
      emailVerified: true,
      name: data.displayName ?? "" // Use nullish coalescing for safety
      //createdAt: new Date(),
      //updatedAt: new Date()
    } as User
  } else {
    return retriesLeft > 0 ? await getJiraAccountInfo(cloudId, headers, accountId, retriesLeft - 1) : null
  }
}

export const getUserFromJiraCloud = async (tokens: OAuth2Tokens): Promise<User | null> => {
  return _getUserFromJira(AppSettings().auth.providers.jiracloud.accessibleResourcesUrl, tokens)
}
export const getUserFromJira = async (tokens: OAuth2Tokens): Promise<User | null> => {
  return _getUserFromJira(AppSettings().auth.providers.jira.accessibleResourcesUrl, tokens)
}
const _getUserFromJira = async (url: string, tokens: OAuth2Tokens): Promise<User | null> => {
  const headers: HeadersInit = new Headers()
  headers.set("Accept", "application/json")
  headers.set("Authorization", `Bearer ${tokens.accessToken}`)

  const response = await fetch(url, {
    method: "GET",
    headers: headers
  })

  // Assert the type of the JSON response (expecting an array)
  const accessibleResources = (await response.json()) as JiraAccessibleResource[]
  const cloudId = accessibleResources?.[0]?.id // Use optional chaining
  const accountId = response.headers.get("X-AACCOUNTID") ?? undefined

  // Ensure cloudId was found before proceeding
  if (!cloudId) {
    logger.error("Could not determine cloudId from accessible resources for Jira user.")
    return null
  }

  return getJiraAccountInfo(cloudId, headers, accountId, 2)
}

export const auth = betterAuth({
  trustedOrigins: settings.auth.trustedOrigins,
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: schema
  }),
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: settings.auth.trustedProviders,
      allowDifferentEmails: settings.auth.allowDifferentEmails
    }
  },
  plugins: [
    admin(),
    jwt(),
    apiKey(),
    genericOAuth({
      config: [
        {
          providerId: "gitlab-onprem",
          clientId: settings.auth.providers.gitlab.clientId!, // Add non-null assertion
          clientSecret: settings.auth.providers.gitlab.clientSecret!, // Add non-null assertion
          authorizationUrl: settings.auth.providers.gitlab.authorizationUrl,
          tokenUrl: settings.auth.providers.gitlab.tokenUrl,
          userInfoUrl:  settings.auth.providers.gitlab.userInfoUrl,
          scopes: settings.auth.providers.gitlab.scopes,
          redirectURI: settings.auth.providers.gitlab.redirectURI,
        },
        {
          providerId: "jiracloud",
          clientId: settings.auth.providers.jiracloud.clientId!, // Add non-null assertion
          clientSecret: settings.auth.providers.jiracloud.clientSecret!, // Add non-null assertion
          authorizationUrl: settings.auth.providers.jiracloud.authorizationUrl,
          authorizationUrlParams: settings.auth.providers.jiracloud.authorizationUrlParams,
          tokenUrl: settings.auth.providers.jiracloud.tokenUrl,
          scopes: settings.auth.providers.jiracloud.scopes,
          redirectURI: settings.auth.providers.jiracloud.redirectURI,
          getUserInfo: getUserFromJiraCloud
        },
        {
          providerId: "jiralocal",
          clientId: settings.auth.providers.jira.clientId!, // Add non-null assertion
          clientSecret: settings.auth.providers.jira.clientSecret!, // Add non-null assertion
          authorizationUrl: settings.auth.providers.jira.authorizationUrl,
          authorizationUrlParams: settings.auth.providers.jira.authorizationUrlParams,
          tokenUrl: settings.auth.providers.jira.tokenUrl,
          scopes: settings.auth.providers.jira.scopes,
          redirectURI: settings.auth.providers.jira.redirectURI,
          //`${jiraBaseURL}/plugins/servlet/oauth/access-token`,
          //'RSA-SHA1',
          //discoveryUrl: `${jiraBaseURL}/.well-known/openid-configuration`,
          getUserInfo: getUserFromJira
        }
      ]
    })
  ],
  emailAndPassword: {
    enabled: true
  },
  socialProviders: {
    gitlab: {
      authorizationUrl: settings.auth.providers.gitlab.authorizationUrl,
      authorizationUrlParams: settings.auth.providers.gitlab.authorizationUrlParams,
      tokenUrl: settings.auth.providers.gitlab.tokenUrl,
      clientId: settings.auth.providers.gitlab.clientId!, // Add non-null assertion
      clientSecret: settings.auth.providers.gitlab.clientSecret!, // Add non-null assertion
      discoveryUrl: settings.auth.providers.gitlab.discoveryUrl,
      scopes: settings.auth.providers.gitlab.scopes,
      redirectURI: settings.auth.providers.gitlab.redirectURI
    }
  },
  // Add event hooks
  events: {
    onUserCreate: async (user: User) => {
      // Add User type annotation
      logger.info(`User created: ${user.id}, checking if first user...`)
      try {
        // Check if this is the first user
        const userCountResult = await db.select({ value: count() }).from(schema.user)
        const userCount = userCountResult[0]?.value ?? 0

        logger.info(`Current user count: ${userCount}`)
        if (userCount === 1) {
          logger.info(`Promoting user ${user.id} to admin.`)
          await db.update(schema.user).set({ role: "admin" }).where(eq(schema.user.id, user.id))
          logger.info(`Invalidating sessions for user ${user.id} after role promotion.`)
          await auth.api.revokeUserSessions({ body: { userId: user.id } }) // Pass argument as { body: { userId: ... } }
        }
      } catch (error) {
        logger.error("Error during onUserCreate hook:", { error })
      }
    }
  }
})
