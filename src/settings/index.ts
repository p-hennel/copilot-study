/**
 * Bun Settings Manager
 * 
 * A TypeScript library for managing application settings via YAML files
 * with automatic validation, file watching, and structured access.
 */

// Re-export everything from the main module
export * from './settings-manager';

// Default export for simplified usage
import defaultGetSettings from './settings-manager';
export default defaultGetSettings;