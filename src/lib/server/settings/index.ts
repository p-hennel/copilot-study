import { existsSync, readFileSync, writeFileSync, watch, type FSWatcher } from "node:fs" // Import watch and FSWatcher
import yaml from "js-yaml"
import { z } from "zod"
import path from "node:path"

const getSettingsFilePath = () => {
  const settingsFilePath = Bun.env.SETTINGS_FILE ?? process.env.SETTINGS_FILE
  if (settingsFilePath && settingsFilePath.length > 0 && existsSync(settingsFilePath)) {
    return settingsFilePath
  }
  if (process.env.NODE_ENV === "development") {
    const candidate = path.resolve(process.cwd(), "config", "settings.yaml")
    if (existsSync(candidate)) {
      return candidate
    } else {
      return path.resolve(process.cwd(), "settings.yaml")
    }
  } else {
    const candidate = path.resolve(path.join(process.env.HOME ?? "~", "data", "settings.yaml"))
    if (existsSync(candidate)) {
      return candidate
    }
    const altCandidate = path.resolve(process.cwd(), "settings.yaml")
    if (existsSync(altCandidate)) {
      return altCandidate
    } else {
      return candidate
    }
  }
}

const dataRoot = path.resolve(
  Bun.env.SETTINGS_PATH ?? (process.env.NODE_ENV === "development" ? "./" : path.join("/", "home", "bun", "data"))
)

// Define the Zod schema for your settings, including nested or array structures if needed.
export const settingsSchema = z.object({
  paths: z
    .object({
      dataRoot: z.string().nonempty().default(dataRoot),
      config: z.string().nonempty().default(path.join(dataRoot, "config")),
      database: z
        .string()
        .nonempty()
        .default(`file://${path.join(dataRoot, "config", "main.db")}`),
      archive: z.string().nonempty().default(path.join(dataRoot, "archive")),
      logs: z.string().nonempty().default(path.join(dataRoot, "logs"))
    })
    .default({}),
  hashing: z
    .object({
      algorithm: z
        .enum(["sha256", "sha512", "blake2b512", "md5", "sha1", "sha224", "sha384", "sha512-224", "sha512-256"])
        .default("sha256"),
      hmacKey: z.string().nonempty().optional()
    })
    .default({}),
  auth: z
    .object({
      initCode: z
        .string()
        .nonempty()
        .default(process.env.INIT_CODE ?? "aVNEpnVwsutCH5sq4HGuQCyoFRFh7ifneoiZogrpV2EoLRsc"),
      secret: z.string().optional(),
      trustedOrigins: z
        .array(z.string().nonempty())
        .default(["http://localhost:3000", "http://localhost:4173", "http://localhost:5173"]),
      trustedProviders: z.array(z.string().nonempty()).default(["gitlab", "jira"]),
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
              baseUrl: z.string().nonempty().default("https://gitlab.com"),
              clientId: z.string().optional(),
              clientSecret: z.string().optional(),
              discoveryUrl: z.string().optional(),
              scopes: z.array(z.string()).default(["read:jira-work", "read:jira-user", "read:me", "read:account"]),
              redirectURI: z.string().default("/api/auth/oauth2/callback/gitlab")
            })
            .default({}),
          jiracloud: z
            .object({
              baseUrl: z.string().nonempty().default("https://api.atlassian.com"),
              clientId: z.string().optional(),
              clientSecret: z.string().optional(),
              authorizationUrl: z.string().default("https://auth.atlassian.com/authorize"),
              authorizationUrlParams: z.record(z.string()).default({ audience: "api.atlassian.com" }),
              tokenUrl: z.string().default("https://auth.atlassian.com/oauth/token"),
              scopes: z.array(z.string()).default(["read:jira-work", "read:jira-user", "read:me", "read:account"]),
              redirectURI: z.string().default("/api/auth/oauth2/callback/jiracloud"),
              accessibleResourcesUrl: z.string().default("https://api.atlassian.com/oauth/token/accessible-resources")
            })
            .default({}),
          jira: z
            .object({
              baseUrl: z.string().nonempty().default("https://api.atlassian.com"),
              clientId: z.string().optional(),
              clientSecret: z.string().optional(),
              authorizationUrl: z.string().default("/authorize"),
              authorizationUrlParams: z.record(z.string()).default({ audience: "api.atlassian.com" }),
              tokenUrl: z.string().default("/oauth/token"),
              scopes: z.array(z.string()).default(["read:jira-work", "read:jira-user", "read:me", "read:account"]),
              redirectURI: z.string().default("/api/auth/oauth2/callback/jira"),
              accessibleResourcesUrl: z.string().default("https://api.atlassian.com/oauth/token/accessible-resources")
            })
            .default({})
        })
        .default({})
    })
    .default({})
  // For nested settings, you might add something like:
  // nestedConfig: z.object({
  //   enabled: z.boolean(),
  //   values: z.array(z.string()),
  // }),
})

export type Settings = z.infer<typeof settingsSchema>

export class AppSettings {
  // The singleton instance.
  private static instance: AppSettings
  private settings: Settings
  private readonly filePath: string
  private isWriting: boolean = false // Flag to prevent reload loop
  private watcher: FSWatcher | null = null // To hold the watcher instance

  // Private constructor to enforce singleton pattern.
  private constructor(filePath: string) {
    this.filePath = filePath
    // Read and parse the YAML file synchronously.
    const fileContents = readFileSync(this.filePath, "utf8")
    const data = yaml.load(fileContents)
    // Validate the parsed data with Zod.
    this.settings = settingsSchema.parse(data)

    // Start watching the file
    this.watchFile()
  }

  // Method to reload settings from file
  private reloadSettings() {
    if (this.isWriting) {
      // console.log("Skipping reload during write operation.");
      return // Don't reload if we are currently writing
    }
    console.log(`Settings file ${this.filePath} changed, reloading...`)
    try {
      const fileContents = readFileSync(this.filePath, "utf8")
      const data = yaml.load(fileContents)
      this.settings = settingsSchema.parse(data)
      console.log("Settings reloaded successfully.")
      // TODO: Optionally notify other parts of the application about the change
    } catch (error) {
      console.error("Error reloading settings file:", error)
      // Keep old settings in case of error? Or throw?
    }
  }

  // Method to setup file watcher
  private watchFile() {
    try {
      // Close existing watcher if any
      this.watcher?.close()

      this.watcher = watch(this.filePath, (eventType) => {
        if (eventType === "change") {
          this.reloadSettings()
        }
      })

      this.watcher.on("error", (error) => {
        console.error(`Error watching settings file ${this.filePath}:`, error)
        // Attempt to restart watcher?
        this.watcher = null // Clear watcher reference
        // Maybe add a delay before retrying watchFile()
      })

      console.log(`Watching settings file: ${this.filePath}`)
    } catch (error) {
      console.error(`Failed to start watching settings file ${this.filePath}:`, error)
      this.watcher = null
    }
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
      if (!filePath || filePath.length <= 0) filePath = getSettingsFilePath()
      if (!filePath || filePath.length <= 0) {
        throw new Error("First-time initialization requires a file path.")
      }
      if (!existsSync(filePath)) {
        const temp = settingsSchema.parse({})
        console.log("temp", temp)
        console.log("yaml", yaml.dump(temp))
        writeFileSync(filePath, yaml.dump(temp), "utf8")
      }
      AppSettings.instance = new AppSettings(filePath)
    }
    return AppSettings.instance
  }

  /**
   * Returns the current settings.
   *
   * @returns The current settings.
   */
  public getSettings(): Settings {
    return this.settings
  }

  /**
   * Updates the settings with the provided partial values, validates the updated settings,
   * and writes them back to the YAML file.
   *
   * @param newSettings - Partial settings to update.
   */
  public updateSettings(newSettings: Partial<Settings>): void {
    this.isWriting = true // Set flag before writing
    try {
      // Merge the current settings with the new values.
      const updated = { ...this.settings, ...newSettings }
      // Validate the updated settings.
      this.settings = settingsSchema.parse(updated)
      // Convert the updated settings back to YAML format.
      const yamlStr = yaml.dump(this.settings)
      writeFileSync(this.filePath, yamlStr, "utf8")
      console.log("Settings updated and saved.")
    } catch (error) {
      console.error("Error updating settings:", error)
      // Optionally re-throw or handle error
    } finally {
      // Ensure flag is reset even if write fails, after a short delay
      // to allow file system events to settle potentially.
      setTimeout(() => {
        this.isWriting = false
      }, 100)
    }
  }
}

export default () => AppSettings.getInstance().getSettings()
