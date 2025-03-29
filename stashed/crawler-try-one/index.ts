import {
  MessageType,
  setupIpcListener,
  sendToBackend,
  isBackendToCrawlerMessage,
  type BackendToCrawlerMessage,
} from './ipc';
// JobManager will be created in the next step
// import { JobManager } from './job-manager';

console.log(`[Crawler ${process.pid}] Starting...`);

// --- Configuration ---
const HEARTBEAT_INTERVAL_MS = 30 * 1000; // Send heartbeat every 30 seconds

// --- State ---
let heartbeatInterval: Timer | null = null;
// const jobManager = new JobManager(); // Instantiate when JobManager is defined

// --- IPC Communication ---

function handleIncomingMessage(message: BackendToCrawlerMessage) {
  console.log(`[Crawler ${process.pid}] Received IPC message:`, message.type);
  switch (message.type) {
    case MessageType.START_JOB:
      // jobManager.startJob(message.payload, message.initialState);
      console.log(`[Crawler ${process.pid}] Received START_JOB for ${message.jobId}`); // Placeholder
      break;
    case MessageType.CONTROL_COMMAND:
      // jobManager.handleControlCommand(message.command, message.jobId);
       console.log(`[Crawler ${process.pid}] Received CONTROL_COMMAND: ${message.command} for job ${message.jobId ?? 'all'}`); // Placeholder
      break;
    case MessageType.LOAD_STATE_RESPONSE:
       // jobManager.handleLoadStateResponse(message.jobId, message.dataType, message.state);
       console.log(`[Crawler ${process.pid}] Received LOAD_STATE_RESPONSE for ${message.jobId}/${message.dataType}`); // Placeholder
      break;
    default:
      console.warn(`[Crawler ${process.pid}] Received unhandled message type:`, (message as any).type);
  }
}

// Setup listener for messages from the backend
setupIpcListener(handleIncomingMessage);

// Inform the backend that the crawler is ready
sendToBackend({ type: MessageType.CRAWLER_READY, pid: process.pid });
console.log(`[Crawler ${process.pid}] Sent CRAWLER_READY`);

// Start heartbeat
heartbeatInterval = setInterval(() => {
  sendToBackend({ type: MessageType.HEARTBEAT, timestamp: Date.now() });
}, HEARTBEAT_INTERVAL_MS);

console.log(`[Crawler ${process.pid}] Heartbeat started (interval: ${HEARTBEAT_INTERVAL_MS}ms)`);

// --- Graceful Shutdown ---

function shutdown(signal: string) {
  console.log(`[Crawler ${process.pid}] Received ${signal}. Shutting down...`);
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  // Add shutdown logic for jobManager here (e.g., pause all jobs, wait for completion)
  // await jobManager.shutdown();

  console.log(`[Crawler ${process.pid}] Shutdown complete. Exiting.`);
  // Ensure IPC channel is closed if possible before exiting
  if (process.disconnect) {
      process.disconnect();
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('exit', (code) => {
    console.log(`[Crawler ${process.pid}] Exiting with code ${code}`);
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval); // Final cleanup attempt
    }
});

console.log(`[Crawler ${process.pid}] Initialized successfully. Waiting for commands.`);
