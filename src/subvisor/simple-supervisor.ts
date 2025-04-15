#!/usr/bin/env bun
/**
 * Simple script to run the GitLab website and crawler together
 * No fancy supervisor features, just process management
 * 
 * Enhanced to delay starting the crawler until authentication credentials
 * are received from the website via IPC.
 * 
 * Updated to use SupervisorClient for all communications.
 */

import { ChildProcess, spawn } from "child_process";
import { existsSync, mkdirSync, unlinkSync } from "fs";
import { dirname, join } from "path";
import { SupervisorClient } from "./client";
import type { IPCMessage } from "./types";
import { MessageType } from "./types";

// Authentication credentials interface
interface AuthCredentials {
  token: string;
  clientId: string;
  clientSecret: string;
  [key: string]: any;
}

// Process information tracking
interface RunningProcess {
  name: string;
  process: ChildProcess;
}

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0] || "start";
let processes: string[] = ["website", "crawler"]; // Default to both

// Check if specific processes are requested
if (args.length > 1 && args[1] && !args[1].startsWith("--")) {
  const requestedProcesses = args[1].split(",");
  processes = requestedProcesses.filter(p => 
    p === "website" || p === "crawler"
  );
}

// Common configuration
const socketPath = join(process.cwd(), "tmp", "supervisor.sock");
const ipcSocketPath = join(process.cwd(), "tmp", "auth-ipc.sock");
const websiteCmd = "bun run dev";
const crawlerCmd = "bun run src/crawler/cli.ts --outputDir ./data";
const restartDelay = 5000;
const logDir = "./logs";
let authCredentials: AuthCredentials | null = null;

// Ensure directories exist
ensureDirExists(dirname(socketPath));
ensureDirExists(dirname(ipcSocketPath));
ensureDirExists(logDir);

// Print usage information
function printUsage(): void {
  console.log("Usage: bun run simple-supervisor start [website,crawler]");
  console.log("");
  console.log("Commands:");
  console.log("  start [processes]    Start the specified processes");
  console.log("  help                 Show this help");
  console.log("");
  console.log("Processes:");
  console.log("  website              The web server");
  console.log("  crawler              The GitLab crawler");
  console.log("");
  console.log("Examples:");
  console.log("  bun run simple-supervisor start            # Start both");
  console.log("  bun run simple-supervisor start website    # Start only website");
  console.log("  bun run simple-supervisor start crawler    # Start only crawler");
  console.log("");
  console.log("Note: The crawler will not start until GitLab credentials are received from the website via IPC.");
}

// Helper to ensure directories exist
function ensureDirExists(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Start a process
function startProcess(cmd: string, name: string, env: Record<string, string> = {}): ChildProcess {
  console.log(`Starting ${name}...`);
  
  // Split the command into program and arguments
  const parts = cmd.split(" ");
  
  // Ensure command parts are defined
  const command = parts[0] || "";
  const args = parts.slice(1).filter(Boolean);
  
  // Start the process with proper environment casting
  const processEnv = Object.assign({}, process.env);
  
  // Add our custom environment variables
  Object.assign(processEnv, env, {
    SUPERVISOR_SOCKET_PATH: socketPath,
    SUPERVISOR_PROCESS_ID: name,
    AUTH_IPC_SOCKET_PATH: ipcSocketPath
  });
  
  // Start the process
  const proc = spawn(command, args, {
    stdio: "inherit",
    env: processEnv,
    shell: true
  });
  
  // Register event handlers with type assertions to avoid "never" type issues
  const typedProc = proc as unknown as {
    on(event: string, listener: (...args: any[]) => void): any;
    kill(signal?: string): void;
  };
  
  typedProc.on("exit", (code: number | null, signal: string | null) => {
    console.log(`${name} exited with code ${code} and signal ${signal}`);
    
    // Restart if unexpected exit
    if (code !== 0 && signal !== "SIGTERM" && signal !== "SIGINT") {
      console.log(`Restarting ${name} in ${restartDelay}ms...`);
      setTimeout(() => {
        if (processes.includes(name)) {
          startProcess(cmd, name, env);
        }
      }, restartDelay);
    }
  });
  
  typedProc.on("error", (err: Error) => {
    console.error(`${name} error: ${err.message}`);
    
    // Restart on error
    console.log(`Restarting ${name} in ${restartDelay}ms...`);
    setTimeout(() => {
      if (processes.includes(name)) {
        startProcess(cmd, name, env);
      }
    }, restartDelay);
  });
  
  return proc;
}

// Global array to track running processes
const runningProcesses: RunningProcess[] = [];

// Supervisor socket setup return interface
interface SupervisorSetup {
  client: SupervisorClient;
  server: any; // Using any to avoid Bun-specific type issues
}

// Function to set up the SupervisorClient to handle IPC
function setupSupervisorClient(): SupervisorSetup {
  // Remove existing socket file if it exists
  try {
    if (existsSync(socketPath)) {
      unlinkSync(socketPath);
    }
  } catch (err: unknown) {
    const error = err as Error;
    console.warn(`Could not remove existing socket file: ${error.message}`);
  }
  
  // Create SupervisorClient instance
  const supervisorClient = new SupervisorClient({
    id: "supervisor",
    socketPath
  });

  // Set up server using Bun's Unix socket
  const server = Bun.listen({
    unix: socketPath,
    socket: {
      data: (socket: any, data: Buffer) => {
        try {
          const message = JSON.parse(data.toString()) as IPCMessage;
          
          // Process the message - this will automatically emit events
          // for the client to handle through its event handlers
          handleIncomingMessage(supervisorClient, socket, message);
        } catch (err: unknown) {
          const error = err as Error;
          console.error(`Error handling message: ${error.message}`);
        }
      },
      open: () => {
        console.log(`Client connected to socket: ${socketPath}`);
      },
      close: () => {
        console.log(`Client disconnected from socket: ${socketPath}`);
      },
      error: (_: any, error: Error) => {
        console.error(`Socket error: ${error.message}`);
      }
    }
  });
  
  // Set up event listeners for auth credentials
  supervisorClient.on("message", (originId: string, key: string, payload: any) => {
    if (key === "auth_credentials") {
      console.log(`Received authentication credentials from ${originId}`);
      
      authCredentials = payload as AuthCredentials;
      
      // Start crawler if it's in the processes list and not already started
      if (processes.includes('crawler') && !runningProcesses.find(p => p.name === 'crawler')) {
        startCrawlerWithCredentials();
      }
    }
  });
  
  return {
    client: supervisorClient,
    server
  };
}

// Helper function to handle incoming socket messages
function handleIncomingMessage(client: SupervisorClient, _socket: any, message: IPCMessage): void {
  // Make sure message has required fields
  if (!message.origin || !message.type) {
    console.warn("Invalid message format received");
    return;
  }
  
  // Process the message based on its type
  switch (message.type) {
    case MessageType.MESSAGE:
      client.emit("message", message.origin, message.key, message.payload);
      break;
    
    case MessageType.COMMAND:
      client.emit("command", message.key, message.payload);
      break;
      
    case MessageType.STATE_CHANGE:
      client.emit("stateChange", message.origin, message.payload.newState, message.payload.oldState);
      break;
      
    case MessageType.HEARTBEAT:
      client.emit("heartbeat", message.origin, message.payload);
      break;
      
    default:
      console.warn(`Unknown message type: ${message.type}`);
  }
}

// Function to start the crawler with authentication credentials
function startCrawlerWithCredentials(): ChildProcess | null {
  if (!authCredentials) {
    console.log('Cannot start crawler: No authentication credentials received yet');
    return null;
  }
  
  console.log('Starting crawler with received authentication credentials');
  
  const crawlerEnv: Record<string, string> = {
    GITLAB_TOKEN: authCredentials.token || process.env.GITLAB_TOKEN || "dummy_token_for_init_only",
    GITLAB_CLIENT_ID: authCredentials.clientId || process.env.GITLAB_CLIENT_ID || "dummy_client_id",
    GITLAB_CLIENT_SECRET: authCredentials.clientSecret || process.env.GITLAB_CLIENT_SECRET || "dummy_client_secret"
  };
  
  const crawlerProc = startProcess(crawlerCmd, "crawler", crawlerEnv);
  runningProcesses.push({ name: "crawler", process: crawlerProc });
  return crawlerProc;
}

// Main function
async function main(): Promise<void> {
  if (command === "help") {
    printUsage();
    process.exit(0);
  }
  
  if (command !== "start") {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }
  
  console.log(`Starting processes: ${processes.join(", ")}`);
  
  // Set up the SupervisorClient for IPC
  const supervisor = setupSupervisorClient();
  
  // Initialize the supervisor client
  await supervisor.client.connect();
  
  // Start website if requested
  if (processes.includes("website")) {
    const websiteEnv: Record<string, string> = {
      DATABASE_URL: process.env.DATABASE_URL || join(process.cwd(), "data.private/config/main.db"),
      DATA_ROOT: process.env.DATA_ROOT || join(process.cwd(), "data.private"),
      SETTINGS_FILE: process.env.SETTINGS_FILE || join(process.cwd(), "data.private/config/settings.yaml")
    };
    
    const websiteProc = startProcess(websiteCmd, "website", websiteEnv);
    runningProcesses.push({ name: "website", process: websiteProc });
    
    // Log that we're waiting for credentials before starting crawler
    if (processes.includes("crawler")) {
      console.log("Waiting for authentication credentials from website before starting crawler...");
    }
  }
  
  // Start crawler immediately only if we already have environment variables
  // and auth credentials weren't received yet
  if (processes.includes("crawler") && process.env.GITLAB_TOKEN && !authCredentials) {
    console.log("Using environment variables for crawler authentication");
    startCrawlerWithCredentials();
  }
  
  console.log("Supervisor started. Press Ctrl+C to stop all processes.");
  
  // Set up signal handling for clean shutdown
  process.on("SIGINT", () => {
    console.log("\nShutting down all processes...");
    processes = []; // Prevent restarts
    
    // Kill all processes
    for (const proc of runningProcesses) {
      console.log(`Stopping ${proc.name}...`);
      proc.process.kill("SIGTERM");
    }
    
    // Close the supervisor client and server
    supervisor.client.disconnect();
    
    if (supervisor.server && typeof supervisor.server.close === 'function') {
      supervisor.server.close();
    }
    
    // Cleanup socket file
    try {
      if (existsSync(socketPath)) {
        unlinkSync(socketPath);
      }
    } catch (err: unknown) {
      const error = err as Error;
      console.warn(`Could not remove socket file: ${error.message}`);
    }
    
    // Exit after a short delay
    setTimeout(() => {
      console.log("All processes stopped.");
      process.exit(0);
    }, 2000);
  });
  
  // Keep the process running
  process.stdin.resume();
}

// Run the main function
main().catch((err: unknown) => {
  const error = err as Error;
  console.error(`Error: ${error.message}`);
  process.exit(1);
});