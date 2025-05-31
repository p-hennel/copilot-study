// src/lib/startup/initialize.ts - Application startup initialization
import { getLogger } from "@logtape/logtape";

// Import message bus client to ensure socket connection starts immediately
import messageBusClientInstance from "$lib/messaging/MessageBusClient";

// Import supervisor functionality 
import "$lib/server/supervisor";

const logger = getLogger(["startup", "initialize"]);

/**
 * Initialize the application components that should start immediately
 * This ensures the socket connection is established as soon as the app starts,
 * not when a user first accesses the webpage
 */
export async function initializeApplication(): Promise<void> {
  try {
    logger.info("🚀 Starting application initialization...");

    // Ensure MessageBusClient is initialized and attempting connection
    if (messageBusClientInstance) {
      logger.info("✅ MessageBusClient is available and initialized");
      
      // Add a listener to log when connection is established
      messageBusClientInstance.on("connected", () => {
        logger.info("🔌 Socket connection to crawler established successfully");
      });
      
      messageBusClientInstance.on("disconnected", () => {
        logger.warn("🔌 Socket connection to crawler lost");
      });
      
      messageBusClientInstance.on("error", (error) => {
        logger.error("❌ Socket connection error: {error}", { error });
      });
      
    } else {
      logger.warn("⚠️ MessageBusClient not available - crawler connection disabled");
    }

    // Import supervisor to ensure event listeners are set up
    // (This happens automatically when the module is imported)
    
    logger.info("✅ Application initialization completed");
    
  } catch (error) {
    logger.error("❌ Error during application initialization:", { error });
    throw error;
  }
}

// Auto-initialize when this module is imported
initializeApplication().catch((error) => {
  // We can't use the logger here since initialization may have failed
  logger.error("❌ Failed to initialize application: {error}", { error });
  // Don't exit the process - let the app continue to run
});