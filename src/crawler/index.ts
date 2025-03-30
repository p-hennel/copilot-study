// src/crawler/index.ts
// Main entry point for the crawler

import { startCrawler } from "./crawler"
import { configureLogging } from "$lib/logging" // Import logtape helpers
import type { Logger } from "@logtape/logtape"

let logger: Logger

async function main() {
  logger = await configureLogging("crawler") // Configure logging for crawler
  logger.info("Starting crawler...")
  await startCrawler()
  logger.info("Crawler finished.")
}

main().catch((err) => {
  // Ensure logger is initialized before using it in catch block
  if (logger) {
    logger.error("Crawler error:", { error: err })
  } else {
    // Fallback if logger initialization failed
    console.error("Crawler error (logger not initialized):", err)
  }
  process.exit(1)
})
