import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { z } from 'zod';
import path from 'node:path';

const dataRoot = path.resolve(process.env.NODE_ENV === "development" ? "./" : path.join("/", "home", "bun", "data"))

// Define the Zod schema for your settings, including nested or array structures if needed.
const settingsSchema = z.object({
  paths: z.object({
    dataRoot: z.string().nonempty().default(dataRoot),
    config: z.string().nonempty().default(path.join(dataRoot, "config")),
    database: z.string().nonempty().default(`file://${path.join(dataRoot, "config", "main.db")}`),
    archive: z.string().nonempty().default(path.join(dataRoot, "archive")),
    logs: z.string().nonempty().default(path.join(dataRoot, "logs")),
  }).default({}),
  hashing: z.object({
    algorithm: z.enum(["sha256", "sha512", "blake2b512", "md5", "sha1", "sha224", "sha384", "sha512-224", "sha512-256"]).default("sha256"),
    hmacKey: z.string().nonempty().optional(),
  }).default({}),
  auth: z.object({
    initCode: z.string().nonempty().default(process.env.INIT_CODE ?? "aVNEpnVwsutCH5sq4HGuQCyoFRFh7ifneoiZogrpV2EoLRsc"),
    secret: z.string().optional(),
    trustedOrigins: z.array(z.string().nonempty()).default(["http://localhost:3000", "http://localhost:4173", "http://localhost:5173"]),
    trustedProviders: z.array(z.string().nonempty()).default(["gitlab", "jira"]),
    allowDifferentEmails: z.boolean().default(true),
    admins: z.array(z.object({
      email: z.string().email(),
      name: z.string().optional(),
    })).default([]),
    providers: z.object({
      gitlab: z.object({
        baseUrl: z.string().nonempty().default("https://gitlab.com"),
        clientId: z.string().optional(),
        clientSecret: z.string().optional(),
        discoveryUrl: z.string().optional(),
        scopes: z.array(z.string()).default(["read:jira-work", "read:jira-user", "read:me", "read:account"]),
        redirectURI: z.string().default("/api/auth/oauth2/callback/gitlab"),
      }).default({}),
      jiracloud: z.object({
        baseUrl: z.string().nonempty().default("https://api.atlassian.com"),
        clientId: z.string().optional(),
        clientSecret: z.string().optional(),
        authorizationUrl: z.string().default("https://auth.atlassian.com/authorize"),
        authorizationUrlParams: z.record(z.string()).default({ audience: "api.atlassian.com" }),
        tokenUrl: z.string().default("https://auth.atlassian.com/oauth/token"),
        scopes: z.array(z.string()).default(["read:jira-work", "read:jira-user", "read:me", "read:account"]),
        redirectURI: z.string().default("/api/auth/oauth2/callback/jiracloud"),
        accessibleResourcesUrl: z.string().default("https://api.atlassian.com/oauth/token/accessible-resources"),
      }).default({}),
      jira: z.object({
        baseUrl: z.string().nonempty().default("https://api.atlassian.com"),
        clientId: z.string().optional(),
        clientSecret: z.string().optional(),
        authorizationUrl: z.string().default("/authorize"),
        authorizationUrlParams: z.record(z.string()).default({ audience: "api.atlassian.com" }),
        tokenUrl: z.string().default("/oauth/token"),
        scopes: z.array(z.string()).default(["read:jira-work", "read:jira-user", "read:me", "read:account"]),
        redirectURI: z.string().default("/api/auth/oauth2/callback/jira"),
        accessibleResourcesUrl: z.string().default("https://api.atlassian.com/oauth/token/accessible-resources"),
      }).default({}),
    }).default({}),
  }).default({})
  // For nested settings, you might add something like:
  // nestedConfig: z.object({
  //   enabled: z.boolean(),
  //   values: z.array(z.string()),
  // }),
});

export type Settings = z.infer<typeof settingsSchema>;

class AppSettings {
  // The singleton instance.
  private static instance: AppSettings;
  private settings: Settings;
  private readonly filePath: string;

  // Private constructor to enforce singleton pattern.
  private constructor(filePath: string) {
    this.filePath = filePath;
    // Read and parse the YAML file synchronously.
    const fileContents = readFileSync(this.filePath, 'utf8');
    const data = yaml.load(fileContents);
    // Validate the parsed data with Zod.
    this.settings = settingsSchema.parse(data);
  }

  /**
   * Gets the singleton instance of AppSettings.
   * On first call, the file path must be provided.
   *
   * @param filePath - The path to the YAML settings file.
   * @returns The AppSettings instance.
   */
  public static getInstance(filePath?: string): AppSettings {
    if (!AppSettings.instance) {
      if (!filePath || filePath.length <= 0)
        filePath = process.env.SETTINGS_FILE ?? (process.env.NODE_ENV === "development" ? "settings.yaml" : "/home/bun/data/settings.yaml")
      if (!filePath || filePath.length <= 0) {
        throw new Error('First-time initialization requires a file path.');
      }
      if (!existsSync(filePath)) {
        const temp = settingsSchema.parse({})
        console.log("temp", temp)
        console.log("yaml", yaml.dump(temp))
        writeFileSync(filePath, yaml.dump(temp), 'utf8');
      }
      AppSettings.instance = new AppSettings(filePath);
    }
    return AppSettings.instance;
  }

  /**
   * Returns the current settings.
   *
   * @returns The current settings.
   */
  public getSettings(): Settings {
    return this.settings;
  }

  /**
   * Updates the settings with the provided partial values, validates the updated settings,
   * and writes them back to the YAML file.
   *
   * @param newSettings - Partial settings to update.
   */
  public updateSettings(newSettings: Partial<Settings>): void {
    // Merge the current settings with the new values.
    const updated = { ...this.settings, ...newSettings };
    // Validate the updated settings.
    this.settings = settingsSchema.parse(updated);
    // Convert the updated settings back to YAML format.
    const yamlStr = yaml.dump(this.settings);
    writeFileSync(this.filePath, yamlStr, 'utf8');
  }
}

export default AppSettings.getInstance().getSettings() as Settings;