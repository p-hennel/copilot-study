// src/settings.ts
import { z } from 'zod';
import { createSettingsManager } from '../settings';

// Export the type for the supervisor to use
export type SupervisorConfig = z.infer<typeof supervisorConfigSchema>;
export type ProcessConfig = z.infer<typeof processConfigSchema>;

// Process configuration schema
const processConfigSchema = z.object({
  id: z.string().min(1),
  script: z.string().min(1),
  args: z.array(z.string()).optional(),
  autoRestart: z.boolean().default(true),
  restartDelay: z.number().int().positive().optional(),
  maxRestarts: z.number().int().positive().optional(),
  dependencies: z.array(z.string()).optional(),
  subscribeToHeartbeats: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});

// Main supervisor configuration schema
const supervisorConfigSchema = z.object({
  socketPath: z.string().default('/tmp/supervisor.sock'),
  processes: z.array(processConfigSchema),
  heartbeatInterval: z.number().int().positive().default(5000),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  logFile: z.string().optional(),
  logPrefix: z.string().optional(),
  
  // Additional settings for enhanced operation
  enableHotReload: z.boolean().default(false),
  monitoringPort: z.number().int().positive().default(9090),
  enableMonitoring: z.boolean().default(false),
  maxMessageSize: z.number().int().positive().default(1024 * 1024), // 1MB
  maxQueueLength: z.number().int().positive().default(1000),
  stateFile: z.string().optional(),
  stateSaveInterval: z.number().int().positive().default(30000), // 30 seconds
  
  // Circuit breaker settings
  circuitBreaker: z.object({
    failureThreshold: z.number().int().positive().default(5),
    failureWindow: z.number().int().positive().default(60000), // 1 minute
    resetTimeout: z.number().int().positive().default(300000), // 5 minutes
  }).default({}),
  
  // Logging settings
  logging: z.object({
    directory: z.string().default('./logs'),
    processLogs: z.boolean().default(true),
    supervisorLog: z.string().optional(),
    rotateSize: z.number().int().positive().default(10 * 1024 * 1024), // 10MB
    maxFiles: z.number().int().positive().default(5)
  }).default({}),
});

// Helper function to determine the state file path

// Create and export the settings manager
export const supervisorSettings = createSettingsManager<SupervisorConfig>(
  supervisorConfigSchema,
  {
    filename: 'supervisor.yaml',
    autoCreate: true,
    watchForChanges: true,
    logLevel: 'info'
  }
);

// Helper function to get the supervisor configuration
export function getSettings(): SupervisorConfig {
  return supervisorSettings.getSettings();
}

// Helper to validate a configuration file without loading it
export function validateConfig(config: any): { 
  valid: boolean; 
  errors?: string[];
  config?: SupervisorConfig;
} {
  try {
    const validatedConfig = supervisorConfigSchema.parse(config);
    return { valid: true, config: validatedConfig };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.errors.map(err => 
        `${err.path.join('.')}: ${err.message}`
      );
      return { valid: false, errors };
    }
    return { valid: false, errors: [(error as Error).message] };
  }
}

// Re-export the settings manager for use in other modules
export default supervisorSettings;