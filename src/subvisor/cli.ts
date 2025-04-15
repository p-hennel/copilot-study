#!/usr/bin/env bun
// src/subvisor/cli.ts
import { getLogger } from "@logtape/logtape";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { supervisorSettings } from "./settings";
import { Supervisor } from "./supervisor";
import { type ProcessConfig } from "./types";

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
    console.error(`Unknown option: ${arg}`);
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
    const socketPath = join("/tmp", `supervisor-${Date.now()}.sock`);
    const commonEnv = {
      NODE_ENV: process.env.NODE_ENV || "production",
      LOG_LEVEL: "info",
      SUPERVISOR_SOCKET_PATH: socketPath
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
      
      // Additional settings
      enableMonitoring: true,
      monitoringPort: 9090,
      stateSaveInterval: 30000
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
    console.error("Web server command and crawler command are required for initialization");
    printUsage();
    process.exit(1);
  }
  
  if (generateConfigFile(webServerCmd, crawlerCmd, configPath)) {
    console.log(`Configuration file created at ${configPath}`);
    console.log("You can now start the supervisor with: bun run src/subvisor/cli.ts start");
    process.exit(0);
  } else {
    console.error("Failed to create configuration file");
    process.exit(1);
  }
}

// Ensure config file exists for other commands
if (!existsSync(configPath)) {
  console.error(`Config file not found: ${configPath}`);
  console.error("Run 'init' command first to generate a configuration file");
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
          console.error(`Process not found: ${processId}`);
          await supervisor.initiateShutdown();
          process.exit(1);
        }
        proc.start();
        console.log(`Started process: ${processId}`);

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
          console.error(`Process not found: ${processId}`);
          await supervisor.initiateShutdown();
          process.exit(1);
        }
        await proc.stop();
        console.log(`Stopped process: ${processId}`);
        await supervisor.initiateShutdown();
      } else {
        // Stop the supervisor and all processes
        await supervisor.start();
        console.log("Stopping all processes...");
        await supervisor.initiateShutdown();
      }
      break;

    case "restart": {
      if (!processId) {
        console.error("Process ID required for restart command");
        printUsage();
        process.exit(1);
      }

      await supervisor.start();

      if (!processId) {
        console.error("Process ID required for restart command");
        printUsage();
        process.exit(1);
      }
      const proc = supervisor["processes"].get(processId);
      if (!proc) {
        console.error(`Process not found: ${processId}`);
        await supervisor.initiateShutdown();
        process.exit(1);
      }

      await proc.stop();
      proc.start();
      console.log(`Restarted process: ${processId}`);

      // Wait a moment and then exit
      setTimeout(async () => {
        await supervisor.initiateShutdown();
      }, 1000);
      break;
    }

    case "status": {
      if (!processId) {
        console.error("Process ID required for status command");
        printUsage();
        process.exit(1);
      }

      await supervisor.start();
      const targetProcess = supervisor["processes"].get(processId);
      if (!targetProcess) {
        console.error(`Process not found: ${processId}`);
        await supervisor.initiateShutdown();
        process.exit(1);
      }

      console.log(`Process: ${processId}`);
      console.log(`State: ${targetProcess.getState()}`);
      console.log(`Config:`, targetProcess.config);

      await supervisor.initiateShutdown();
      break;
    }

    case "list":
      await supervisor.start();
      console.log("Managed Processes:");
      console.log("-----------------");

      for (const [id, process] of supervisor["processes"].entries()) {
        console.log(`ID: ${id}`);
        console.log(`State: ${process.getState()}`);
        console.log(`Script: ${process.config.script}`);
        console.log(`Auto-restart: ${process.config.autoRestart}`);

        if (process.config.dependencies?.length) {
          console.log(`Dependencies: ${process.config.dependencies.join(", ")}`);
        }

        console.log("-----------------");
      }

      await supervisor.initiateShutdown();
      break;

    case "reload-config":
      // New command that utilizes settings manager
      await supervisor.start();
      console.log("Reloading configuration...");

      // Force reload settings
      supervisorSettings.reload();

      console.log("Configuration reloaded");

      // For simplicity, we'll just continue running after reload
      // In a real implementation, you might want to handle process restarts here
      if (processId) {
        // If a process ID was specified, restart that process
        const proc = supervisor["processes"].get(processId);
        if (proc) {
          proc.restart();
          console.log(`Restarted process ${processId} with new configuration`);
        } else {
          console.error(`Process not found: ${processId}`);
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
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

function printUsage() {
  console.log("Usage: bun run src/subvisor/cli.ts [options] [command] [process-id]");
  console.log("");
  console.log("Options:");
  console.log("  --config, -c <path>         Path to config file (default: ./supervisor.yaml)");
  console.log("  --web-server, -w <cmd>      Command to start the web server (required for 'init')");
  console.log("  --crawler, -cr <cmd>        Command to start the crawler (required for 'init')");
  console.log("  --log-dir, -l <path>        Directory for log files (default: ./logs)");
  console.log("");
  console.log("Commands:");
  console.log("  init                     Generate a config file with web server and crawler commands");
  console.log("  start [process-id]       Start the supervisor or a specific process");
  console.log("  stop [process-id]        Stop the supervisor or a specific process");
  console.log("  restart <process-id>     Restart a specific process");
  console.log("  status <process-id>      Show status of a specific process");
  console.log("  list                     List all managed processes");
  console.log("  reload-config [proc]     Reload configuration and optionally restart a process");
  console.log("");
  console.log("Examples:");
  console.log("  # Initialize with web server and crawler commands");
  console.log('  bun run src/subvisor/cli.ts init -w "bun run dev" -cr "bun run src/crawler/cli.ts"');
  console.log("");
  console.log("  # Start all processes");
  console.log("  bun run src/subvisor/cli.ts start");
  console.log("");
  console.log("  # Start only the web server");
  console.log("  bun run src/subvisor/cli.ts start web-server");
  console.log("");
  console.log("  # Check status of the crawler");
  console.log("  bun run src/subvisor/cli.ts status crawler");
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
  console.error(`Error: ${err}`);
  process.exit(1);
});
