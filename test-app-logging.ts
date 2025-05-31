#!/usr/bin/env bun

// Test the actual application logging setup
import { existsSync, mkdirSync } from "fs";
import path from "path";

// Set up environment like the app does
const bunHomeData = process.env.DATA_ROOT || path.join(process.cwd(), "data.private");
const logsDir = path.join(bunHomeData, "logs");

console.log("=== Testing Application Logging Setup ===");
console.log("bunHomeData:", bunHomeData);
console.log("logsDir:", logsDir);

// Create logs directory if it doesn't exist
if (existsSync(bunHomeData) && !existsSync(logsDir)) {
  mkdirSync(logsDir, { recursive: true });
  console.log("Created logs directory");
}

// Import app settings and logging
import AppSettings from "./src/lib/server/settings";
import { configureLogging, getLogger } from "./src/lib/logging";

async function testAppLogging() {
  try {
    console.log("--- Initializing settings ---");
    const settings = AppSettings();
    console.log("Settings loaded:", settings ? "✅" : "❌");

    console.log("--- Configuring logging ---");
    // Set debug environment variable
    process.env.LOG_LEVEL = "debug";
    
    const logger = await configureLogging("backend", existsSync(logsDir) ? logsDir : process.cwd(), true, true);
    console.log("Logging configured");

    console.log("--- Testing loggers ---");
    logger.info("🚀 Main backend logger test");
    
    // Test the loggers that were created by our script fixes
    const apiLogger = getLogger(["api", "admin", "jobs"]);
    const messagingLogger = getLogger(["messaging", "client"]);
    const supervisorLogger = getLogger(["backend", "supervisor"]);
    const authLogger = getLogger(["auth", "client"]);
    
    apiLogger.info("📡 API logger test");
    messagingLogger.info("💬 Messaging logger test");
    supervisorLogger.info("👑 Supervisor logger test");
    authLogger.info("🔐 Auth logger test");

    console.log("--- Testing structured logging ---");
    logger.info("Structured log test", {
      component: "test",
      action: "validation",
      details: { success: true, timestamp: new Date().toISOString() }
    });

    console.log("=== App logging test completed ===");
    console.log("Check console output above and log files in:", logsDir);
    
  } catch (error) {
    console.error("❌ Error during app logging test:", error);
  }
}

// Run the test
testAppLogging().catch(console.error);