#!/usr/bin/env bun
// src/subvisor/cli.ts - Updated version with command-line based approach
import { getLogger } from "@logtape/logtape";
import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { cwd } from "process";
import { Supervisor } from "./supervisor";
import { ProcessState } from "./types";

// Initialize logger
const logger = getLogger(["supervisor-cli"]);

// Define default values
const DEFAULT_OPTIONS = {
  socketPath: join(cwd(), "tmp", "supervisor.sock"),
  logDir: join(cwd(), "logs"),
  autostart: true,
  restart: true,
  maxRestarts: 10,
  restartDelay: 5000,
  websiteCmd: "bun run dev",
  crawlerCmd: "bun run crawler:start",
  foreground: false,
  currentCwd: cwd()
};

// Parse command line arguments
const args = process.argv.slice(2);
let command = args[0] || "help";
const processNames: string[] = [];
const options: Record<string, any> = { ...DEFAULT_OPTIONS };
let optionKey: string | null = null;

// Parse the command and remaining arguments
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  
  // Handle commands
  if (i === 0 && arg) {
    if (["start", "stop", "restart", "status", "list", "help"].includes(arg)) {
      command = arg;
      continue;
    }
  }
  
  // Handle process names (should come after the command)
  if (i === 1 && arg && !arg.startsWith('-')) {
    const names = arg.split(',');
    for (const name of names) {
      if (name === "website" || name === "crawler") {
        processNames.push(name);
      } else {
        console.error(`Unknown process name: ${name}`);
        printUsage();
        process.exit(1);
      }
    }
    continue;
  }
  
  // Handle options
  if (arg && arg.startsWith('--')) {
    const key = arg.slice(2);
    
    // Boolean flags
    if (key === "foreground" || key === "no-restart") {
      options[key.replace('no-', '')] = key.startsWith('no-') ? false : true;
      continue;
    }
    
    optionKey = camelCase(key);
    
    // If the next arg is an option too or doesn't exist, treat this as a flag
    const nextArg = args[i + 1];
    if (i + 1 >= args.length || (nextArg && nextArg.startsWith('-'))) {
      options[optionKey] = true;
      optionKey = null;
    }
  } else if (optionKey) {
    options[optionKey] = arg;
    optionKey = null;
  } else if (i > 1) {
    // Any other positional argument after the command and process must be a process name
    if (arg === "website" || arg === "crawler") {
      processNames.push(arg);
    } else {
      console.error(`Unknown argument: ${arg}`);
      printUsage();
      process.exit(1);
    }
  }
}

// Default to starting both processes if none specified
if (processNames.length === 0 && command === "start") {
  processNames.push("website", "crawler");
}

// Helper function to convert kebab-case to camelCase
function camelCase(str: string): string {
  if (!str) return '';
  return str.replace(/-([a-z])/g, (match, group) => {
    if (group) return group.toUpperCase();
    return '';
  });
}

// Helper function to ensure directories exist
function ensureDirExists(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

// Ensure necessary directories exist
ensureDirExists(dirname(options.socketPath));
ensureDirExists(options.logDir);

// Initialize the supervisor in-memory (no config file needed)
function initializeSupervisor(): Supervisor {
  // Ensure IPC socket directory exists
  const socketDir = dirname(options.socketPath);
  ensureDirExists(socketDir);
  
  // Create common environment variables
  const commonEnv = {
    NODE_ENV: process.env.NODE_ENV || "development",
    SUPERVISOR_SOCKET_PATH: options.socketPath
  };
  
  // Create a supervisor instance
  const supervisor = new Supervisor(options.socketPath);
  
  // Initialize the website process if requested
  if (processNames.includes("website")) {
    logger.info(`Setting up website process with command: ${options.websiteCmd}`);
    
    // Parse the command
    const [script, ...args] = options.websiteCmd.split(/\s+/);
    
    supervisor.addProcess("website", {
      script,
      args,
      autoRestart: options.restart,
      restartDelay: options.restartDelay,
      maxRestarts: options.maxRestarts,
      env: {
        ...commonEnv,
        SUPERVISOR_PROCESS_ID: "website",
        CWD: options.currentCwd // Pass as environment variable instead
      }
    });
  }
  
  // Initialize the crawler process if requested
  if (processNames.includes("crawler")) {
    logger.info(`Setting up crawler process with command: ${options.crawlerCmd}`);
    
    // Parse the command
    const [script, ...args] = options.crawlerCmd.split(/\s+/);
    
    supervisor.addProcess("crawler", {
      script,
      args,
      autoRestart: options.restart,
      restartDelay: options.restartDelay,
      maxRestarts: options.maxRestarts,
      env: {
        ...commonEnv,
        SUPERVISOR_PROCESS_ID: "crawler",
        CWD: options.currentCwd // Pass as environment variable instead
      },
      // Make crawler depend on website for proper ordering
      dependencies: processNames.includes("website") ? ["website"] : []
    });
  }
  
  return supervisor;
}

function printUsage() {
  console.log("Usage: supervisor <command> [processes] [options]");
  console.log("");
  console.log("Commands:");
  console.log("  start [processes]    Start the supervisor with specified processes (default: website,crawler)");
  console.log("  stop [processes]     Stop the specified processes or all if none specified");
  console.log("  restart [processes]  Restart the specified processes");
  console.log("  status [processes]   Show status of the specified processes");
  console.log("  list                 List all managed processes and their status");
  console.log("  help                 Show this help message");
  console.log("");
  console.log("Processes:");
  console.log("  website              The web server process");
  console.log("  crawler              The crawler process");
  console.log("");
  console.log("Options:");
  console.log("  --socket-path <path>       Path to Unix socket (default: ./tmp/supervisor.sock)");
  console.log("  --log-dir <path>           Directory for logs (default: ./logs)");
  console.log("  --website-cmd <command>    Command to run the website (default: 'bun run dev')");
  console.log("  --crawler-cmd <command>    Command to run the crawler (default: 'bun run crawler:start')");
  console.log("  --foreground               Run in foreground mode (ideal for Docker)");
  console.log("  --no-restart               Disable automatic restarts");
  console.log("  --max-restarts <number>    Maximum number of restarts (default: 10)");
  console.log("  --restart-delay <ms>       Delay between restarts in ms (default: 5000)");
  console.log("");
  console.log("Examples:");
  console.log("  # Start both website and crawler with default settings");
  console.log("  bun run supervisor start");
  console.log("");
  console.log("  # Start only the website");
  console.log("  bun run supervisor start website");
  console.log("");
  console.log("  # Start with custom settings");
  console.log("  bun run supervisor start --website-cmd 'bun run dev --port 3001' --crawler-cmd 'bun run crawler --debug'");
  console.log("");
  console.log("  # Restart the crawler only");
  console.log("  bun run supervisor restart crawler");
}

// Main function to execute commands
async function main() {
  switch (command) {
    case "start": {
      logger.info(`Starting supervisor with processes: ${processNames.join(", ")}`);
      const supervisor = initializeSupervisor();
      
      await supervisor.start();
      logger.info("Supervisor started successfully");
      
      // Show the processes that were started
      for (const [id, process] of supervisor["processes"].entries()) {
        logger.info(`- ${id}: ${process.config.script} ${process.config.args?.join(" ") || ""}`);
      }
      
      // Set up signal handlers for clean shutdown
      process.on("SIGINT", async () => {
        logger.info("Received SIGINT signal, shutting down...");
        await supervisor.initiateShutdown({
          reason: "SIGINT received",
          exitProcess: true,
          timeout: 10000
        });
      });
      
      process.on("SIGTERM", async () => {
        logger.info("Received SIGTERM signal, shutting down...");
        await supervisor.initiateShutdown({
          reason: "SIGTERM received",
          exitProcess: true,
          timeout: 10000
        });
      });
      
      logger.info("System is running. Press Ctrl+C to stop.");
      
      // Keep the process running
      if (options.foreground) {
        process.stdin.resume();
      }
      break;
    }
    
    case "stop": {
      logger.info(`Stopping processes: ${processNames.length > 0 ? processNames.join(", ") : "all"}`);
      const supervisor = initializeSupervisor();
      
      await supervisor.start();
      
      if (processNames.length === 0) {
        // Stop all processes and shut down
        await supervisor.initiateShutdown({
          reason: "User requested stop all",
          exitProcess: true
        });
      } else {
        // Stop specific processes
        for (const processName of processNames) {
          const proc = supervisor["processes"].get(processName);
          if (proc) {
            logger.info(`Stopping process: ${processName}`);
            await proc.stop();
          } else {
            logger.warn(`Process not found: ${processName}`);
          }
        }
        
        // Shut down the supervisor
        await supervisor.initiateShutdown({
          reason: "User requested stop for specific processes",
          exitProcess: true
        });
      }
      break;
    }
    
    case "restart": {
      if (processNames.length === 0) {
        logger.error("No processes specified for restart");
        printUsage();
        process.exit(1);
      }
      
      logger.info(`Restarting processes: ${processNames.join(", ")}`);
      const supervisor = initializeSupervisor();
      
      await supervisor.start();
      
      for (const processName of processNames) {
        const proc = supervisor["processes"].get(processName);
        if (proc) {
          logger.info(`Restarting process: ${processName}`);
          await proc.restart();
        } else {
          logger.warn(`Process not found: ${processName}`);
        }
      }
      
      // Wait a moment for the restart to take effect
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Shut down the supervisor (but not the processes)
      await supervisor.initiateShutdown({
        reason: "Restart complete",
        exitProcess: true,
        force: false
      });
      break;
    }
    
    case "status": {
      const supervisor = initializeSupervisor();
      await supervisor.start();
      
      if (processNames.length === 0) {
        // Show status of all processes
        console.log("Managed Processes Status:");
        console.log("-----------------------");
        
        for (const [id, process] of supervisor["processes"].entries()) {
          const state = process.getState();
          const stateStr = getColoredState(state);
          
          console.log(`${id}: ${stateStr}`);
          console.log(`  Command: ${process.config.script} ${process.config.args?.join(" ") || ""}`);
          console.log(`  Auto-restart: ${process.config.autoRestart}`);
          console.log(`  Restart delay: ${process.config.restartDelay}ms`);
          console.log(`  Max restarts: ${process.config.maxRestarts}`);
          
          if (process.config.dependencies?.length) {
            console.log(`  Dependencies: ${process.config.dependencies.join(", ")}`);
          }
          
          console.log("-----------------------");
        }
      } else {
        // Show status of specific processes
        for (const processName of processNames) {
          const proc = supervisor["processes"].get(processName);
          if (proc) {
            const state = proc.getState();
            const stateStr = getColoredState(state);
            
            console.log(`Process: ${processName}`);
            console.log(`State: ${stateStr}`);
            console.log(`Command: ${proc.config.script} ${proc.config.args?.join(" ") || ""}`);
            console.log(`Auto-restart: ${proc.config.autoRestart}`);
            console.log(`Restart delay: ${proc.config.restartDelay}ms`);
            console.log(`Max restarts: ${proc.config.maxRestarts}`);
            
            if (proc.config.dependencies?.length) {
              console.log(`Dependencies: ${proc.config.dependencies.join(", ")}`);
            }
            
            console.log("-----------------------");
          } else {
            console.log(`Process not found: ${processName}`);
          }
        }
      }
      
      // Shut down the supervisor (but not the processes)
      await supervisor.initiateShutdown({
        reason: "Status check complete",
        exitProcess: true,
        force: false
      });
      break;
    }
    
    case "list": {
      const supervisor = initializeSupervisor();
      await supervisor.start();
      
      console.log("Managed Processes:");
      console.log("-----------------");
      
      for (const [id, process] of supervisor["processes"].entries()) {
        const state = process.getState();
        const stateStr = getColoredState(state);
        
        console.log(`${id}: ${stateStr}`);
      }
      
      // Shut down the supervisor
      await supervisor.initiateShutdown({
        reason: "List complete",
        exitProcess: true,
        force: false
      });
      break;
    }
    
    case "help":
    default:
      printUsage();
      break;
  }
}

// Helper function to get colored state string for better visibility
function getColoredState(state: ProcessState): string {
  switch (state) {
    case ProcessState.BUSY:
      return "\x1b[32mBUSY\x1b[0m"; // Green
    case ProcessState.STARTING:
      return "\x1b[33mSTARTING\x1b[0m"; // Yellow
    case ProcessState.STOPPING:
      return "\x1b[33mSTOPPING\x1b[0m"; // Yellow
    case ProcessState.STOPPED:
      return "\x1b[90mSTOPPED\x1b[0m"; // Gray
    case ProcessState.FAILED:
      return "\x1b[31mFAILED\x1b[0m"; // Red
    case ProcessState.IDLE:
      return "\x1b[36mIDLE\x1b[0m"; // Cyan
    case ProcessState.PAUSED:
      return "\x1b[34mPAUSED\x1b[0m"; // Blue
    default:
      return state;
  }
}

// Execute the main function
main().catch((err) => {
  console.error(`Error: ${err}`);
  process.exit(1);
});
