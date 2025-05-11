import { existsSync, statSync } from 'node:fs';
import { Socket } from 'node:net';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Configuration - you can adjust these or load from environment variables
const SOCKET_PATH = process.env.SOCKET_PATH || '/run/app/app.sock';

/**
 * Check if the socket file exists and is actually a socket
 */
function checkSocketExists(): boolean {
  try {
    // Check if file exists
    if (!existsSync(SOCKET_PATH)) {
      console.error(`Socket file ${SOCKET_PATH} does not exist`);
      return false;
    }
    
    // Check if it's a socket
    const stats = statSync(SOCKET_PATH);
    if (!stats.isSocket()) {
      console.error(`File ${SOCKET_PATH} exists but is not a socket`);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error(`Error checking socket: ${error}`);
    return false;
  }
}

/**
 * Test if the socket is actively listening
 */
async function testSocketConnection(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const socket = new Socket();
      
      // Set timeout to prevent hanging
      socket.setTimeout(500);
      
      socket.on('connect', () => {
        socket.end();
        resolve(true);
      });
      
      socket.on('timeout', () => {
        socket.destroy();
        console.error('Socket connection timed out');
        resolve(false);
      });
      
      socket.on('error', (err) => {
        console.error(`Socket connection error: ${err.message}`);
        resolve(false);
      });
      
      // Try to connect to the socket
      socket.connect(SOCKET_PATH);
    } catch (error) {
      console.error(`Error testing socket connection: ${error}`);
      resolve(false);
    }
  });
}

/**
 * Main healthcheck function that combines all checks
 */
async function performHealthCheck(): Promise<{ healthy: boolean; message: string }> {
  // Check if socket file exists
  if (!checkSocketExists()) {
    return { healthy: false, message: 'Socket file missing or not a socket' };
  }
  
  // Check if socket is responsive
  const isSocketConnectable = await testSocketConnection();
  if (!isSocketConnectable) {
    return { healthy: false, message: 'Socket exists but is not responsive' };
  }
  
  // All checks passed
  return { healthy: true, message: 'Service is healthy' };
}

// GET handler for /api/health endpoint
export const GET: RequestHandler = async () => {
  const healthStatus = await performHealthCheck();
  
  return json(healthStatus, {
    status: healthStatus.healthy ? 200 : 503
  });
};