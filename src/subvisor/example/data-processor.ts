// processes/data-processor.ts
import { SupervisorClient } from "../client";
import { ProcessState } from "../types";
import { getLogger } from "@logtape/logtape";
const logger = getLogger(["subvisor","example"]);

async function main() {
  logger.info("Data processor starting up...");

  // Connect to the supervisor with logging options
  const client = new SupervisorClient({
    logLevel: "debug",
    logFile: "./logs/data-processor.log"
  });

  // Handle process-specific events
  client.on("connected", () => {
    logger.info("Connected to supervisor");
    client.updateState(ProcessState.IDLE);
  });

  client.on("disconnected", () => {
    logger.info("Disconnected from supervisor, will attempt to reconnect");
  });

  client.on("stop", () => {
    logger.info("Received stop command from supervisor");
    client.updateState(ProcessState.STOPPING);

    // Clean up
    setTimeout(() => {
      client.disconnect();
      process.exit(0);
    }, 1000);
  });

  client.on("restart", () => {
    logger.info("Received restart command from supervisor");
    // In a real app, you might want to perform cleanup tasks here
  });

  // Listen for heartbeats from dependencies
  client.on("heartbeat", (originId) => {
    logger.info(`Received heartbeat from ${originId}`);
  });

  // Listen for state changes from other processes
  client.on("stateChange", (originId, newState, oldState) => {
    logger.info(`Process ${originId} changed state from ${oldState} to ${newState}`);
  });

  // Connect to the supervisor
  await client.connect();

  // Subscribe to heartbeats from another process
  client.subscribeToHeartbeats("api-service");

  // Simulate some work
  logger.info("Data processor is now running...");

  // Simulate busy / idle cycle
  setInterval(() => {
    const isBusy = Math.random() > 0.7;
    client.updateState(isBusy ? ProcessState.BUSY : ProcessState.IDLE);

    if (isBusy) {
      logger.info("Processing data...");

      // Simulate sending a message to another process
      client.sendMessage("api-service", "dataUpdate", {
        timestamp: Date.now(),
        records: Math.floor(Math.random() * 100)
      });
    }
  }, 5000);

  // Keep process running
  process.stdin.resume();

  // Handle process termination signals
  process.on("SIGINT", async () => {
    logger.info("Received SIGINT, shutting down gracefully");
    client.updateState(ProcessState.STOPPING);
    client.disconnect();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    logger.info("Received SIGTERM, shutting down gracefully");
    client.updateState(ProcessState.STOPPING);
    client.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error(`Error in data processor: ${err}`);
  process.exit(1);
});
