import type { SocketServerConfig } from './types/config.js';
import { getEnvironmentConfig, getConfigFromEnv, mergeConfigs, validateConfig } from './types/config.js';

/**
 * Socket server configuration management
 * 
 * This module provides configuration for the socket communication system,
 * supporting environment-specific settings and runtime configuration updates.
 */

// Get the current environment
const getCurrentEnvironment = (): 'development' | 'test' | 'production' => {
  const env = process.env.NODE_ENV || 'development';
  if (env === 'test' || env === 'production') {
    return env;
  }
  return 'development';
};

// Create the final configuration by merging defaults, environment, and env vars
const createConfiguration = (): SocketServerConfig => {
  const environment = getCurrentEnvironment();
  const envConfig = getEnvironmentConfig(environment);
  const envVarConfig = getConfigFromEnv();
  
  return mergeConfigs(envConfig, envVarConfig);
};

// Export the final configuration
export const SOCKET_CONFIG = createConfiguration();

// Configuration getters for specific aspects
export const getConnectionConfig = () => ({
  socketPath: SOCKET_CONFIG.socketPath,
  host: SOCKET_CONFIG.host,
  port: SOCKET_CONFIG.port,
  backlog: SOCKET_CONFIG.backlog,
  maxConnections: SOCKET_CONFIG.maxConnections,
  connectionTimeout: SOCKET_CONFIG.connectionTimeout,
});

export const getMessageConfig = () => ({
  messageBufferSize: SOCKET_CONFIG.messageBufferSize,
  maxMessageSize: SOCKET_CONFIG.maxMessageSize,
  messageDelimiter: SOCKET_CONFIG.messageDelimiter,
});

export const getHeartbeatConfig = () => ({
  heartbeatInterval: SOCKET_CONFIG.heartbeatInterval,
  heartbeatTimeout: SOCKET_CONFIG.heartbeatTimeout,
  healthCheckInterval: SOCKET_CONFIG.healthCheckInterval,
});

export const getJobConfig = () => ({
  maxConcurrentJobs: SOCKET_CONFIG.maxConcurrentJobs,
  jobQueueSize: SOCKET_CONFIG.jobQueueSize,
  jobTimeout: SOCKET_CONFIG.jobTimeout,
  retryAttempts: SOCKET_CONFIG.retryAttempts,
  retryDelay: SOCKET_CONFIG.retryDelay,
});

export const getLoggingConfig = () => ({
  logLevel: SOCKET_CONFIG.logLevel,
  enableMetrics: SOCKET_CONFIG.enableMetrics,
  metricsInterval: SOCKET_CONFIG.metricsInterval,
});

export const getDatabaseConfig = () => ({
  databaseConnectionPool: SOCKET_CONFIG.databaseConnectionPool,
  queryTimeout: SOCKET_CONFIG.queryTimeout,
  transactionTimeout: SOCKET_CONFIG.transactionTimeout,
});

export const getCleanupConfig = () => ({
  cleanupInterval: SOCKET_CONFIG.cleanupInterval,
  maxJobAge: SOCKET_CONFIG.maxJobAge,
  maxErrorLogAge: SOCKET_CONFIG.maxErrorLogAge,
});

// Runtime configuration management
class ConfigurationManager {
  private currentConfig: SocketServerConfig;
  private updateHandlers: Array<(config: SocketServerConfig) => void> = [];

  constructor(initialConfig: SocketServerConfig) {
    this.currentConfig = { ...initialConfig };
  }

  getCurrentConfig(): SocketServerConfig {
    return { ...this.currentConfig };
  }

  updateConfig(updates: Partial<SocketServerConfig>): void {
    this.currentConfig = mergeConfigs(this.currentConfig, updates);
    
    // Notify handlers of the update
    this.updateHandlers.forEach(handler => {
      try {
        handler(this.currentConfig);
      } catch (error) {
        console.error('Error in config update handler:', error);
      }
    });
  }

  onConfigUpdate(handler: (config: SocketServerConfig) => void): () => void {
    this.updateHandlers.push(handler);
    
    // Return unsubscribe function
    return () => {
      const index = this.updateHandlers.indexOf(handler);
      if (index > -1) {
        this.updateHandlers.splice(index, 1);
      }
    };
  }

  reloadFromEnvironment(): void {
    const envConfig = getConfigFromEnv();
    this.updateConfig(envConfig);
  }
}

// Export configuration manager instance
export const configManager = new ConfigurationManager(SOCKET_CONFIG);

// Utility to check if we're in a specific environment
export const isDevelopment = () => getCurrentEnvironment() === 'development';
export const isTest = () => getCurrentEnvironment() === 'test';
export const isProduction = () => getCurrentEnvironment() === 'production';

// Configuration validation helper
export const validateCurrentConfig = () => {
  return validateConfig(SOCKET_CONFIG);
};