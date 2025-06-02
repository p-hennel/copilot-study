/**
 * Settings Manager for Bun Applications
 *
 * A TypeScript library for managing application settings via YAML files
 * with automatic validation, file watching, and structured access.
 */

import { existsSync, readFileSync, writeFileSync, watch, type FSWatcher } from "node:fs";
import { resolve, join } from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { getLogger } from "@logtape/logtape";

/**
 * Path resolution functions to locate settings files
 */
export class PathResolver {
  /**
   * Find settings file in local project directories
   */
  static getLocalSettingsFilePath(filename = "settings.yaml"): string | undefined {
    const candidates = [
      resolve(process.cwd(), "config", filename),
      resolve(process.cwd(), filename)
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    return undefined;
  }

  /**
   * Find settings file in home directory
   */
  static getHomeSettingsFilePath(filename = "settings.yaml"): string {
    const homeDataDir = PathResolver.getHomeDataPath();
    const candidate = resolve(homeDataDir, filename);

    if (existsSync(candidate)) {
      return candidate;
    }

    // Fallback to local
    const localPath = PathResolver.getLocalSettingsFilePath(filename);
    return localPath || candidate;
  }

  /**
   * Get home data directory
   */
  static getHomeDataPath(): string {
    const candidates = [resolve(join("home", "bun", "data")), resolve(process.cwd(), "data")];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    return candidates[0] ?? ""; // Default to first option
  }

  /**
   * Resolve settings file path using environment variables and fallbacks
   */
  static getSettingsFilePath(filename = "settings.yaml"): string {
    // Check environment variables
    const envPath = Bun.env.SETTINGS_FILE || process.env.SETTINGS_FILE;
    if (envPath && envPath.length > 0 && existsSync(envPath)) {
      return envPath;
    }

    // Try home directory
    const homePath = PathResolver.getHomeSettingsFilePath(filename);
    if (existsSync(homePath)) {
      return homePath;
    }

    // Try local directory
    const localPath = PathResolver.getLocalSettingsFilePath(filename);
    return localPath || homePath;
  }

  /**
   * Get data root directory
   */
  static getDataRoot(): string {
    const envDataPath = Bun.env.DATA_ROOT || process.env.DATA_ROOT;
    if (envDataPath && envDataPath.length > 0 && existsSync(envDataPath)) {
      return envDataPath;
    }

    return PathResolver.getHomeDataPath();
  }
}

/**
 * Default settings schema
 * This can be extended or replaced by applications
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
  app: z.record(z.unknown()).default({})
});

// Export the default settings type
export type DefaultSettings = z.infer<typeof defaultSettingsSchema>;

// Event types for settings changes
export type SettingsChangeEvent = {
  previousSettings: unknown;
  currentSettings: unknown;
  path?: string[]; // Path to the changed setting
};

// Settings manager options
export interface SettingsManagerOptions<T> {
  filePath?: string;
  filename?: string;
  schema?: z.ZodSchema<T>;
  watchForChanges?: boolean;
  autoCreate?: boolean;
  logLevel?: "none" | "error" | "warn" | "info" | "debug";
}

/**
 * Settings Manager class
 * Manages loading, saving, and watching settings files
 */
export class SettingsManager<T = DefaultSettings> {
  private static instances: Map<string, SettingsManager<any>> = new Map();

  private settings: T;
  private readonly filePath: string;
  private readonly schema: z.ZodSchema<T>;
  private isWriting: boolean = false;
  private watcher: FSWatcher | null = null;
  private changeListeners: Array<(event: SettingsChangeEvent) => void> = [];
  private logLevel: "none" | "error" | "warn" | "info" | "debug";
  private logger: ReturnType<typeof getLogger>;

  /**
   * Private constructor - use getInstance() instead
   */
  private constructor(options: SettingsManagerOptions<T>) {
    this.schema = options.schema || (defaultSettingsSchema as unknown as z.ZodSchema<T>);
    this.logLevel = options.logLevel || "info";

    // Initialize logger
    this.logger = getLogger("SettingsManager");

    // Resolve file path
    if (options.filePath) {
      this.filePath = options.filePath;
    } else {
      const filename = options.filename || "settings.yaml";
      this.filePath = PathResolver.getSettingsFilePath(filename);

      // Create default settings file if it doesn't exist and autoCreate is true
      if (options.autoCreate && !existsSync(this.filePath)) {
        const defaultSettings = this.schema.parse({});
        writeFileSync(this.filePath, yaml.dump(defaultSettings), "utf8");
        this.log("info", `Created default settings file at ${this.filePath}`);
      }
    }

    if (!existsSync(this.filePath)) {
      throw new Error(`Settings file not found at ${this.filePath}`);
    }

    // Read and parse initial settings
    try {
      const fileContents = readFileSync(this.filePath, "utf8");
      const data = yaml.load(fileContents);
      this.settings = this.schema.parse(data);
      this.log("info", `Loaded settings from ${this.filePath}`);
    } catch (error) {
      this.log("error", `Failed to load settings from ${this.filePath}:`, error);
      throw new Error(
        `Failed to load settings: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Start watching file for changes if enabled
    if (options.watchForChanges !== false) {
      this.startWatching();
    }
  }

  /**
   * Get a singleton instance of the settings manager
   */
  public static getInstance<S>(options: SettingsManagerOptions<S> = {}): SettingsManager<S> {
    const key = options.filePath || options.filename || "default";

    if (!this.instances.has(key)) {
      this.instances.set(key, new SettingsManager<S>(options));
    }

    return this.instances.get(key) as SettingsManager<S>;
  }

  /**
   * Start watching the settings file for changes
   */
  private startWatching(): void {
    try {
      // Close existing watcher if any
      this.stopWatching();

      this.watcher = watch(this.filePath, (eventType) => {
        if (eventType === "change") {
          this.reloadSettings();
        }
      });

      this.watcher.on("error", (error) => {
        this.log("error", `Error watching settings file ${this.filePath}:`, error);
        this.watcher = null;

        // Retry watching after delay
        setTimeout(() => this.startWatching(), 5000);
      });

      this.log("info", `Watching settings file: ${this.filePath}`);
    } catch (error) {
      this.log("error", `Failed to start watching settings file ${this.filePath}:`, error);
      this.watcher = null;
    }
  }

  /**
   * Stop watching the settings file
   */
  public stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      this.log("debug", "Stopped watching settings file");
    }
  }

  /**
   * Reload settings from file
   */
  private reloadSettings(): void {
    if (this.isWriting) {
      this.log("debug", "Skipping reload during write operation");
      return;
    }

    this.log("info", `Settings file ${this.filePath} changed, reloading...`);

    try {
      const fileContents = readFileSync(this.filePath, "utf8");
      const data = yaml.load(fileContents);
      const previousSettings = { ...this.settings };
      this.settings = this.schema.parse(data);

      this.log("info", "Settings reloaded successfully");

      // Notify listeners
      this.notifyChangeListeners({
        previousSettings,
        currentSettings: this.settings
      });
    } catch (error) {
      this.log("error", "Error reloading settings file:", error);
      // Keep using previous settings
    }
  }

  /**
   * Get the current settings
   */
  public getSettings(): T {
    return this.settings;
  }

  /**
   * Get a specific setting by path
   * @param path - Path to the setting (e.g., 'auth.providers.gitlab.baseUrl')
   * @param defaultValue - Default value if path doesn't exist
   */
  public get<R>(path: string, defaultValue?: R): R {
    const parts = path.split(".");
    let current: any = this.settings;

    for (const part of parts) {
      if (current === undefined || current === null || typeof current !== "object") {
        return defaultValue as R;
      }
      current = current[part];
    }

    return (current === undefined ? defaultValue : current) as R;
  }

  /**
   * Update settings with partial values
   */
  public updateSettings(newSettings: Partial<T>): void {
    this.isWriting = true;

    try {
      const previousSettings = { ...this.settings };
      // Merge the current settings with the new values
      const updated = { ...this.settings, ...newSettings };
      // Validate the updated settings
      this.settings = this.schema.parse(updated);

      // Convert to YAML and save
      const yamlStr = yaml.dump(this.settings);
      writeFileSync(this.filePath, yamlStr, "utf8");

      this.log("info", "Settings updated and saved");

      // Notify listeners
      this.notifyChangeListeners({
        previousSettings,
        currentSettings: this.settings
      });
    } catch (error) {
      this.log("error", "Error updating settings:", error);
      throw new Error(
        `Failed to update settings: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      // Reset writing flag after a short delay
      setTimeout(() => {
        this.isWriting = false;
      }, 100);
    }
  }

  /**
   * Set a specific setting by path
   * @param path - Path to the setting (e.g., 'auth.providers.gitlab.baseUrl')
   * @param value - Value to set
   */
  public set<V>(path: string, value: V): void {
    const parts = path.split(".");
    const lastPart = parts.pop();

    if (!lastPart) {
      throw new Error("Invalid path");
    }

    // Create a deep copy of settings
    const newSettings = structuredClone(this.settings);
    let current: any = newSettings;

    // Navigate to the parent object
    for (const part of parts) {
      if (current[part] === undefined) {
        current[part] = {};
      }
      current = current[part];

      if (typeof current !== "object" || current === null) {
        throw new Error(`Cannot set ${path}: path traversal failed at ${part}`);
      }
    }

    // Set the value
    current[lastPart] = value;

    // Update and save
    this.updateSettings(newSettings);
  }

  /**
   * Add a listener for settings changes
   */
  public onChange(listener: (event: SettingsChangeEvent) => void): () => void {
    this.changeListeners.push(listener);

    // Return unsubscribe function
    return () => {
      this.changeListeners = this.changeListeners.filter((l) => l !== listener);
    };
  }

  /**
   * Notify all change listeners
   */
  private notifyChangeListeners(event: SettingsChangeEvent): void {
    for (const listener of this.changeListeners) {
      try {
        listener(event);
      } catch (error) {
        this.log("error", "Error in settings change listener:", error);
      }
    }
  }

  /**
   * Get the settings file path
   */
  public getFilePath(): string {
    return this.filePath;
  }

  /**
   * Force reload settings from file
   */
  public reload(): void {
    this.reloadSettings();
  }

  /**
   * Reset settings to default values
   */
  public resetToDefaults(): void {
    const defaultSettings = this.schema.parse({});
    this.updateSettings(defaultSettings as Partial<T>);
  }

  /**
   * Internal logging with level filtering using logtape
   */
  private log(level: "error" | "warn" | "info" | "debug", ...args: any[]): void {
    const levels = { none: 0, error: 1, warn: 2, info: 3, debug: 4 };

    if (levels[this.logLevel] >= levels[level]) {
      const message = args.shift() || "";

      switch (level) {
        case "error":
          this.logger.error(message, ...args);
          break;
        case "warn":
          this.logger.warn(message, ...args);
          break;
        case "info":
          this.logger.info(message, ...args);
          break;
        case "debug":
          this.logger.debug(message, ...args);
          break;
      }
    }
  }
}

/**
 * Default export - A convenience function to get the singleton instance with default settings
 */
export default function getSettings<T = DefaultSettings>(
  options: SettingsManagerOptions<T> = {}
): T {
  return SettingsManager.getInstance<T>(options).getSettings();
}

/**
 * Helper function to create a type-safe settings hook for your application
 */
export function createSettingsManager<T>(
  schema: z.ZodSchema<T>,
  options: Omit<SettingsManagerOptions<T>, "schema"> = {}
) {
  return SettingsManager.getInstance<T>({ ...options, schema });
}
