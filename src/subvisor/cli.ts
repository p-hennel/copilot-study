#!/usr/bin/env bun
// src/subvisor/cli.ts
import { getLogger } from "@logtape/logtape";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { supervisorSettings } from "./settings";
import { Supervisor } from "./supervisor";
import { ProcessState, type ProcessConfig } from "./types";

// Initialize logger
const logger = getLogger(["supervisor-cli"]);

// Parse command line arguments
const args = process.argv.slice(2);
let configPath = "./supervisor.yaml";
let command = "start";
let processId: string | null = null;
let webServerCmd: string | null = null;
let crawlerCmd: string | null = null;
let logDir = "./logs";
let foregroundMode = false;

// Parse arguments
for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  if (arg === "--config" || arg === "-c") {
    configPath = args[++i] ?? "";
  } else if (arg === "--web-server" || arg === "-w") {
    webServerCmd = args[++i] ?? "";
  } else if (arg === "--crawler" || arg === "-cr") {
    crawlerCmd = args[++i] ?? "";
  } else if (arg === "--log-dir" || arg === "-l") {
    logDir = args[++i] ?? "./logs";
  } else if (arg === "--foreground" || arg === "-f") {
    // This option indicates we should run in foreground/non-daemonized mode
    foregroundMode = true;
  } else if (
    arg === "start" ||
    arg === "stop" ||
    arg === "restart" ||
    arg === "status" ||
    arg === "list" ||
    arg === "reload-config" ||
    arg === "init"
  ) {
    command = arg;
  } else if (arg?.startsWith("--")) {
    logger.error(`Unknown option: ${arg}`);
    printUsage();
    process.exit(1);
  } else {
    processId = arg ?? null;
  }
}

// Helper function to generate a configuration file for web-server and crawler
function generateConfigFile(webServerCmd: string, crawlerCmd: string, configPath: string): boolean {
  try {
    // Parse the commands to extract script and arguments
    const parseCommand = (cmd: string): { script: string; args: string[] } => {
      const parts = cmd.trim().split(/\s+/);
      if (!parts[0]) {
        throw new Error(`Invalid command: ${cmd}`);
      }
      return {
        script: parts[0],
        args: parts.slice(1)
      };
    };
    
    const webServerParts = parseCommand(webServerCmd);
    const crawlerParts = parseCommand(crawlerCmd);
    
    // Generate common environment variables for the processes
    // Use a consistent, predictable socket path for Unix socket-based IPC
    const socketPath = join("/var/run", `supervisor-${Date.now()}.sock`);
    const commonEnv = {
      NODE_ENV: process.env.NODE_ENV || "production",
      LOG_LEVEL: "info",
      SUPERVISOR_SOCKET_PATH: socketPath,
      // Explicitly indicate that we're using Unix socket only
      SUPERVISOR_USE_UNIX_SOCKET: "true"
    };
    
    // Create process configurations
    const webServerProcess: ProcessConfig = {
      id: "web-server",
      script: webServerParts.script,
      args: webServerParts.args,
      autoRestart: true,
      restartDelay: 3000,
      maxRestarts: 5,
      env: {
        ...commonEnv,
        SUPERVISOR_PROCESS_ID: "web-server",
        PORT: "3000" // Default port for the web server
      }
    };
    
    const crawlerProcess: ProcessConfig = {
      id: "crawler",
      script: crawlerParts.script,
      args: crawlerParts.args,
      autoRestart: true,
      restartDelay: 3000,
      maxRestarts: 5,
      env: {
        ...commonEnv,
        SUPERVISOR_PROCESS_ID: "crawler"
      },
      // The crawler might need to know about the web server
      subscribeToHeartbeats: ["web-server"]
    };
    
    // Create the full supervisor configuration
    const config = {
      socketPath,
      heartbeatInterval: 5000,
      logLevel: "info",
      logFile: join(logDir, "supervisor.log"),
      logPrefix: "supervisor",
      stateFile: join(logDir, "supervisor-state.json"),
      processes: [webServerProcess, crawlerProcess],
      
      // Use Unix sockets exclusively for IPC (no HTTP/ports)
      useUnixSocketsOnly: true,
      stateSaveInterval: 30000,
      
      // Docker/container-friendly settings
      foregroundMode: false,    // Will be set to true with --foreground flag
      consoleLogs: false,       // When true, duplicate logs to console
      healthCheck: {
        enabled: true,
        interval: 30000,        // Health check interval in ms
        timeout: 5000,          // Health check timeout
        retries: 3              // Number of retries before considering unhealthy
      }
    };
    
    // Ensure the directory exists
    const configDir = dirname(configPath);
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
    
    // Save the config as JSON
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    logger.info(`Configuration saved to ${configPath}`);
    
    return true;
  } catch (error: any) {
    logger.error(`Failed to generate configuration: ${error.message}`);
    return false;
  }
}

// Check for init command to generate a configuration file
if (command === "init") {
  if (!webServerCmd || !crawlerCmd) {
    logger.error("Web server command and crawler command are required for initialization");
    printUsage();
    process.exit(1);
  }
  
  if (generateConfigFile(webServerCmd, crawlerCmd, configPath)) {
    logger.info(`Configuration file created at ${configPath}`);
    logger.info("You can now start the supervisor with: bun run src/subvisor/cli.ts start");
    process.exit(0);
  } else {
    logger.error("Failed to create configuration file");
    process.exit(1);
  }
}

// Ensure config file exists for other commands
if (!existsSync(configPath)) {
  logger.error(`Config file not found: ${configPath}`);
  logger.error("Run 'init' command first to generate a configuration file");
  printUsage();
  process.exit(1);
}

// Execute the requested command
async function main() {
  if (!process) throw new Error("No process interface available");

  // Create supervisor instance
  const supervisor = new Supervisor(configPath);

  // Ensure log directory exists if logFile is specified
  const config = supervisorSettings.getSettings();
  
  // If foreground mode is enabled, update the config for Docker-friendly operation
  if (foregroundMode && command === "start") {
    // Auto-detect container environment if possible
    const inContainer = await isRunningInContainer();
    
    logger.info(`Running in foreground mode (Docker-friendly: ${inContainer ? "Container detected" : "No container detected"})`);
    
    // Get the raw config file to add our Docker mode properties
    try {
      // Read the config file directly
      const configText = await Bun.file(configPath).text();
      const configContent = JSON.parse(configText) as Record<string, any>;
      
      // Add Docker mode settings
      configContent.foregroundMode = true;
      configContent.consoleLogs = true;
      
      // If we're in a container, adjust some settings for better container compatibility
      if (inContainer) {
        // Ensure health check is enabled for container orchestration
        configContent.healthCheck = {
          ...configContent.healthCheck,
          enabled: true
        };
        
        // Always use /var/run for socket path in containers (more reliable than /tmp)
        configContent.socketPath = '/var/run/supervisor.sock';
        
        // Explicitly enforce Unix sockets only for IPC in container environments
        configContent.useUnixSocketsOnly = true;
      }
      
      // Write back the updated config
      writeFileSync(configPath, JSON.stringify(configContent, null, 2));
      
      // Reload settings
      supervisorSettings.reload();
      
      logger.info("Updated configuration for foreground/Docker mode");
    } catch (error: any) {
      logger.error(`Failed to update Docker mode settings: ${error.message}`);
    }
  }
  
  // Make sure log directory exists
  if (config.logFile) {
    const logDir = dirname(config.logFile);
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
  }
  
  // Set up event listeners for inter-process communication
  supervisor.on("started", ({ processCount }) => {
    logger.info(`Supervisor started with ${processCount} managed processes`);
  });
  
  supervisor.on("ready", () => {
    logger.info("Supervisor is ready and managing processes");
  });
  
  // Log when messages are exchanged between processes
  (supervisor as any).on("message", (message: any) => {
    if (message?.type && message?.origin && message?.destination) {
      logger.debug(`Message from ${message.origin} to ${message.destination}: ${message.key}`);
    }
  });
  
  // Helper function to monitor communication between processes
  const monitorProcessCommunication = (enabled = true) => {
    if (!enabled) return;
    
    // Create a mapping table to track message counts
    const messageStats = new Map<string, Map<string, number>>();
    
    // Listen for messages between processes
    const messageListener = (message: any) => {
      if (!message?.origin || !message?.destination || !message?.type || !message?.key) return;
      
      const { origin, destination, type, key } = message;
      const channelKey = `${origin} → ${destination}`;
      
      // Update message counts
      if (!messageStats.has(channelKey)) {
        messageStats.set(channelKey, new Map<string, number>());
      }
      
      const typeCounts = messageStats.get(channelKey)!;
      const messageTypeKey = `${type}:${key}`;
      typeCounts.set(messageTypeKey, (typeCounts.get(messageTypeKey) || 0) + 1);
    };
    
    supervisor.on("message", messageListener);
    
    // Periodically log communication stats
    const statsInterval = setInterval(() => {
      if (messageStats.size === 0) return;
      
      logger.info("Inter-process communication statistics:");
      
      for (const [channel, typeCounts] of messageStats.entries()) {
        logger.info(`Channel: ${channel}`);
        
        // Sort message types by count (descending)
        const sortedTypes = Array.from(typeCounts.entries())
          .sort((a, b) => b[1] - a[1]);
        
        for (const [messageType, count] of sortedTypes) {
          logger.info(`  ${messageType}: ${count} messages`);
        }
      }
    }, 60000); // Log every minute
    
    // Return cleanup function
    return () => {
      clearInterval(statsInterval);
      supervisor.off("message", messageListener);
    };
  };

  switch (command) {
    case "start":
      if (processId) {
        // Start a specific process
        await supervisor.start();
        const proc = supervisor["processes"].get(processId);
        if (!proc) {
          logger.error(`Process not found: ${processId}`);
          await supervisor.initiateShutdown();
          process.exit(1);
        }
        proc.start();
        logger.info(`Started process: ${processId}`);

        // Wait a moment and then exit
        setTimeout(async () => {
          await supervisor.initiateShutdown();
        }, 1000);
      } else {
        // Start the supervisor and all processes
        await supervisor.start();
        logger.info("Supervisor started with the following processes:");
        
        // Show the processes that were started
        for (const [id, process] of supervisor["processes"].entries()) {
          logger.info(`- ${id}: ${process.config.script} ${process.config.args?.join(" ") || ""}`);
        }
        
        // Enable communication monitoring
        const cleanupMonitoring = monitorProcessCommunication(true);
        
        // Handle cleanup when shutting down
        process.once('beforeExit', () => {
          if (cleanupMonitoring) cleanupMonitoring();
        });
        
        if (foregroundMode) {
          // In foreground mode, output more information for Docker/container environments
          logger.info("Running in foreground mode");
          logger.info(`Socket path: ${config.socketPath}`);
          logger.info(`Log file: ${config.logFile}`);
          logger.info(`Monitoring port: ${config.enableMonitoring ? config.monitoringPort : 'disabled'}`);
          
          // Set up a regular heartbeat for container health checks
          const healthInterval = setInterval(() => {
            // Check if all processes are running
            let allHealthy = true;
            const statuses = [];
            
            for (const [id, process] of supervisor["processes"].entries()) {
              const state = process.getState();
              const isHealthy = state !== ProcessState.FAILED && 
                               state !== ProcessState.STOPPING && 
                               state !== ProcessState.STOPPED;
              allHealthy = allHealthy && isHealthy;
              statuses.push(`${id}: ${state} (${isHealthy ? "healthy" : "unhealthy"})`);
            }
            
            // Log health status
            logger.debug(`Health check: ${allHealthy ? "HEALTHY" : "UNHEALTHY"} - ${statuses.join(", ")}`);
            
            // If running in a Docker environment, we could also expose this via HTTP
            // for Docker's health check mechanism
          }, 30000); // Every 30 seconds
          
          // Add a cleanup handler for the health check
          process.once('beforeExit', () => {
            clearInterval(healthInterval);
          });
        }
        
        logger.info("System is running. Press Ctrl+C to stop.");
        
        // Keep running
        process.stdin.resume();
      }
      break;

    case "stop":
      if (processId) {
        // Stop a specific process
        await supervisor.start();
        const proc = supervisor["processes"].get(processId);
        if (!proc) {
          logger.error(`Process not found: ${processId}`);
          await supervisor.initiateShutdown();
          process.exit(1);
        }
        await proc.stop();
        logger.info(`Stopped process: ${processId}`);
        await supervisor.initiateShutdown();
      } else {
        // Stop the supervisor and all processes
        await supervisor.start();
        logger.info("Stopping all processes...");
        await supervisor.initiateShutdown();
      }
      break;

    case "restart": {
      if (!processId) {
        logger.error("Process ID required for restart command");
        printUsage();
        process.exit(1);
      }

      await supervisor.start();

      if (!processId) {
        logger.error("Process ID required for restart command");
        printUsage();
        process.exit(1);
      }
      const proc = supervisor["processes"].get(processId);
      if (!proc) {
        logger.error(`Process not found: ${processId}`);
        await supervisor.initiateShutdown();
        process.exit(1);
      }

      await proc.stop();
      proc.start();
      logger.info(`Restarted process: ${processId}`);

      // Wait a moment and then exit
      setTimeout(async () => {
        await supervisor.initiateShutdown();
      }, 1000);
      break;
    }

    case "status": {
      if (!processId) {
        logger.error("Process ID required for status command");
        printUsage();
        process.exit(1);
      }

      await supervisor.start();
      const targetProcess = supervisor["processes"].get(processId);
      if (!targetProcess) {
        logger.error(`Process not found: ${processId}`);
        await supervisor.initiateShutdown();
        process.exit(1);
      }

      logger.info(`Process: ${processId}`);
      logger.info(`State: ${targetProcess.getState()}`);
      logger.info(`Config:`, { config: targetProcess.config });

      await supervisor.initiateShutdown();
      break;
    }

    case "list":
      await supervisor.start();
      logger.info("Managed Processes:");
      logger.info("-----------------");

      for (const [id, process] of supervisor["processes"].entries()) {
        logger.info(`ID: ${id}`);
        logger.info(`State: ${process.getState()}`);
        logger.info(`Script: ${process.config.script}`);
        logger.info(`Auto-restart: ${process.config.autoRestart}`);

        if (process.config.dependencies?.length) {
          logger.info(`Dependencies: ${process.config.dependencies.join(", ")}`);
        }

        logger.info("-----------------");
      }

      await supervisor.initiateShutdown();
      break;

    case "reload-config":
      // New command that utilizes settings manager
      await supervisor.start();
      logger.info("Reloading configuration...");

      // Force reload settings
      supervisorSettings.reload();

      logger.info("Configuration reloaded");

      // For simplicity, we'll just continue running after reload
      // In a real implementation, you might want to handle process restarts here
      if (processId) {
        // If a process ID was specified, restart that process
        const proc = supervisor["processes"].get(processId);
        if (proc) {
          proc.restart();
          logger.info(`Restarted process ${processId} with new configuration`);
        } else {
          logger.error(`Process not found: ${processId}`);
        }

        // Wait a moment and then exit
        setTimeout(async () => {
          await supervisor.initiateShutdown();
        }, 1000);
      } else {
        // Keep running
        process.stdin.resume();
      }
      break;

    default:
      logger.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

/**
 * Helper function to detect if we're running in a Docker/container environment
 */
async function isRunningInContainer(): Promise<boolean> {
  try {
    // Check for the .dockerenv file at the root
    if (existsSync('/.dockerenv')) {
      return true;
    }
    
    // Check by reading cgroup information
    try {
      const cgroupContent = await Bun.file('/proc/1/cgroup').text();
      return cgroupContent.includes('/docker') || 
            cgroupContent.includes('/lxc') || 
            cgroupContent.includes('/kubepods');
    } catch {
      // File might not exist or be readable
      return false;
    }
    
  } catch {
    // Ignore errors - they likely mean we're not in a container
    return false;
  }
}

function printUsage() {
  logger.info("Usage: bun run src/subvisor/cli.ts [options] [command] [process-id]");
  logger.info("");
  logger.info("Options:");
  logger.info("  --config, -c <path>         Path to config file (default: ./supervisor.yaml)");
  logger.info("  --web-server, -w <cmd>      Command to start the web server (required for 'init')");
  logger.info("  --crawler, -cr <cmd>        Command to start the crawler (required for 'init')");
  logger.info("  --log-dir, -l <path>        Directory for log files (default: ./logs)");
  logger.info("  --foreground, -f            Run in foreground/non-daemonized mode (ideal for Docker)");
  logger.info("");
  logger.info("Commands:");
  logger.info("  init                     Generate a config file with web server and crawler commands");
  logger.info("  start [process-id]       Start the supervisor or a specific process");
  logger.info("  stop [process-id]        Stop the supervisor or a specific process");
  logger.info("  restart <process-id>     Restart a specific process");
  logger.info("  status <process-id>      Show status of a specific process");
  logger.info("  list                     List all managed processes");
  logger.info("  reload-config [proc]     Reload configuration and optionally restart a process");
  logger.info("");
  logger.info("Examples:");
  logger.info("  # Initialize with web server and crawler commands");
  logger.info('  bun run src/subvisor/cli.ts init -w "bun run dev" -cr "bun run src/crawler/cli.ts"');
  logger.info("");
  logger.info("  # Start all processes in foreground mode (good for Docker)");
  logger.info("  bun run src/subvisor/cli.ts start -f");
  logger.info("");
  logger.info("  # Start only the web server");
  logger.info("  bun run src/subvisor/cli.ts start web-server");
  logger.info("");
  logger.info("  # Check status of the crawler");
  logger.info("  bun run src/subvisor/cli.ts status crawler");
}

// Set up signal handlers for clean shutdown
process.on("SIGINT", async () => {
  logger.info("Received SIGINT signal, shutting down...");
  const supervisor = new Supervisor(configPath);
  await supervisor.initiateShutdown({
    reason: "SIGINT received",
    exitProcess: true,
    timeout: 10000
  });
});

process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM signal, shutting down...");
  const supervisor = new Supervisor(configPath);
  await supervisor.initiateShutdown({
    reason: "SIGTERM received",
    exitProcess: true,
    timeout: 10000
  });
});

main().catch((err) => {
  logger.error(`Error: ${err}`);
  process.exit(1);
});
