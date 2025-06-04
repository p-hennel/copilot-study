/**
 * Basic Socket Server Setup Example
 * 
 * This example demonstrates the minimal setup required to get the socket
 * communication system running in a development environment.
 */

import { SocketServer } from '../socket-server.js';
import { createDefaultRouter } from '../message-router.js';
import { SOCKET_CONFIG } from '../config.js';

/**
 * Basic development setup with minimal configuration
 */
export async function basicSocketSetup() {
  console.log('🚀 Starting basic socket server setup...');

  try {
    // 1. Create socket server with development defaults
    const socketServer = new SocketServer({
      socketPath: '/tmp/crawler-dev.sock',
      maxConnections: 3,
      logLevel: 'debug',
      heartbeatInterval: 10000, // 10 seconds for faster feedback
      enableMetrics: true,
    });

    // 2. Set up basic message routing
    const router = createDefaultRouter();
    
    // Log all incoming messages for debugging
    router.addMiddleware({
      name: 'debug-logger',
      priority: 5,
      async beforeProcess(message, connection) {
        console.log(`📨 Received ${message.type} from ${connection.id}`);
        console.log('Message data:', JSON.stringify(message.data, null, 2));
        return null; // Don't modify the message
      }
    });

    // 3. Start the server
    await socketServer.start();
    console.log('✅ Socket server started successfully');
    console.log(`🔌 Listening on: ${SOCKET_CONFIG.socketPath}`);
    console.log(`📊 Max connections: ${SOCKET_CONFIG.maxConnections}`);

    // 4. Monitor server status
    setInterval(() => {
      const status = socketServer.getStatus();
      const stats = socketServer.getConnectionStats();
      
      console.log(`📈 Server Status:`, {
        running: status.isRunning,
        uptime: Math.round(status.uptime / 1000) + 's',
        connections: `${stats.active}/${stats.total}`,
      });
    }, 30000); // Every 30 seconds

    // 5. Handle graceful shutdown
    const shutdown = async () => {
      console.log('\n🛑 Shutting down socket server...');
      try {
        await socketServer.stop();
        console.log('✅ Socket server stopped gracefully');
        process.exit(0);
      } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    return socketServer;

  } catch (error) {
    console.error('❌ Failed to start socket server:', error);
    throw error;
  }
}

/**
 * Simple message handler for testing
 */
export class BasicTestHandler {
  static create() {
    return {
      canHandle: (message: any) => message.type === 'heartbeat',
      handle: async (message: any, connection: any) => {
        console.log(`💓 Heartbeat from ${connection.id}:`, message.data);
        return { success: true };
      },
      getPriority: () => 50,
    };
  }
}

/**
 * Basic connection event logging
 */
export function setupBasicConnectionLogging() {
  // Note: This would need to be implemented once connection events are available
  console.log('📝 Basic connection logging enabled');
  
  // Example of what connection logging might look like:
  /*
  socketServer.on('connection', (connection) => {
    console.log(`🔗 New connection: ${connection.id}`);
    
    connection.on('disconnect', (reason) => {
      console.log(`🔌 Connection ${connection.id} disconnected: ${reason}`);
    });
    
    connection.on('error', (error) => {
      console.error(`❌ Connection ${connection.id} error:`, error.message);
    });
  });
  */
}

/**
 * Test the socket server with a simple message
 */
export async function testSocketConnection(socketPath: string = '/tmp/crawler-dev.sock') {
  const net = await import('net');
  
  return new Promise<void>((resolve, reject) => {
    const client = net.createConnection(socketPath);
    
    client.on('connect', () => {
      console.log('🧪 Test client connected');
      
      // Send a test heartbeat message
      const testMessage = {
        type: 'heartbeat',
        timestamp: new Date().toISOString(),
        data: {
          active_jobs: 0,
          last_activity: new Date().toISOString(),
          system_status: 'idle' as const,
        }
      };
      
      client.write(JSON.stringify(testMessage) + '\n');
      
      // Close connection after a short delay
      setTimeout(() => {
        client.end();
        resolve();
      }, 1000);
    });
    
    client.on('error', (error) => {
      console.error('🧪 Test client error:', error.message);
      reject(error);
    });
    
    client.on('data', (data) => {
      console.log('🧪 Test client received:', data.toString());
    });
  });
}

/**
 * Run the basic setup if this file is executed directly
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  basicSocketSetup()
    .then(async () => {
      console.log('🎯 Basic setup complete. Testing connection...');
      
      // Wait a moment for server to be ready
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Test the connection
      try {
        await testSocketConnection();
        console.log('✅ Connection test passed');
      } catch (error) {
        console.error('❌ Connection test failed:', error);
      }
    })
    .catch((error) => {
      console.error('💥 Setup failed:', error);
      process.exit(1);
    });
}

/**
 * Usage Instructions:
 * 
 * 1. Development Mode:
 *    ```bash
 *    npx tsx src/lib/server/socket/examples/basic-setup.ts
 *    ```
 * 
 * 2. Import in your application:
 *    ```typescript
 *    import { basicSocketSetup } from './examples/basic-setup';
 *    const server = await basicSocketSetup();
 *    ```
 * 
 * 3. Environment Variables (optional):
 *    ```bash
 *    SOCKET_PATH=/tmp/my-socket.sock
 *    SOCKET_LOG_LEVEL=debug
 *    SOCKET_MAX_CONNECTIONS=5
 *    ```
 * 
 * 4. Testing:
 *    - The server will log all messages for debugging
 *    - Includes basic error handling and graceful shutdown
 *    - Status monitoring every 30 seconds
 * 
 * 5. Next Steps:
 *    - See production-setup.ts for production-ready configuration
 *    - See testing-setup.ts for unit testing examples
 *    - Check DEPLOYMENT_GUIDE.md for full deployment instructions
 */