#!/usr/bin/env bun
// src/subvisor/cli-simple.ts
// A simplified command-line based approach for the supervisor

import { getLogger } from "@logtape/logtape";
import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { cwd } from "process";
import { ProcessState, type ProcessConfig } from "./types";

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
    const value = args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : "true";
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
  foreground: true
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
    const [script, ...args] = config.websiteCmd.split(/\s+/);
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
        SETTINGS_FILE: process.env.SETTINGS_FILE || join(cwd(), "data.private/config/settings.yaml")
      },
      cwd: config.cwd || cwd()
    } as ProcessConfig);
  }
  
  // Add crawler process if requested
  if (processes.includes("crawler")) {
    const [script, ...args] = config.crawlerCmd.split(/\s+/);
    supervisor.defineProcess("crawler", {
      script,
      args,
      autoRestart: config.noRestart !== "true",
      restartDelay: config.restartDelay,
      maxRestarts: config.maxRestarts,
      dependencies: processes.includes("website") ? ["website"] : [],
      env: {
        ...commonEnv,
        SUPERVISOR_PROCESS_ID: "crawler"
      },
      cwd: config.cwd || cwd()
    } as ProcessConfig);
  }
  
  return supervisor;
}

// Print usage information
function printUsage(): void {
  console.log("Usage: bun run supervisor <command> [processes] [options]");
  console.log("");
  console.log("Commands:");
  console.log("  start [processes]    Start the supervisor with specified processes (default: website,crawler)");
  console.log("  stop [processes]     Stop the specified processes");
  console.log("  status [processes]   Show status of the specified processes");
  console.log("  restart [processes]  Restart the specified processes");
  console.log("  help                 Show this help message");
  console.log("");
  console.log("Processes:");
  console.log("  website              The web server process");
  console.log("  crawler              The crawler process");
  console.log("  website,crawler      Specify multiple processes (no spaces)");
  console.log("");
  console.log("Options:");
  console.log("  --socket-path <path>       Path to Unix socket (default: ./tmp/supervisor.sock)");
  console.log("  --log-dir <path>           Directory for logs (default: ./logs)");
  console.log("  --website-cmd <command>    Command to run the website (default: 'bun run dev')");
  console.log("  --crawler-cmd <command>    Command to run the crawler (default: 'bun run crawler:start')");
  console.log("  --no-restart               Disable automatic restarts");
  console.log("  --max-restarts <number>    Maximum number of restarts (default: 10)");
  console.log("  --restart-delay <number>   Delay between restarts in ms (default: 5000)");
  console.log("");
  console.log("Examples:");
  console.log("  # Start both website and crawler with default settings");
  console.log("  bun run supervisor start");
  console.log("");
  console.log("  # Start only the website");
  console.log("  bun run supervisor start website");
  console.log("");
  console.log("  # Start with custom settings");
  console.log("  bun run supervisor start --website-cmd 'bun run dev --port 3001'");
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
      
      console.log("Process Status:");
      console.log("--------------");
      
      for (const processId of processesToCheck) {
        try {
          const state = await supervisor.getProcessState(processId);
          const stateStr = state ? getColoredState(state) : "\x1b[90mNOT FOUND\x1b[0m";
          
          console.log(`${processId}: ${stateStr}`);
          
          const processConfig = supervisor.getProcessConfig(processId);
          if (processConfig) {
            console.log(`  Command: ${processConfig.script} ${processConfig.args?.join(" ") || ""}`);
            console.log(`  Auto-restart: ${processConfig.autoRestart}`);
            console.log(`  Restart delay: ${processConfig.restartDelay}ms`);
            console.log(`  Max restarts: ${processConfig.maxRestarts}`);
          }
          
          console.log("--------------");
        } catch (error) {
          console.log(`${processId}: \x1b[31mERROR\x1b[0m - ${error}`);
          console.log("--------------");
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
  console.error(`Error: ${err}`);
  process.exit(1);
});
