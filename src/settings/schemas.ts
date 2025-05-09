/**
 * Default schema definitions for settings
 */

import { z } from "zod";
import { join } from "node:path";
import { PathResolver } from "./path-resolver.ts";

/**
 * Default settings schema with common configuration options
 * Applications can extend or replace this schema
 */
export const defaultSettingsSchema = z.object({
  paths: z
    .object({
      dataRoot: z.string().default(PathResolver.getDataRoot()),
      config: z.string().default(join(PathResolver.getDataRoot(), "config")),
      database: z
        .string()
        .default(`file://${join(PathResolver.getDataRoot(), "config", "main.db")}`),
      archive: z.string().default(join(PathResolver.getDataRoot(), "archive")),
      logs: z.string().default(join(PathResolver.getDataRoot(), "logs"))
    })
    .default({}),

  hashing: z
    .object({
      algorithm: z
        .enum([
          "sha256",
          "sha512",
          "blake2b512",
          "md5",
          "sha1",
          "sha224",
          "sha384",
          "sha512-224",
          "sha512-256"
        ])
        .default("sha256"),
      hmacKey: z.string().optional()
    })
    .default({}),

  auth: z
    .object({
      initCode: z
        .string()
        .default(process.env.INIT_CODE || "aVNEpnVwsutCH5sq4HGuQCyoFRFh7ifneoiZogrpV2EoLRsc"),
      secret: z.string().optional(),
      trustedOrigins: z
        .array(z.string())
        .default(["http://localhost:3000", "http://localhost:4173", "http://localhost:5173"]),
      trustedProviders: z.array(z.string()).default(["gitlab", "jira"]),
      allowDifferentEmails: z.boolean().default(true),
      admins: z
        .array(
          z.object({
            email: z.string().email(),
            name: z.string().optional()
          })
        )
        .default([]),
      providers: z
        .object({
          gitlab: z
            .object({
              baseUrl: z.string().default("https://gitlab.com"),
              clientId: z.string().optional(),
              clientSecret: z.string().optional(),
              discoveryUrl: z.string().optional(),
              scopes: z
                .array(z.string())
                .default(["read:jira-work", "read:jira-user", "read:me", "read:account"]),
              redirectURI: z.string().default("/api/auth/oauth2/callback/gitlab")
            })
            .default({}),
          jiracloud: z
            .object({
              baseUrl: z.string().default("https://api.atlassian.com"),
              clientId: z.string().optional(),
              clientSecret: z.string().optional(),
              authorizationUrl: z.string().default("https://auth.atlassian.com/authorize"),
              authorizationUrlParams: z
                .record(z.string())
                .default({ audience: "api.atlassian.com" }),
              tokenUrl: z.string().default("https://auth.atlassian.com/oauth/token"),
              scopes: z
                .array(z.string())
                .default(["read:jira-work", "read:jira-user", "read:me", "read:account"]),
              redirectURI: z.string().default("/api/auth/oauth2/callback/jiracloud"),
              accessibleResourcesUrl: z
                .string()
                .default("https://api.atlassian.com/oauth/token/accessible-resources")
            })
            .default({}),
          jira: z
            .object({
              baseUrl: z.string().default("https://api.atlassian.com"),
              clientId: z.string().optional(),
              clientSecret: z.string().optional(),
              authorizationUrl: z.string().default("/authorize"),
              authorizationUrlParams: z
                .record(z.string())
                .default({ audience: "api.atlassian.com" }),
              tokenUrl: z.string().default("/oauth/token"),
              scopes: z
                .array(z.string())
                .default(["read:jira-work", "read:jira-user", "read:me", "read:account"]),
              redirectURI: z.string().default("/api/auth/oauth2/callback/jira"),
              accessibleResourcesUrl: z
                .string()
                .default("https://api.atlassian.com/oauth/token/accessible-resources")
            })
            .default({})
        })
        .default({})
    })
    .default({}),

  // For custom app settings, extend the schema
  app: z
    .object({
      CRAWLER_API_TOKEN: z
        .string()
        .default(
          process.env.CRAWLER_API_TOKEN ||
            "nLR6HdQXYwpehaQxGRsoZUZmFTje3m4BVwPZRNSkEqYurTmNzxsphvMWQfX3SXNA"
        )
    })
    .default({})
});

/**
 * Simple schema with minimal defaults
 * Useful for lightweight applications
 */
export const minimalSettingsSchema = z.object({
  paths: z
    .object({
      dataRoot: z.string().default(PathResolver.getDataRoot()),
      config: z.string().default(join(PathResolver.getDataRoot(), "config"))
    })
    .default({}),
  app: z.record(z.unknown()).default({})
});

/**
 * Helper function to extend the default schema with application-specific settings
 * @param appSchema Application-specific schema as a Zod object schema
 * @returns Extended schema
 */
export function extendDefaultSchema<T extends z.ZodRawShape>(appSchema: T) {
  return defaultSettingsSchema.extend(appSchema);
}
