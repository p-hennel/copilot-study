// src/crawler/crawler.ts
import { setupIPC } from './ipc';
import { JobManager } from './jobManager';
import { Storage } from './storage';
import type { CrawlerCommand, CrawlerStatus } from './types'; // Import CrawlerStatus

export async function startCrawler() {
  console.log('Initializing crawler components...');

  const storage = new Storage('./crawled_data'); // Define base path for crawled data
  const jobManager = new JobManager(storage);

  // Setup IPC communication
  const ipc = setupIPC({
    onCommand: (command: CrawlerCommand) => {
      console.log('Received command via IPC:', command);
      // Handle commands like start, pause, resume, new job, etc.
      jobManager.handleCommand(command);
    },
    // Provide placeholder functions initially for status/heartbeat sending
    // These will be replaced by the actual IPC senders inside setupIPC
    sendStatus: (status: CrawlerStatus) => { // Explicitly type status
      console.log('Placeholder sendStatus called:', status);
    },
    sendHeartbeat: () => {
      console.log('Placeholder sendHeartbeat called');
    }
  });

  // Inject the actual IPC send functions into the JobManager instance
  jobManager.setIPCFunctions(ipc.sendStatus, ipc.sendHeartbeat);

  console.log('Crawler components initialized and IPC connected.');

  // Start the job manager's processing loop (optional - could be triggered by IPC)
  // jobManager.startProcessing(); // Uncomment if you want it to start automatically

  // Keep the crawler process running (e.g., waiting for IPC commands)
  console.log('Crawler is running and waiting for commands...');

  // Initial status/heartbeat is now sent by JobManager after IPC setup

  // Keep the process alive indefinitely or until a shutdown command
  // In a real scenario, this might involve a loop or waiting mechanism
  await new Promise(() => {}); // Keep process alive
}