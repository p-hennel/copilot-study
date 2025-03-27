import type { JobStatus } from "$lib/utils";
import type { JobProgressMessage, RequestJobMessage } from "./Shared";

/**
 * MessageBus acts as a message bus for IPC communication between the runner and a web app.
 * It sends messages via process.send and listens for incoming messages.
 */
export class MessageBusClient {
  constructor() {
    // Listen for any incoming IPC messages (for logging or additional processing)
    process.on('message', (msg: any) => {
      // You can expand this to support subscriptions for particular events
      if (msg && typeof msg === 'object') {
        // For now, log unexpected messages
        if (!msg.type || (msg.type !== 'job' && msg.type !== 'jobResponse')) {
          console.debug('[MessageBus] Received message:', msg);
        }
      }
    });
  }

  /**
   * requestJob sends a job request via IPC and waits for a job message.
   * @param timeoutMs Timeout in milliseconds to wait for a response.
   * @returns A promise that resolves with the job data.
   */
  public requestJob(timeoutMs = 10000): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!process.send) {
        return reject(new Error('IPC not available: process.send is undefined'));
      }
      const messageHandler = (msg: any) => {
        if (msg && msg.type === 'job' && msg.data) {
          process.removeListener('message', messageHandler);
          clearTimeout(timer);
          resolve(msg.data);
        }
      };
      process.on('message', messageHandler);

      // Send a job request message
      process.send({ type: 'requestJob' } as RequestJobMessage);

      // Set up a timeout in case no job is received
      const timer = setTimeout(() => {
        process.removeListener('message', messageHandler);
        reject(new Error('Timeout waiting for job response'));
      }, timeoutMs);
    });
  }

  /**
   * reportProgress sends a progress update for a job via IPC.
   * @param jobId The identifier of the job.
   * @param status The status of the job ('completed' or 'failed').
   * @param details Optional additional details.
   */
  public reportProgress(jobId: string, status: JobStatus, details?: any): void {
    if (!process.send) {
      console.error('IPC not available: process.send is undefined');
      return;
    }
    const message: JobProgressMessage = {
      type: 'jobProgress',
      data: { jobId, status, details }
    };
    process.send(message);
  }
}

// Export a singleton instance for easy reuse.
export default new MessageBusClient();

