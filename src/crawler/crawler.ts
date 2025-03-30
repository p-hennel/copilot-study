// src/crawler/crawler.ts
import { setupIPC } from "./ipc"
import { JobManager } from "./jobManager"
import { Storage } from "./storage"
import type { CrawlerCommand } from "./types"
import { getLogger } from "$lib/logging" // Import logtape helper
import { CrawlerCommand } from "./types"

const logger = getLogger(["crawler", "main"]) // Create a logger for this module

export async function startCrawler() {
  logger.info("Initializing crawler components...")

  const storage = new Storage("./crawled_data") // Define base path for crawled data
  const jobManager = new JobManager(logger.getChild("Job Manager"), storage)

  // Setup IPC communication using the new stdin/stdout mechanism
  const ipc = setupIPC(logger, {
    onCommand: (command: CrawlerCommand | { payload: CrawlerCommand }) => {
      logger.info("Received command", { command })
      // Handle commands like start, pause, resume, new job, etc.
      if ("payload" in command) command = command.payload
      jobManager.handleCommand(command)
    },
    // Add the required onShutdown handler
    onShutdown: async (signal?: string) => {
      logger.warn(`Received shutdown signal (${signal || "unknown"}). Initiating graceful shutdown...`)
      try {
        // Call the existing shutdown method which handles cleanup
        await jobManager.shutdown()
        logger.info("Job manager shutdown initiated.")
        // Add any other *immediate* cleanup needed before exit, if any
        // await storage.close();
        logger.info("Graceful shutdown complete.")
        process.exit(0) // Exit cleanly
      } catch (error) {
        logger.error("Error during graceful shutdown:", { error })
        process.exit(1) // Exit with error code if shutdown fails
      }
    }
  })

  // Inject the actual IPC send functions into the JobManager instance
  // JobManager uses these to send status updates/heartbeats/job updates back via stdout
  jobManager.setIPCFunctions(ipc.sendStatus, ipc.sendHeartbeat, ipc.sendMessage)

  logger.info("Components initialized and IPC connected via stdin/stdout.")

  // Start the job manager's processing loop (optional - could be triggered by IPC command)
  // jobManager.startProcessing(); // Uncomment if you want it to start automatically

  logger.info("Running and waiting for commands via stdin...")

  // No need for infinite wait anymore, process will exit via onShutdown handler
}
