#!/usr/bin/env bun
// src/subvisor/cli-simple.ts
// A simplified command-line based approach for the supervisor

import { getLogger } from "@logtape/logtape";
import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { cwd } from "process";
import { SimplifiedSupervisor } from "./simplified-supervisor";
import { ProcessState } from "./types";

// Initialize logger
const logger = getLogger(["supervisor-cli"]);

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0] || "help";
const processes: string[] = [];

// Parse optional processes (website,crawler)
if (args.length > 1 && args[1] && !args[1].startsWith("--")) {
  args[1].split(',').forEach(proc => {
    if (proc === "website" || proc === "crawler") {
      processes.push(proc);
    }
  });
}

// Default to both processes if none specified for 'start' command
if (command === "start" && processes.length === 0) {
  processes.push("website", "crawler");
}

// Parse options
const options: Record<string, any> = {};
for (let i = 1; i < args.length; i++) {
  const arg = args[i];
  if (arg && arg.startsWith("--")) {
    const key = arg.slice(2);
    const nextArg = i + 1 < args.length ? args[i + 1] : undefined;
    const value = nextArg && !nextArg.startsWith("--") ? nextArg : "true";
    options[key] = value;
    
    if (value !== "true") {
      i++; // Skip the value in the next iteration
    }
  }
}

// Define default options
const DEFAULT_OPTIONS = {
  socketPath: join(cwd(), "tmp", "supervisor.sock"),
  logDir: join(cwd(), "logs"),
  websiteCmd: "bun run dev",
  crawlerCmd: "bun run crawler:start",
  maxRestarts: 10,
  restartDelay: 5000,
  foreground: true,
  // Added additional options
  noRestart: "false",
  cwd: process.cwd()
};

// Merge defaults with provided options
const config = {
  ...DEFAULT_OPTIONS,
  ...options,
  // Convert string numbers to actual numbers
  maxRestarts: parseInt(options.maxRestarts || DEFAULT_OPTIONS.maxRestarts.toString()),
  restartDelay: parseInt(options.restartDelay || DEFAULT_OPTIONS.restartDelay.toString())
};

// Helper function to ensure directories exist
function ensureDirExists(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

// Create supervisor instance
function createSupervisor(): SimplifiedSupervisor {
  // Ensure directories exist
  ensureDirExists(dirname(config.socketPath));
  ensureDirExists(config.logDir);
  
  // Create a supervisor instance
  const supervisor = new SimplifiedSupervisor(config.socketPath);
  
  // Set up environment variables for the processes
  const commonEnv = {
    NODE_ENV: process.env.NODE_ENV || "development",
    SUPERVISOR_SOCKET_PATH: config.socketPath,
    LOG_LEVEL: process.env.LOG_LEVEL || "info"
  };
  
  // Add website process if requested
  if (processes.includes("website")) {
    const cmdParts = config.websiteCmd.split(/\s+/);
    const script = cmdParts[0] || '';
    const args = cmdParts.slice(1);
    
    supervisor.defineProcess("website", {
      script,
      args,
      autoRestart: config.noRestart !== "true",
      restartDelay: config.restartDelay,
      maxRestarts: config.maxRestarts,
      env: {
        ...commonEnv,
        SUPERVISOR_PROCESS_ID: "website",
        DATABASE_URL: process.env.DATABASE_URL || join(cwd(), "data.private/config/main.db"),
        DATA_ROOT: process.env.DATA_ROOT || join(cwd(), "data.private"),
        SETTINGS_FILE: process.env.SETTINGS_FILE || join(cwd(), "data.private/config/settings.yaml"),
        // Pass cwd as environment variable
        CWD: config.cwd || cwd()
      }
    });
  }
  
  // Add crawler process if requested
  if (processes.includes("crawler")) {
    const cmdParts = config.crawlerCmd.split(/\s+/);
    const script = cmdParts[0] || '';
    const args = cmdParts.slice(1);
    
    supervisor.defineProcess("crawler", {
      script,
      args,
      autoRestart: config.noRestart !== "true",
      restartDelay: config.restartDelay,
      maxRestarts: config.maxRestarts,
      dependencies: processes.includes("website") ? ["website"] : [],
      env: {
        ...commonEnv,
        SUPERVISOR_PROCESS_ID: "crawler",
        // Pass cwd as environment variable
        CWD: config.cwd || cwd()
      }
    });
  }
  
  return supervisor;
}

// Print usage information
function printUsage(): void {
  logger.info("Usage: bun run supervisor <command> [processes] [options]");
  logger.info("");
  logger.info("Commands:");
  logger.info("  start [processes]    Start the supervisor with specified processes (default: website,crawler)");
  logger.info("  stop [processes]     Stop the specified processes");
  logger.info("  status [processes]   Show status of the specified processes");
  logger.info("  restart [processes]  Restart the specified processes");
  logger.info("  help                 Show this help message");
  logger.info("");
  logger.info("Processes:");
  logger.info("  website              The web server process");
  logger.info("  crawler              The crawler process");
  logger.info("  website,crawler      Specify multiple processes (no spaces)");
  logger.info("");
  logger.info("Options:");
  logger.info("  --socket-path <path>       Path to Unix socket (default: ./tmp/supervisor.sock)");
  logger.info("  --log-dir <path>           Directory for logs (default: ./logs)");
  logger.info("  --website-cmd <command>    Command to run the website (default: 'bun run dev')");
  logger.info("  --crawler-cmd <command>    Command to run the crawler (default: 'bun run crawler:start')");
  logger.info("  --no-restart               Disable automatic restarts");
  logger.info("  --max-restarts <number>    Maximum number of restarts (default: 10)");
  logger.info("  --restart-delay <number>   Delay between restarts in ms (default: 5000)");
  logger.info("");
  logger.info("Examples:");
  logger.info("  # Start both website and crawler with default settings");
  logger.info("  bun run supervisor start");
  logger.info("");
  logger.info("  # Start only the website");
  logger.info("  bun run supervisor start website");
  logger.info("");
  logger.info("  # Start with custom settings");
  logger.info("  bun run supervisor start --website-cmd 'bun run dev --port 3001'");
}

// Main function to execute commands
async function main() {
  switch (command) {
    case "start": {
      logger.info(`Starting supervisor with processes: ${processes.join(", ")}`);
      const supervisor = createSupervisor();
      
      // Set up signal handlers
      process.on("SIGINT", () => {
        logger.info("Received SIGINT signal, shutting down...");
        supervisor.stop();
        process.exit(0);
      });
      
      process.on("SIGTERM", () => {
        logger.info("Received SIGTERM signal, shutting down...");
        supervisor.stop();
        process.exit(0);
      });
      
      // Start the supervisor
      await supervisor.start();
      
      logger.info("Supervisor started successfully");
      
      // Show the processes that were started
      for (const processId of processes) {
        logger.info(`- Started process: ${processId}`);
      }
      
      logger.info("System is running. Press Ctrl+C to stop.");
      
      // Keep the process running in foreground mode
      process.stdin.resume();
      break;
    }
    
    case "stop": {
      const supervisor = createSupervisor();
      
      // Start the supervisor (needed to connect and send stop commands)
      await supervisor.start();
      
      if (processes.length === 0) {
        // If no specific processes are specified, stop all
        logger.info("Stopping all processes...");
        await supervisor.stop();
      } else {
        // Stop specific processes
        for (const processId of processes) {
          logger.info(`Stopping process: ${processId}`);
          try {
            await supervisor.stopProcess(processId);
          } catch (error) {
            logger.error(`Error stopping process ${processId}: ${error}`);
          }
        }
        // Also stop the supervisor itself
        await supervisor.stop();
      }
      
      logger.info("Stop command completed");
      process.exit(0);
      break;
    }
    
    case "status": {
      const supervisor = createSupervisor();
      
      // Start the supervisor to access process information
      await supervisor.start();
      
      // Display status for specific processes or all processes
      const processesToCheck = processes.length > 0 ? processes : ['website', 'crawler'];
      
      logger.info("Process Status:");
      logger.info("--------------");
      
      for (const processId of processesToCheck) {
        try {
          const state = await supervisor.getProcessState(processId);
          const stateStr = state ? getColoredState(state) : "\x1b[90mNOT FOUND\x1b[0m";
          
          logger.info(`${processId}: ${stateStr}`);
          
          const processConfig = supervisor.getProcessConfig(processId);
          if (processConfig) {
            logger.info(`  Command: ${processConfig.script} ${processConfig.args?.join(" ") || ""}`);
            logger.info(`  Auto-restart: ${processConfig.autoRestart}`);
            logger.info(`  Restart delay: ${processConfig.restartDelay}ms`);
            logger.info(`  Max restarts: ${processConfig.maxRestarts}`);
          }
          
          logger.info("--------------");
        } catch (error) {
          logger.info(`${processId}: \x1b[31mERROR\x1b[0m - ${error}`);
          logger.info("--------------");
        }
      }
      
      // Stop the supervisor after checking
      await supervisor.stop();
      process.exit(0);
      break;
    }
    
    case "restart": {
      const supervisor = createSupervisor();
      
      // Start the supervisor
      await supervisor.start();
      
      if (processes.length === 0) {
        logger.error("No processes specified for restart");
        printUsage();
        await supervisor.stop();
        process.exit(1);
      }
      
      // Restart each specified process
      for (const processId of processes) {
        logger.info(`Restarting process: ${processId}`);
        try {
          await supervisor.restartProcess(processId);
        } catch (error) {
          logger.error(`Error restarting process ${processId}: ${error}`);
        }
      }
      
      logger.info("Restart command completed");
      await supervisor.stop();
      process.exit(0);
      break;
    }
    
    case "help":
    default:
      printUsage();
      process.exit(0);
  }
}

// Helper function to colorize process state for status output
function getColoredState(state: ProcessState): string {
  switch (state) {
    case ProcessState.IDLE:
      return "\x1b[32mRUNNING\x1b[0m"; // Green
    case ProcessState.STARTING:
      return "\x1b[33mSTARTING\x1b[0m"; // Yellow
    case ProcessState.STOPPING:
      return "\x1b[33mSTOPPING\x1b[0m"; // Yellow
    case ProcessState.STOPPED:
      return "\x1b[90mSTOPPED\x1b[0m"; // Gray
    case ProcessState.FAILED:
      return "\x1b[31mFAILED\x1b[0m"; // Red
    default:
      return state;
  }
}

// Execute the main function
main().catch((err) => {
  logger.error(`Error: ${err}`);
  process.exit(1);
});
