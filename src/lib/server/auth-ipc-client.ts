/**
 * Authentication IPC Client
 * 
 * This module provides a client for sending GitLab authentication credentials
 * to the supervisor process via IPC, which will then pass them to the crawler.
 */

import { getLogger } from '@logtape/logtape';
import { existsSync } from 'fs';
import { createConnection } from 'net';

// Initialize logger
const logger = getLogger(['auth-ipc-client']);

/**
 * Send GitLab authentication credentials to the supervisor process.
 * 
 * @param credentials - The GitLab authentication credentials
 * @returns {Promise<boolean>} - True if the credentials were sent successfully
 */
export async function sendAuthCredentials(credentials: {
  token: string;
  clientId: string;
  clientSecret: string;
}) {
  const socketPath = process.env.AUTH_IPC_SOCKET_PATH;
  
  if (!socketPath) {
    logger.error('No AUTH_IPC_SOCKET_PATH environment variable set');
    return false;
  }
  
  if (!existsSync(socketPath)) {
    logger.error(`Socket file does not exist: ${socketPath}`);
    return false;
  }
  
  return new Promise((resolve, reject) => {
    try {
      const client = createConnection(socketPath);
      let responseData = '';
      
      // Set timeout
      const timeout = setTimeout(() => {
        client.end();
        reject(new Error('Timeout while sending auth credentials'));
      }, 5000);
      
      client.on('connect', () => {
        logger.info('Connected to auth IPC socket');
        
        // Send credentials
        const message = {
          type: 'auth',
          credentials: {
            token: credentials.token,
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret
          }
        };
        
        client.write(JSON.stringify(message));
      });
      
      client.on('data', (data) => {
        responseData += data.toString();
        
        try {
          const response = JSON.parse(responseData) as { type: string; success: boolean };
          
          if (response.type === 'auth_ack') {
            clearTimeout(timeout);
            client.end();
            logger.info('Auth credentials sent successfully');
            resolve(response.success);
          }
        } catch (e) {
          // Not a complete JSON response yet
          if (!(e instanceof SyntaxError)) {
            logger.error(`Error processing response: ${e}`);
          }
        }
      });
      
      client.on('error', (err) => {
        clearTimeout(timeout);
        logger.error(`Socket error: ${err}`);
        reject(err);
      });
      
      client.on('close', () => {
        clearTimeout(timeout);
        // If we haven't resolved or rejected yet, assume failure
        reject(new Error('Connection closed without acknowledgment'));
      });
      
    } catch (err) {
      logger.error(`Failed to connect to auth IPC socket: ${err}`);
      reject(err);
    }
  });
}