#!/usr/bin/env bun

import { getLogger, configureLogging } from "./src/lib/logging";
import { existsSync, mkdirSync } from "fs";

async function testLogging() {
  console.log("=== Setting up Logtape Configuration ===");
  
  // Ensure logs directory exists
  if (!existsSync("./logs")) {
    mkdirSync("./logs", { recursive: true });
    console.log("Created logs directory");
  }
  
  // Set environment variables for testing
  process.env.LOG_LEVEL = "debug";
  console.log("Set LOG_LEVEL=debug");
  
  // Configure logging first
  await configureLogging("test", "./logs", true, true); // verbose=true, debug=true
  
  console.log("=== Testing Logtape Configuration ===");

  // Test different logger categories
  const testLogger = getLogger(["test"]);
  const apiLogger = getLogger(["api", "test"]);
  const backendLogger = getLogger(["backend"]);
  const messagingLogger = getLogger(["messaging", "client"]);
  const supervisorLogger = getLogger(["backend", "supervisor"]);

  console.log("--- Testing log levels ---");
  testLogger.debug("🐛 This is a debug message from test logger");
  testLogger.info("ℹ️ This is an info message from test logger");
  testLogger.warn("⚠️ This is a warning message from test logger");
  testLogger.error("❌ This is an error message from test logger");

  console.log("--- Testing different categories ---");
  apiLogger.info("📡 This is an info message from API logger");
  backendLogger.info("🖥️ This is an info message from backend logger");
  messagingLogger.info("💬 This is an info message from messaging logger");
  supervisorLogger.info("👑 This is an info message from supervisor logger");

  console.log("--- Testing structured logging ---");
  testLogger.info("Testing structured logging", {
    userId: 123,
    action: "test",
    data: { key: "value" },
    timestamp: new Date().toISOString()
  });

  console.log("--- Testing error with context ---");
  testLogger.error("Database connection failed", {
    error: new Error("Connection timeout"),
    host: "localhost",
    port: 5432
  });

  console.log("=== End of logging test ===");
  console.log("Check the ./logs directory for log files");
}

// Run the test
testLogging().catch(console.error);