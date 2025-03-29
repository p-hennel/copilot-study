// src/crawler/ipc.ts
import type { CrawlerCommand, CrawlerStatus } from './types';
// Removed: import { Message, send, listen } from 'bun:ipc';

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
  console.log('Setting up IPC listener using process.on("message")...');

  // Listen for messages from the main process (website backend) using process.on
  process.on('message', (message: any) => { // Use 'any' or define a stricter type if possible
    // Basic validation: Check if it's an object and has a 'type' property
    if (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      typeof message.type === 'string'
    ) {
      console.log(`Received IPC command: ${message.type}`);
      // Assume the message structure matches CrawlerCommand.
      // More robust validation/parsing might be needed in a production scenario.
      try {
        // Ensure the message conforms to CrawlerCommand before casting
        // This is a basic check; consider using a validation library (like Zod) for robustness
        if (['START_JOB', 'PAUSE_CRAWLER', 'RESUME_CRAWLER', 'GET_STATUS', 'SHUTDOWN'].includes(message.type)) {
             handlers.onCommand(message as CrawlerCommand);
        } else {
             console.warn('Received command with unknown type:', message.type);
        }
      } catch (error) {
        console.error('Error handling IPC command:', error, 'Message:', message);
      }
    } else {
      console.warn('Received unexpected IPC message format:', message);
    }
  });

  // Function to send status updates to the main process
  const sendStatusToMain = (status: CrawlerStatus) => {
    try {
      // Use process.send if available (standard Node.js/Bun IPC)
      process.send?.({ type: 'statusUpdate', payload: status });
    } catch (error) {
      console.error('Failed to send status update via IPC:', error);
      // Handle potential errors (e.g., if the parent process is gone)
    }
  };

  // Function to send heartbeats to the main process
  const sendHeartbeatToMain = () => {
    try {
      process.send?.({ type: 'heartbeat', timestamp: Date.now() });
    } catch (error) {
      console.error('Failed to send heartbeat via IPC:', error);
    }
  };

  // Overwrite the placeholder functions in handlers with the actual IPC senders
  handlers.sendStatus = sendStatusToMain;
  handlers.sendHeartbeat = sendHeartbeatToMain;

  console.log('IPC listener setup complete.');

  // Return an object containing the functions the crawler can use to send messages
  return {
    sendStatus: sendStatusToMain,
    sendHeartbeat: sendHeartbeatToMain,
  };
}
