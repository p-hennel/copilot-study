/**
 * Example usage of the Bun Settings Manager
 */
import { z } from "zod";
import { SettingsManager, createSettingsManager, getSettings } from "./bun-settings-lib"; 

// 1. Basic usage - get default settings
const defaultSettings = getSettings();
console.log("Data root:", defaultSettings.paths.dataRoot);

// 2. Custom schema with application-specific settings
const appSettingsSchema = z.object({
  app: z.object({
    name: z.string().default("My Bun Application"),
    version: z.string().default("1.0.0"),
    port: z.number().int().positive().default(3000),
    features: z.object({
      enableLogging: z.boolean().default(true),
      maxWorkers: z.number().int().positive().default(4),
      theme: z.enum(["light", "dark", "system"]).default("system"),
    }).default({}),
  }).default({}),
  
  // Extend with all the default settings
  paths: z.object({
    dataRoot: z.string(),
    config: z.string(),
    database: z.string(),
    archive: z.string(), 
    logs: z.string(),
    assets: z.string().default("./assets"), // Add custom path
  }).default({}),
  
  // Rest of default settings structure...
  hashing: z.object({
    algorithm: z.enum([
      "sha256", "sha512", "blake2b512", "md5"
    ]).default("sha256"),
    hmacKey: z.string().optional(),
  }).default({}),
  
  auth: z.object({
    // Simplified for example
    secret: z.string().optional(),
    trustedOrigins: z.array(z.string()).default(["http://localhost:3000"]),
  }).default({}),
});

type AppSettings = z.infer<typeof appSettingsSchema>;

// Create a type-safe settings manager for app settings
const appSettings = createSettingsManager<AppSettings>(appSettingsSchema, {
  filename: "app-settings.yaml",
  autoCreate: true,
  logLevel: "info"
});

// 3. Using the settings
const settings = appSettings.getSettings();
console.log(`Starting ${settings.app.name} v${settings.app.version} on port ${settings.app.port}`);

// 4. Getting specific settings with path and default value
const maxWorkers = appSettings.get("app.features.maxWorkers", 2);
console.log(`Using ${maxWorkers} workers`);

// 5. Updating settings
appSettings.set("app.features.theme", "dark");
console.log(`Theme set to: ${appSettings.get("app.features.theme")}`);

// 6. Listen for setting changes 
const unsubscribe = appSettings.onChange((event) => {
  console.log("Settings changed:", event);
  
  // Reload services or apply changes as needed
  if (event.currentSettings.app?.port !== event.previousSettings.app?.port) {
    console.log("Port changed - server restart required");
  }
});

// 7. Later, to stop listening for changes
// unsubscribe();

// 8. Working with multiple settings files
const configSettings = SettingsManager.getInstance({
  filename: "config.yaml",
  autoCreate: true
});

// 9. Update multiple settings at once
appSettings.updateSettings({
  app: {
    ...settings.app,
    features: {
      ...settings.app.features,
      enableLogging: false,
      maxWorkers: 8
    }
  }
});

// 10. Force reload settings from file
appSettings.reload();

// Example for handling environment-specific configurations
const env = Bun.env.NODE_ENV || "development";
const envSettings = SettingsManager.getInstance({
  filename: `settings.${env}.yaml`,
  autoCreate: true
});

// Using the API to build complex app configurations
function initializeApp() {
  const settings = appSettings.getSettings();
  
  // Configure logging
  if (settings.app.features.enableLogging) {
    // Setup logging with path from settings
    console.log(`Setting up logs at ${settings.paths.logs}`);
  }
  
  // Set up database
  console.log(`Connecting to database at ${settings.paths.database}`);
  
  // And so on...
}

initializeApp();