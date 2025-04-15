/**
 * Type definitions for the settings manager
 */

import { z } from "zod";
import { defaultSettingsSchema } from "./schemas.ts";

/**
 * Default settings type from the default schema
 */
export type DefaultSettings = z.infer<typeof defaultSettingsSchema>;

/**
 * Event type for settings changes
 */
export interface SettingsChangeEvent {
  /**
   * Previous settings object
   */
  previousSettings: unknown;

  /**
   * Current settings object after the change
   */
  currentSettings: unknown;

  /**
   * Path to the changed setting, if available
   * e.g. ['auth', 'providers', 'gitlab', 'baseUrl']
   */
  path?: string[];
}

/**
 * Configuration options for the settings manager
 */
export interface SettingsManagerOptions<T> {
  /**
   * Absolute path to the settings file
   * If provided, overrides filename
   */
  filePath?: string;

  /**
   * Name of the settings file to use
   * Default: "settings.yaml"
   */
  filename?: string;

  /**
   * Zod schema for validating settings
   * Default: defaultSettingsSchema
   */
  schema?: z.ZodSchema<T>;

  /**
   * Whether to watch for file changes
   * Default: true
   */
  watchForChanges?: boolean;

  /**
   * Whether to automatically create the settings file if it doesn't exist
   * Default: false
   */
  autoCreate?: boolean;

  /**
   * Log level for the settings manager
   * Default: "info"
   */
  logLevel?: "none" | "error" | "warn" | "info" | "debug";
}

/**
 * Interface for recursive partial objects
 * Used for deep partial updates of settings
 */
export type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T;

/**
 * Utils for working with settings objects
 */
export interface SettingsUtils<T> {
  /**
   * Get the current settings
   */
  getSettings(): T;

  /**
   * Get a specific setting by path
   * @param path Path to the setting (e.g., 'auth.providers.gitlab.baseUrl')
   * @param defaultValue Default value if path doesn't exist
   */
  get<R>(path: string, defaultValue?: R): R;

  /**
   * Set a specific setting by path
   * @param path Path to the setting (e.g., 'auth.providers.gitlab.baseUrl')
   * @param value Value to set
   */
  set<V>(path: string, value: V): void;

  /**
   * Update settings with partial values
   * @param newSettings Partial settings to update
   */
  updateSettings(newSettings: DeepPartial<T>): void;

  /**
   * Get the settings file path
   */
  getFilePath(): string;
}

/**
 * Interface for lifecycle operations
 */
export interface SettingsLifecycle {
  /**
   * Force reload settings from file
   */
  reload(): void;

  /**
   * Reset settings to default values
   */
  resetToDefaults(): void;

  /**
   * Stop watching the settings file
   */
  stopWatching(): void;
}

/**
 * Interface for change notification
 */
export interface SettingsChangeNotifier {
  /**
   * Add a listener for settings changes
   * @param listener Callback function for change events
   * @returns Function to remove the listener
   */
  onChange(listener: (event: SettingsChangeEvent) => void): () => void;
}

/**
 * Complete settings manager interface
 */
export interface ISettingsManager<T>
  extends SettingsUtils<T>,
    SettingsLifecycle,
    SettingsChangeNotifier {}
