#!/usr/bin/env bun
// src/cli.ts
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { supervisorSettings } from './settings';
import { Supervisor } from './supervisor';

// Parse command line arguments
const args = process.argv.slice(2);
let configPath = './supervisor.yaml';
let command = 'start';
let processId: string | null = null;

// Parse arguments
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  
  if (arg === '--config' || arg === '-c') {
    configPath = args[++i] ?? "";
  } else if (arg === 'start' || arg === 'stop' || arg === 'restart' || arg === 'status' || arg === 'list' || arg === 'reload-config') {
    command = arg;
  } else if (arg?.startsWith('--')) {
    console.error(`Unknown option: ${arg}`);
    printUsage();
    process.exit(1);
  } else {
    processId = arg ?? null;
  }
}

// Ensure config file exists
if (!existsSync(configPath)) {
  console.error(`Config file not found: ${configPath}`);
  process.exit(1);
}

// Execute the requested command
async function main() {
  if (!process)
    throw new Error('No process interface available');
  
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
  
  switch (command) {
    case 'start':
      if (processId) {
        // Start a specific process
        await supervisor.start();
        const proc = supervisor['processes'].get(processId);
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
        console.log('Supervisor started');
        
        // Keep running
        process.stdin.resume();
      }
      break;
      
    case 'stop':
      if (processId) {
        // Stop a specific process
        await supervisor.start();
        const proc = supervisor['processes'].get(processId);
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
        console.log('Stopping all processes...');
        await supervisor.initiateShutdown();
      }
      break;
      
    case 'restart':
      { if (!processId) {
        console.error('Process ID required for restart command');
        printUsage();
        process.exit(1);
      }
      
      await supervisor.start();

      if (!processId) {
        console.error('Process ID required for restart command');
        printUsage();
        process.exit(1);
      }
      const proc = supervisor['processes'].get(processId);
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
      break; }
      
    case 'status':
      { if (!processId) {
        console.error('Process ID required for status command');
        printUsage();
        process.exit(1);
      }
      
      await supervisor.start();
      const targetProcess = supervisor['processes'].get(processId);
      if (!targetProcess) {
        console.error(`Process not found: ${processId}`);
        await supervisor.initiateShutdown();
        process.exit(1);
      }
      
      console.log(`Process: ${processId}`);
      console.log(`State: ${targetProcess.getState()}`);
      console.log(`Config:`, targetProcess.config);
      
      await supervisor.initiateShutdown();
      break; }
      
    case 'list':
      await supervisor.start();
      console.log('Managed Processes:');
      console.log('-----------------');
      
      for (const [id, process] of supervisor['processes'].entries()) {
        console.log(`ID: ${id}`);
        console.log(`State: ${process.getState()}`);
        console.log(`Script: ${process.config.script}`);
        console.log(`Auto-restart: ${process.config.autoRestart}`);
        
        if (process.config.dependencies?.length) {
          console.log(`Dependencies: ${process.config.dependencies.join(', ')}`);
        }
        
        console.log('-----------------');
      }
      
      await supervisor.initiateShutdown();
      break;
      
    case 'reload-config':
      // New command that utilizes settings manager
      await supervisor.start();
      console.log('Reloading configuration...');
      
      // Force reload settings
      supervisorSettings.reload();
      
      console.log('Configuration reloaded');
      
      // For simplicity, we'll just continue running after reload
      // In a real implementation, you might want to handle process restarts here
      if (processId) {
        // If a process ID was specified, restart that process
        const proc = supervisor['processes'].get(processId);
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
  console.log('Usage: bun run cli.ts [options] [command] [process-id]');
  console.log('');
  console.log('Options:');
  console.log('  --config, -c <path>    Path to config file (default: ./supervisor.yaml)');
  console.log('');
  console.log('Commands:');
  console.log('  start [process-id]     Start the supervisor or a specific process');
  console.log('  stop [process-id]      Stop the supervisor or a specific process');
  console.log('  restart <process-id>   Restart a specific process');
  console.log('  status <process-id>    Show status of a specific process');
  console.log('  list                   List all managed processes');
  console.log('  reload-config [proc]   Reload configuration and optionally restart a process');
}

main().catch(err => {
  console.error(`Error: ${err}`);
  process.exit(1);
});