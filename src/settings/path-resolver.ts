/**
 * Path resolution utilities for finding settings files
 */

import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { getLogger } from "@logtape/logtape";

const logger = getLogger("PathResolver");

/**
 * Utilities for resolving file paths for settings
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
        logger.debug(`Found local settings file at ${candidate}`);
        return candidate;
      }
    }

    logger.debug("No local settings file found");
    return undefined;
  }

  /**
   * Find settings file in home directory
   */
  static getHomeSettingsFilePath(filename = "settings.yaml"): string {
    const homeDataDir = PathResolver.getHomeDataPath();
    const candidate = resolve(homeDataDir, filename);

    if (existsSync(candidate)) {
      logger.debug(`Found home settings file at ${candidate}`);
      return candidate;
    }

    // Fallback to local
    const localPath = PathResolver.getLocalSettingsFilePath(filename);
    if (localPath) {
      return localPath;
    }

    logger.debug(`Using default home settings path ${candidate} (file does not exist yet)`);
    return candidate;
  }

  /**
   * Get home data directory
   */
  static getHomeDataPath(): string {
    const candidates = [resolve(join("home", "bun", "data")), resolve(process.cwd(), "data")];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        logger.debug(`Found data directory at ${candidate}`);
        return candidate;
      }
    }

    logger.debug(`Using default data path ${candidates[0]} (directory does not exist yet)`);
    return candidates[0] ?? ""; // Default to first option
  }

  /**
   * Resolve settings file path using environment variables and fallbacks
   */
  static getSettingsFilePath(filename = "settings.yaml"): string {
    // Check environment variables
    const envPath = Bun.env.SETTINGS_FILE || process.env.SETTINGS_FILE;
    if (envPath && envPath.length > 0 && existsSync(envPath)) {
      logger.debug(`Using settings file from environment variable: ${envPath}`);
      return envPath;
    }

    // Try home directory
    const homePath = PathResolver.getHomeSettingsFilePath(filename);
    if (existsSync(homePath)) {
      logger.debug(`Using settings file from home directory: ${homePath}`);
      return homePath;
    }

    // Try local directory
    const localPath = PathResolver.getLocalSettingsFilePath(filename);
    if (localPath) {
      logger.debug(`Using settings file from local directory: ${localPath}`);
      return localPath;
    }

    logger.debug(`No existing settings file found, defaulting to ${homePath}`);
    return homePath;
  }

  /**
   * Get data root directory
   */
  static getDataRoot(): string {
    const envDataPath = Bun.env.DATA_ROOT || process.env.DATA_ROOT;
    if (envDataPath && envDataPath.length > 0 && existsSync(envDataPath)) {
      logger.debug(`Using data root from environment variable: ${envDataPath}`);
      return envDataPath;
    }

    const homePath = PathResolver.getHomeDataPath();
    logger.debug(`Using default data root: ${homePath}`);
    return homePath;
  }
}
