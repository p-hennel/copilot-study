// Socket server configuration
export interface SocketServerConfig {
  // Connection settings
  socketPath?: string;
  host?: string;
  port?: number;
  backlog?: number;
  
  // Security settings
  allowedOrigins?: string[];
  maxConnections?: number;
  connectionTimeout?: number;
  
  // Message handling
  messageBufferSize?: number;
  maxMessageSize?: number;
  messageDelimiter?: string;
  messageTimeout?: number;
  bufferSize?: number;
  
  // Heartbeat and health
  heartbeatInterval?: number;
  heartbeatTimeout?: number;
  healthCheckInterval?: number;
  
  // Job processing
  maxConcurrentJobs?: number;
  jobQueueSize?: number;
  jobTimeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
  
  // Logging and monitoring
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  enableMetrics?: boolean;
  metricsInterval?: number;
  
  // Database settings
  databaseConnectionPool?: number;
  queryTimeout?: number;
  transactionTimeout?: number;
  
  // Cleanup settings
  cleanupInterval?: number;
  maxJobAge?: number;
  maxErrorLogAge?: number;
}

// Default configuration values
export const DEFAULT_SOCKET_CONFIG: Required<SocketServerConfig> = {
  // Connection settings
  socketPath: '/tmp/crawler-socket.sock',
  host: 'localhost',
  port: 8080,
  backlog: 511,
  
  // Security settings
  allowedOrigins: ['http://localhost:5173', 'http://localhost:3000'],
  maxConnections: 10,
  connectionTimeout: 30000, // 30 seconds
  
  // Message handling
  messageBufferSize: 1024 * 1024, // 1MB
  maxMessageSize: 1024 * 1024, // 1MB
  messageDelimiter: '\n',
  messageTimeout: 5000,
  bufferSize: 1024*1024,
  
  // Heartbeat and health
  heartbeatInterval: 30000, // 30 seconds
  heartbeatTimeout: 90000, // 90 seconds
  healthCheckInterval: 60000, // 1 minute
  
  // Job processing
  maxConcurrentJobs: 5,
  jobQueueSize: 100,
  jobTimeout: 3600000, // 1 hour
  retryAttempts: 3,
  retryDelay: 5000, // 5 seconds
  
  // Logging and monitoring
  logLevel: 'info',
  enableMetrics: true,
  metricsInterval: 60000, // 1 minute
  
  // Database settings
  databaseConnectionPool: 10,
  queryTimeout: 30000, // 30 seconds
  transactionTimeout: 60000, // 1 minute
  
  // Cleanup settings
  cleanupInterval: 3600000, // 1 hour
  maxJobAge: 7 * 24 * 3600000, // 7 days
  maxErrorLogAge: 30 * 24 * 3600000, // 30 days
};

// Environment-specific configuration
export interface EnvironmentConfig {
  development: Partial<SocketServerConfig>;
  test: Partial<SocketServerConfig>;
  production: Partial<SocketServerConfig>;
}

export const ENVIRONMENT_CONFIGS: EnvironmentConfig = {
  development: {
    logLevel: 'debug',
    heartbeatInterval: 10000, // 10 seconds for faster feedback
    maxConnections: 3,
    enableMetrics: true,
  },
  test: {
    logLevel: 'warn',
    heartbeatInterval: 5000, // 5 seconds for faster tests
    maxConnections: 1,
    enableMetrics: false,
    socketPath: '/tmp/test-crawler-socket.sock',
  },
  production: {
    logLevel: 'info',
    maxConnections: 10,
    enableMetrics: true,
    heartbeatInterval: 60000, // 1 minute
    connectionTimeout: 120000, // 2 minutes
  },
};

// Configuration validation
export interface ConfigValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export const validateConfig = (config: SocketServerConfig): ConfigValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate numeric values
  if (config.port && (config.port < 1 || config.port > 65535)) {
    errors.push('Port must be between 1 and 65535');
  }

  if (config.maxConnections && config.maxConnections < 1) {
    errors.push('maxConnections must be at least 1');
  }

  if (config.heartbeatInterval && config.heartbeatInterval < 1000) {
    warnings.push('heartbeatInterval below 1 second may cause performance issues');
  }

  if (config.connectionTimeout && config.connectionTimeout < 5000) {
    warnings.push('connectionTimeout below 5 seconds may cause premature disconnections');
  }

  // Validate paths
  if (config.socketPath && !config.socketPath.startsWith('/')) {
    errors.push('socketPath must be an absolute path');
  }

  // Validate message settings
  if (config.maxMessageSize && config.maxMessageSize > 10 * 1024 * 1024) {
    warnings.push('maxMessageSize above 10MB may cause memory issues');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
};

// Configuration merging utility
export const mergeConfigs = (
  base: SocketServerConfig,
  override: Partial<SocketServerConfig>
): SocketServerConfig => {
  return {
    ...base,
    ...override,
  };
};

// Get configuration for current environment
export const getEnvironmentConfig = (
  env: keyof EnvironmentConfig = 'development'
): SocketServerConfig => {
  const envConfig = ENVIRONMENT_CONFIGS[env] || {};
  return mergeConfigs(DEFAULT_SOCKET_CONFIG, envConfig);
};

// Configuration from environment variables
export const getConfigFromEnv = (): Partial<SocketServerConfig> => {
  const config: Partial<SocketServerConfig> = {};

  if (process.env.SOCKET_PATH) {
    config.socketPath = process.env.SOCKET_PATH;
  }

  if (process.env.SOCKET_HOST) {
    config.host = process.env.SOCKET_HOST;
  }

  if (process.env.SOCKET_PORT) {
    const port = parseInt(process.env.SOCKET_PORT, 10);
    if (!isNaN(port)) {
      config.port = port;
    }
  }

  if (process.env.SOCKET_MAX_CONNECTIONS) {
    const maxConnections = parseInt(process.env.SOCKET_MAX_CONNECTIONS, 10);
    if (!isNaN(maxConnections)) {
      config.maxConnections = maxConnections;
    }
  }

  if (process.env.SOCKET_LOG_LEVEL) {
    const logLevel = process.env.SOCKET_LOG_LEVEL as SocketServerConfig['logLevel'];
    if (['debug', 'info', 'warn', 'error'].includes(logLevel!)) {
      config.logLevel = logLevel;
    }
  }

  if (process.env.SOCKET_HEARTBEAT_INTERVAL) {
    const interval = parseInt(process.env.SOCKET_HEARTBEAT_INTERVAL, 10);
    if (!isNaN(interval)) {
      config.heartbeatInterval = interval;
    }
  }

  if (process.env.SOCKET_MAX_CONCURRENT_JOBS) {
    const maxJobs = parseInt(process.env.SOCKET_MAX_CONCURRENT_JOBS, 10);
    if (!isNaN(maxJobs)) {
      config.maxConcurrentJobs = maxJobs;
    }
  }

  return config;
};

// Runtime configuration state
export interface RuntimeConfig {
  startTime: Date;
  version: string;
  environment: string;
  socketConfig: SocketServerConfig;
  features: {
    heartbeatEnabled: boolean;
    metricsEnabled: boolean;
    cleanupEnabled: boolean;
    queueEnabled: boolean;
  };
}

// Configuration change notification
export interface ConfigChangeEvent {
  type: 'config_updated';
  timestamp: string;
  changes: {
    field: keyof SocketServerConfig;
    oldValue: any;
    newValue: any;
  }[];
  source: 'environment' | 'file' | 'api' | 'admin';
}

export type ConfigChangeHandler = (event: ConfigChangeEvent) => void;

// Configuration management interface
export interface ConfigManager {
  getCurrentConfig(): SocketServerConfig;
  updateConfig(changes: Partial<SocketServerConfig>): Promise<ConfigValidationResult>;
  reloadFromEnv(): Promise<void>;
  subscribe(handler: ConfigChangeHandler): () => void;
  getConfigHistory(): ConfigChangeEvent[];
}