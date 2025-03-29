// src/crawler/ipc.ts
import type { CrawlerCommand, CrawlerStatus } from "./types";
import { Server as SocketIOServer } from "socket.io"; // Renamed import
import { createServer } from "http";
import { createAdapter } from "@socket.io/cluster-adapter";
import { setupWorker } from "@socket.io/sticky";

// Keep the interfaces, they define the contract with crawler.ts
interface IPCHandlers {
  onCommand: (command: CrawlerCommand) => void;
  // These will be replaced by the actual sending functions upon setup
  sendStatus: (status: CrawlerStatus) => void;
  sendHeartbeat: () => void;
}

interface IPCInstance {
  // Functions the crawler logic can call to send messages
  sendStatus: (status: CrawlerStatus) => void;
  sendHeartbeat: () => void;
}

/**
 * Sets up the IPC communication channel for the crawler process.
 * Listens for commands from the main process and provides functions
 * to send status and heartbeats back.
 * @param handlers Object containing callback functions for handling commands and sending messages.
 * @returns An object with functions to send messages to the main process.
 */
export function setupIPC(handlers: IPCHandlers): IPCInstance {
  console.log("Setting up Socket.IO server with PM2 adapter...");

  const httpServer = createServer();
  // Create Socket.IO server instance
  // Consider adding options like CORS if needed, though likely not for PM2 IPC
  const io = new SocketIOServer(httpServer);
  io.adapter(createAdapter());

  setupWorker(io);

  // Listen for client connections (from the SvelteKit backend)
  io.on("connection", (socket) => {
    console.log(`Socket.IO client connected: ${socket.id}`);

    // Listen for 'command' events from this specific client
    socket.on("command", (command: unknown) => {
      // Basic validation (similar to before, but checking the received command)
      if (
        typeof command === "object" &&
        command !== null &&
        "type" in command &&
        typeof command.type === "string"
      ) {
        console.log(`Received command via Socket.IO: ${command.type}`);
        // Add more robust validation if needed (e.g., using Zod)
        if (
          ["START_JOB", "PAUSE_CRAWLER", "RESUME_CRAWLER", "GET_STATUS", "SHUTDOWN"].includes(
            command.type
          )
        ) {
          handlers.onCommand(command as CrawlerCommand);
        } else {
          console.warn("Received command with unknown type via Socket.IO:", command.type);
        }
      } else {
        console.warn("Received unexpected command format via Socket.IO:", command);
      }
    });

    socket.on("disconnect", (reason) => {
      console.log(`Socket.IO client disconnected: ${socket.id}, Reason: ${reason}`);
    });
  });

  // Function to broadcast status updates to all connected clients
  const sendStatusToMain = (status: CrawlerStatus) => {
    try {
      // console.log('Broadcasting status update via Socket.IO:', status);
      io.emit("statusUpdate", status); // Use io.emit to send to all clients
    } catch (error) {
      console.error("Failed to broadcast status update via Socket.IO:", error);
    }
  };

  // Function to broadcast heartbeats to all connected clients
  const sendHeartbeatToMain = () => {
    try {
      // console.log('Broadcasting heartbeat via Socket.IO');
      io.emit("heartbeat", { timestamp: Date.now() }); // Use io.emit
    } catch (error) {
      console.error("Failed to broadcast heartbeat via Socket.IO:", error);
    }
  };

  // Overwrite the placeholder functions in handlers with the actual Socket.IO emitters
  handlers.sendStatus = sendStatusToMain;
  handlers.sendHeartbeat = sendHeartbeatToMain;

  // Start the Socket.IO server listening (needs a port, but PM2 adapter might handle this implicitly? Check docs if issues arise)
  // For PM2 adapter, often you don't need to explicitly call listen() as PM2 handles the process communication.
  // If connection issues occur, you might need: io.listen(SOME_PORT); - but try without first.
  console.log("Socket.IO server setup complete. Waiting for connections...");

  // Return an object containing the functions the crawler can use to send messages
  return {
    sendStatus: sendStatusToMain,
    sendHeartbeat: sendHeartbeatToMain
  };
}
