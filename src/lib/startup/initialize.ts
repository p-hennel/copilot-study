// src/lib/startup/initialize.ts - Application startup initialization
import { getLogger } from "@logtape/logtape";

// Import direct communication manager to ensure connection starts immediately
import directCommunicationManager from "$lib/server/direct-communication-manager";

const logger = getLogger(["startup", "initialize"]);

/**
 * Initialize the application components that should start immediately
 * This ensures the direct socket connection is established as soon as the app starts,
 * not when a user first accesses the webpage
 */
export async function initializeApplication(): Promise<void> {
  try {
    logger.info("🚀 Starting application initialization with DirectCommunicationManager...");

    // Ensure DirectCommunicationManager is initialized
    await directCommunicationManager.initialize();
    
    if (directCommunicationManager.isConnected()) {
      logger.info("✅ DirectCommunicationManager is available and connected");
    } else {
      logger.info("⚡ DirectCommunicationManager is available and attempting connection");
    }
    
    logger.info("✅ Application initialization completed with direct communication system");
    
  } catch (error) {
    logger.error("❌ Error during application initialization:", { error });
    throw error;
  }
}

// Auto-initialize when this module is imported
initializeApplication().catch((error) => {
  logger.error("❌ Failed to initialize application: {error}", { error });
  // Don't exit the process - let the app continue to run
});