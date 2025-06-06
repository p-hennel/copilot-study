// src/lib/startup/initialize.ts - Application startup initialization
import { getLogger, type Logger } from "@logtape/logtape";

import { getDefaultSocketServer, SocketServer } from "$lib/server/socket";
import AppSettings from "$lib/server/settings";
import doMigration from "$lib/server/db/migration";
import { performStartupRecovery, setupPeriodicRecovery } from "$lib/server/startup-recovery";
import { syncAdminRoles } from "$lib/server/utils";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { configureLogging } from "$lib/logging";

const logger = getLogger(["startup", "initialize"]);
let initialized = false
let firstCaller: Promise<void>|undefined
let socketServer: SocketServer | undefined

export const getSocketServer = () => {
  return socketServer
}

export async function initialLogger() {
  const bunHomeData = path.join("/", "home", "bun", "data")
  const logsDir = path.join(bunHomeData, "logs")
  if (existsSync(bunHomeData) && !existsSync(logsDir)) {
    mkdirSync(logsDir)
  }
  
  const logger: Logger|null|undefined = await configureLogging("backend", existsSync(logsDir) ? logsDir : process.cwd())
  
  if (logger === null || logger === undefined) {
    throw new Error("CRITICAL: Logger initialization failed. Cannot set up event listeners.")
  }

  return logger
}

/**
 * Initialize the application components that should start immediately
 * This ensures the socket connection is established as soon as the app starts,
 * not when a user first accesses the webpage
 */
export async function initializeApplication(): Promise<void> {
  if (initialized) return
  if (!firstCaller) {
    firstCaller = delayedInitializeApplication();
    await firstCaller
  } else {
    await _initializeApplication()
  }
}

async function delayedInitializeApplication(delayMs = 500) {
  return new Promise(delayInitializeApplication(delayMs))
}

function delayInitializeApplication(delayMs: number): (resolve: (value: void | PromiseLike<void>) => void) => void {
  return (
    (resolve: (value: void | PromiseLike<void>) => void) => {
      setTimeout(() => {
        _initializeApplication(resolve);
      }, delayMs)
    }
  )
}

async function _initializeApplication(resolve?: (value: void | PromiseLike<void>) => void): Promise<void> {
  if (initialized) return
  try {
    initialized = true
    logger.info("🚀 Starting application initialization...");

    const settings = AppSettings()

    try { if (settings) await doMigration(settings.paths.database) }
    catch (error) { logger.error("Error during migration:", { error }) }
    try {
      await performStartupRecovery();
      setupPeriodicRecovery();
    } catch (error) { logger.error("Error setting up job recovery:", { error }) }

    try { await syncAdminRoles() }
    catch (error) { logger.error("CRITICAL: Failed to initialize logging or AppSettings"); logger.error(error as any) }

    socketServer = await getDefaultSocketServer()

    logger.info("✅ Application initialization completed");
    
  } catch (error) {
    logger.error("❌ Error during application initialization:", { error });
    throw error;
  }

  if (resolve) {
    resolve()
  }
}

// Auto-initialize when this module is imported
initializeApplication().catch((error) => {
  // We can't use the logger here since initialization may have failed
  logger.error("❌ Failed to initialize application: {error}", { error });
  // Don't exit the process - let the app continue to run
});

export function prepareSocketLocation() {
  if (!process.env.SOCKET_PATH) {
    const socketDir = path.join(process.cwd(), "data.private", "config");
    process.env.SOCKET_PATH = path.join(socketDir, "api.sock");
    
    // Ensure socket directory exists
    if (!existsSync(socketDir)) {
      mkdirSync(socketDir, { recursive: true });
    }
  }
}