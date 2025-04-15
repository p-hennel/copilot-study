#!/usr/bin/env bun
/**
 * Simple script to run the GitLab website and crawler together
 * No fancy supervisor features, just process management
 * 
 * Enhanced to delay starting the crawler until authentication credentials
 * are received from the website via IPC.
 */

import { spawn } from "child_process"
import { existsSync, mkdirSync, unlinkSync } from "fs"
import { createServer } from "net"
import { dirname, join } from "path"

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0] || "start";
let processes = ["website", "crawler"]; // Default to both

// Check if specific processes are requested
if (args.length > 1 && !args[1].startsWith("--")) {
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
let authCredentials = null;

// Ensure directories exist
ensureDirExists(dirname(socketPath));
ensureDirExists(dirname(ipcSocketPath));
ensureDirExists(logDir);

// Print usage information
function printUsage() {
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
function ensureDirExists(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Start a process
function startProcess(cmd, name, env = {}) {
  console.log(`Starting ${name}...`);
  
  // Split the command into program and arguments
  const parts = cmd.split(" ");
  
  // Start the process
  const proc = spawn(parts[0], parts.slice(1), {
    stdio: "inherit",
    env: {
      ...process.env,
      ...env,
      SUPERVISOR_SOCKET_PATH: socketPath,
      SUPERVISOR_PROCESS_ID: name,
      AUTH_IPC_SOCKET_PATH: ipcSocketPath
    },
    shell: true
  });
  
  // Register event handlers
  proc.on("exit", (code, signal) => {
    console.log(`${name} exited with code ${code} and signal ${signal}`);
    
    // Restart if unexpected exit
    if (code !== 0 && signal !== "SIGTERM" && signal !== "SIGINT") {
      console.log(`Restarting ${name} in ${restartDelay}ms...`);
      setTimeout(() => {
        processes.includes(name) && startProcess(cmd, name, env);
      }, restartDelay);
    }
  });
  
  proc.on("error", (err) => {
    console.error(`${name} error: ${err}`);
    
    // Restart on error
    console.log(`Restarting ${name} in ${restartDelay}ms...`);
    setTimeout(() => {
      processes.includes(name) && startProcess(cmd, name, env);
    }, restartDelay);
  });
  
  return proc;
}

// Global array to track running processes
const runningProcesses = [];

// IPC server for auth credentials
function setupIpcServer() {
  // Remove existing socket file if it exists
  try {
    if (existsSync(ipcSocketPath)) {
      unlinkSync(ipcSocketPath);
    }
  } catch (err) {
    console.warn(`Could not remove existing socket file: ${err.message}`);
  }

  const server = createServer((socket) => {
    console.log('Client connected to auth IPC socket');
    
    let data = '';
    
    socket.on('data', (chunk) => {
      data += chunk.toString();
      
      try {
        const message = JSON.parse(data);
        
        if (message.type === 'auth') {
          console.log('Received authentication credentials from website');
          authCredentials = message.credentials;
          
          // Notify the client that credentials were received
          socket.write(JSON.stringify({ type: 'auth_ack', success: true }));
          
          // Start crawler if it's in the processes list and not already started
          if (processes.includes('crawler') && !runningProcesses.find(p => p.name === 'crawler')) {
            startCrawlerWithCredentials();
          }
        }
        
        // Reset data buffer after processing
        data = '';
      } catch (e) {
        // Not a complete JSON message yet, or invalid JSON
        if (e instanceof SyntaxError) {
          // Continue collecting data
        } else {
          console.error('Error processing IPC message:', e);
          data = '';
        }
      }
    });
    
    socket.on('error', (err) => {
      console.error('IPC socket error:', err);
    });
    
    socket.on('close', () => {
      console.log('Client disconnected from auth IPC socket');
    });
  });
  
  server.on('error', (err) => {
    console.error('IPC server error:', err);
    if (err.code === 'EADDRINUSE') {
      console.error(`IPC socket ${ipcSocketPath} is in use, trying to recover...`);
      try {
        unlinkSync(ipcSocketPath);
        console.log('Deleted existing socket file. Retrying...');
        setTimeout(() => {
          server.listen(ipcSocketPath);
        }, 1000);
      } catch (e) {
        console.error('Failed to recover:', e);
      }
    }
  });
  
  server.listen(ipcSocketPath, () => {
    console.log(`IPC server listening on ${ipcSocketPath}`);
  });
  
  return server;
}

// Function to start the crawler with authentication credentials
function startCrawlerWithCredentials() {
  if (!authCredentials) {
    console.log('Cannot start crawler: No authentication credentials received yet');
    return null;
  }
  
  console.log('Starting crawler with received authentication credentials');
  
  const crawlerEnv = {
    GITLAB_TOKEN: authCredentials.token || process.env.GITLAB_TOKEN || "dummy_token_for_init_only",
    GITLAB_CLIENT_ID: authCredentials.clientId || process.env.GITLAB_CLIENT_ID || "dummy_client_id",
    GITLAB_CLIENT_SECRET: authCredentials.clientSecret || process.env.GITLAB_CLIENT_SECRET || "dummy_client_secret"
  };
  
  const crawlerProc = startProcess(crawlerCmd, "crawler", crawlerEnv);
  runningProcesses.push({ name: "crawler", process: crawlerProc });
  return crawlerProc;
}

// Main function
async function main() {
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
  
  // Setup IPC server for authentication credentials
  const ipcServer = setupIpcServer();
  
  // Start website if requested
  if (processes.includes("website")) {
    const websiteEnv = {
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
    
    // Close IPC server
    ipcServer.close(() => {
      console.log("IPC server closed");
    });
    
    // Cleanup socket file
    try {
      if (existsSync(ipcSocketPath)) {
        unlinkSync(ipcSocketPath);
      }
    } catch (err) {
      console.warn(`Could not remove socket file: ${err.message}`);
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
main().catch(err => {
  console.error(`Error: ${err}`);
  process.exit(1);
});