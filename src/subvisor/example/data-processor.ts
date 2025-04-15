// processes/data-processor.ts
import { SupervisorClient } from "../client";
import { ProcessState } from "../types";

async function main() {
  console.log("Data processor starting up...");

  // Connect to the supervisor with logging options
  const client = new SupervisorClient({
    logLevel: "debug",
    logFile: "./logs/data-processor.log"
  });

  // Handle process-specific events
  client.on("connected", () => {
    console.log("Connected to supervisor");
    client.updateState(ProcessState.IDLE);
  });

  client.on("disconnected", () => {
    console.log("Disconnected from supervisor, will attempt to reconnect");
  });

  client.on("stop", () => {
    console.log("Received stop command from supervisor");
    client.updateState(ProcessState.STOPPING);

    // Clean up
    setTimeout(() => {
      client.disconnect();
      process.exit(0);
    }, 1000);
  });

  client.on("restart", () => {
    console.log("Received restart command from supervisor");
    // In a real app, you might want to perform cleanup tasks here
  });

  // Listen for heartbeats from dependencies
  client.on("heartbeat", (originId) => {
    console.log(`Received heartbeat from ${originId}`);
  });

  // Listen for state changes from other processes
  client.on("stateChange", (originId, newState, oldState) => {
    console.log(`Process ${originId} changed state from ${oldState} to ${newState}`);
  });

  // Connect to the supervisor
  await client.connect();

  // Subscribe to heartbeats from another process
  client.subscribeToHeartbeats("api-service");

  // Simulate some work
  console.log("Data processor is now running...");

  // Simulate busy / idle cycle
  setInterval(() => {
    const isBusy = Math.random() > 0.7;
    client.updateState(isBusy ? ProcessState.BUSY : ProcessState.IDLE);

    if (isBusy) {
      console.log("Processing data...");

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
    console.log("Received SIGINT, shutting down gracefully");
    client.updateState(ProcessState.STOPPING);
    client.disconnect();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("Received SIGTERM, shutting down gracefully");
    client.updateState(ProcessState.STOPPING);
    client.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(`Error in data processor: ${err}`);
  process.exit(1);
});
