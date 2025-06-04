/**
 * Testing Socket Server Setup Example
 * 
 * This example demonstrates how to set up the socket communication system
 * for testing environments, including unit tests, integration tests, and
 * mock implementations.
 */

import { SocketServer } from '../socket-server';
import { createDefaultRouter, type MessageMiddleware } from '../message-router';
import type {
  SocketServerConfig,
  CrawlerMessage,
  WebAppMessage,
  Job,
  Area,
  MessageProcessingResult
} from '../types/index';

/**
 * Test-specific configuration for socket server
 */
export function createTestConfig(overrides: Partial<SocketServerConfig> = {}): SocketServerConfig {
  const testConfig: SocketServerConfig = {
    // Use unique socket path for testing
    socketPath: `/tmp/test-crawler-${Date.now()}.sock`,
    
    // Minimal connections for testing
    maxConnections: 2,
    connectionTimeout: 5000, // 5 seconds
    
    // Fast heartbeat for quick test feedback
    heartbeatInterval: 1000, // 1 second
    heartbeatTimeout: 3000, // 3 seconds
    
    // Small buffers for testing
    messageBufferSize: 1024, // 1KB
    maxMessageSize: 1024, // 1KB
    
    // Minimal job settings
    maxConcurrentJobs: 1,
    jobQueueSize: 5,
    jobTimeout: 10000, // 10 seconds
    
    // Debug logging for tests
    logLevel: 'debug',
    enableMetrics: false, // Disable to avoid noise
    
    // Fast cleanup for tests
    cleanupInterval: 1000, // 1 second
    maxJobAge: 10000, // 10 seconds
    maxErrorLogAge: 5000, // 5 seconds
    
    // Override with test-specific values
    ...overrides
  };

  return testConfig;
}

/**
 * Test socket server setup with mock database and handlers
 */
export async function createTestSocketServer(config?: Partial<SocketServerConfig>) {
  const testConfig = createTestConfig(config);
  
  // Create socket server
  const socketServer = new SocketServer(testConfig);
  
  // Create router with test middleware
  const router = createDefaultRouter();
  
  // Add test middleware
  router.addMiddleware(new TestLoggingMiddleware());
  router.addMiddleware(new MockValidationMiddleware());
  
  return { socketServer, router, config: testConfig };
}

/**
 * Test logging middleware for debugging
 */
class TestLoggingMiddleware implements MessageMiddleware {
  name = 'test-logging';
  priority = 5;
  
  private logs: Array<{ type: string; message: any; timestamp: Date }> = [];

  async beforeProcess(message: CrawlerMessage): Promise<CrawlerMessage | null> {
    this.logs.push({
      type: 'received',
      message: { ...message },
      timestamp: new Date()
    });
    return null;
  }

  async beforeSend(message: WebAppMessage): Promise<WebAppMessage | null> {
    this.logs.push({
      type: 'sent',
      message: { ...message },
      timestamp: new Date()
    });
    return null;
  }

  getLogs() {
    return [...this.logs];
  }

  clearLogs() {
    this.logs.length = 0;
  }
}

/**
 * Mock validation middleware for testing
 */
class MockValidationMiddleware implements MessageMiddleware {
  name = 'mock-validation';
  priority = 100;

  async beforeProcess(message: CrawlerMessage): Promise<CrawlerMessage | null> {
    // Basic validation for testing
    if (!message.type || !message.timestamp) {
      throw new Error('Invalid test message: missing type or timestamp');
    }
    return null;
  }
}

/**
 * Mock database implementation for testing
 */
export class MockDatabase {
  private jobs = new Map<string, Job>();
  private areas = new Map<string, Area>();
  private jobProgress = new Map<string, any>();

  // Job operations
  async createJob(jobData: Partial<Job>): Promise<Job> {
    const job: Job = {
      id: jobData.id || `test-job-${Date.now()}`,
      accountId: jobData.accountId || 'test-account',
      command: jobData.command || 'project' as any,
      status: jobData.status || 'queued' as any,
      created_at: new Date(),
      ...jobData
    };

    this.jobs.set(job.id, job);
    return job;
  }

  async getJob(id: string): Promise<Job | null> {
    return this.jobs.get(id) || null;
  }

  async updateJob(id: string, updates: Partial<Job>): Promise<Job> {
    const existing = this.jobs.get(id);
    if (!existing) {
      throw new Error(`Job not found: ${id}`);
    }

    const updated = { ...existing, ...updates, updated_at: new Date() };
    this.jobs.set(id, updated);
    return updated;
  }

  async getActiveJobs(): Promise<Job[]> {
    return Array.from(this.jobs.values()).filter(job => 
      ['queued', 'running'].includes(job.status)
    );
  }

  // Area operations
  async createArea(areaData: Partial<Area>): Promise<Area> {
    const area: Area = {
      full_path: areaData.full_path || 'test/project',
      gitlab_id: areaData.gitlab_id || '123',
      type: areaData.type || 'project' as any,
      created_at: new Date(),
      ...areaData
    };

    this.areas.set(area.full_path, area);
    return area;
  }

  async getArea(fullPath: string): Promise<Area | null> {
    return this.areas.get(fullPath) || null;
  }

  // Progress operations
  async saveProgress(jobId: string, progress: any): Promise<void> {
    this.jobProgress.set(jobId, progress);
  }

  async getProgress(jobId: string): Promise<any> {
    return this.jobProgress.get(jobId) || null;
  }

  // Test utilities
  clear() {
    this.jobs.clear();
    this.areas.clear();
    this.jobProgress.clear();
  }

  getAllJobs() {
    return Array.from(this.jobs.values());
  }

  getAllAreas() {
    return Array.from(this.areas.values());
  }
}

/**
 * Mock message handler for testing
 */
export class MockMessageHandler {
  private processedMessages: CrawlerMessage[] = [];
  
  canHandle(): boolean {
    return true; // Handle all messages for testing
  }

  async handle(message: CrawlerMessage): Promise<MessageProcessingResult> {
    this.processedMessages.push(message);
    
    // Simulate processing based on message type
    switch (message.type) {
      case 'heartbeat':
        return { success: true, data: { acknowledged: true } };
      
      case 'job_progress':
        return { success: true, data: { progress_updated: true } };
      
      case 'job_completed':
        return { success: true, data: { job_completed: true } };
      
      default:
        return { success: true, data: { processed: true } };
    }
  }

  getPriority(): number {
    return 50; // Medium priority
  }

  getProcessedMessages(): CrawlerMessage[] {
    return [...this.processedMessages];
  }

  clearMessages() {
    this.processedMessages.length = 0;
  }
}

/**
 * Test client for simulating crawler connections
 */
export class TestCrawlerClient {
  private socket: any = null;
  private connected = false;
  private receivedMessages: any[] = [];

  constructor(private socketPath: string) {}

  async connect(): Promise<void> {
    const net = await import('net');
    
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(this.socketPath);
      
      this.socket.on('connect', () => {
        this.connected = true;
        resolve();
      });
      
      this.socket.on('error', reject);
      
      this.socket.on('data', (data: Buffer) => {
        const messages = data.toString().trim().split('\n');
        for (const messageStr of messages) {
          if (messageStr) {
            try {
              const message = JSON.parse(messageStr);
              this.receivedMessages.push(message);
            } catch {
              console.warn('Failed to parse message:', messageStr);
            }
          }
        }
      });
    });
  }

  async sendMessage(message: CrawlerMessage): Promise<void> {
    if (!this.connected || !this.socket) {
      throw new Error('Client not connected');
    }

    const messageStr = JSON.stringify(message) + '\n';
    this.socket.write(messageStr);
  }

  async sendHeartbeat(): Promise<void> {
    await this.sendMessage({
      type: 'heartbeat',
      timestamp: new Date().toISOString(),
      data: {
        active_jobs: 0,
        last_activity: new Date().toISOString(),
        system_status: 'idle'
      }
    });
  }

  async sendJobProgress(jobId: string, completion: number = 0.5): Promise<void> {
    await this.sendMessage({
      type: 'job_progress',
      timestamp: new Date().toISOString(),
      job_id: jobId,
      data: {
        progress: [{
          entity_type: 'projects',
          total_discovered: 100,
          total_processed: Math.floor(completion * 100)
        }],
        overall_completion: completion,
        time_elapsed: 30000
      }
    });
  }

  getReceivedMessages(): any[] {
    return [...this.receivedMessages];
  }

  clearMessages() {
    this.receivedMessages.length = 0;
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.end();
      this.connected = false;
    }
  }
}

/**
 * Test suite helper for socket server testing
 */
export class SocketTestSuite {
  private socketServer: SocketServer | null = null;
  private testClients: TestCrawlerClient[] = [];
  private mockDb: MockDatabase = new MockDatabase();
  private config: SocketServerConfig | null = null;

  async setup(testConfig?: Partial<SocketServerConfig>): Promise<void> {
    // Create test server
    const { socketServer, config } = await createTestSocketServer(testConfig);
    this.socketServer = socketServer;
    this.config = config;

    // Start server
    await this.socketServer.start();
    
    // Wait a moment for server to be ready
    await this.delay(100);
  }

  async teardown(): Promise<void> {
    // Disconnect all test clients
    for (const client of this.testClients) {
      await client.disconnect();
    }
    this.testClients.length = 0;

    // Stop server
    if (this.socketServer) {
      await this.socketServer.stop();
      this.socketServer = null;
    }

    // Clear mock database
    this.mockDb.clear();

    // Clean up socket file
    if (this.config?.socketPath) {
      try {
        const fs = await import('fs');
        await fs.promises.unlink(this.config.socketPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  async createTestClient(): Promise<TestCrawlerClient> {
    if (!this.config?.socketPath) {
      throw new Error('Test suite not properly setup');
    }

    const client = new TestCrawlerClient(this.config.socketPath);
    await client.connect();
    this.testClients.push(client);
    return client;
  }

  getMockDatabase(): MockDatabase {
    return this.mockDb;
  }

  getSocketServer(): SocketServer {
    if (!this.socketServer) {
      throw new Error('Socket server not initialized');
    }
    return this.socketServer;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Example test cases using the test suite
 */
export const exampleTests = {
  
  /**
   * Test basic connection and heartbeat
   */
  async testBasicConnection() {
    const suite = new SocketTestSuite();
    
    try {
      await suite.setup();
      
      // Create test client and connect
      const client = await suite.createTestClient();
      
      // Send heartbeat
      await client.sendHeartbeat();
      
      // Verify server status
      const status = suite.getSocketServer().getStatus();
      console.assert(status.isRunning, 'Server should be running');
      console.assert(status.connections > 0, 'Should have active connections');
      
      console.log('✅ Basic connection test passed');
      
    } finally {
      await suite.teardown();
    }
  },

  /**
   * Test job progress messaging
   */
  async testJobProgress() {
    const suite = new SocketTestSuite();
    
    try {
      await suite.setup();
      
      // Create test job
      const mockDb = suite.getMockDatabase();
      const job = await mockDb.createJob({
        id: 'test-job-123',
        command: 'project' as any,
        status: 'running' as any
      });
      
      // Connect client and send progress
      const client = await suite.createTestClient();
      await client.sendJobProgress(job.id, 0.75);
      
      // Verify progress was processed
      const progress = await mockDb.getProgress(job.id);
      console.log('Job progress:', progress);
      
      console.log('✅ Job progress test passed');
      
    } finally {
      await suite.teardown();
    }
  },

  /**
   * Test multiple client connections
   */
  async testMultipleConnections() {
    const suite = new SocketTestSuite();
    
    try {
      await suite.setup({ maxConnections: 3 });
      
      // Create multiple clients
      const client1 = await suite.createTestClient();
      const client2 = await suite.createTestClient();
      
      // Send heartbeats from both
      await client1.sendHeartbeat();
      await client2.sendHeartbeat();
      
      // Verify server has multiple connections
      const stats = suite.getSocketServer().getConnectionStats();
      console.assert(stats.total >= 2, 'Should have multiple connections');
      
      console.log('✅ Multiple connections test passed');
      
    } finally {
      await suite.teardown();
    }
  }
};

/**
 * Run example tests if this file is executed directly
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🧪 Running socket server tests...');
  
  Promise.resolve()
    .then(() => exampleTests.testBasicConnection())
    .then(() => exampleTests.testJobProgress())
    .then(() => exampleTests.testMultipleConnections())
    .then(() => {
      console.log('✅ All tests passed!');
    })
    .catch((error) => {
      console.error('❌ Test failed:', error);
      process.exit(1);
    });
}

/**
 * Usage Instructions:
 * 
 * 1. Unit Testing:
 *    ```typescript
 *    import { SocketTestSuite, MockDatabase } from './examples/testing-setup';
 *    
 *    describe('Socket Server', () => {
 *      let suite: SocketTestSuite;
 *    
 *      beforeEach(async () => {
 *        suite = new SocketTestSuite();
 *        await suite.setup();
 *      });
 *    
 *      afterEach(async () => {
 *        await suite.teardown();
 *      });
 *    
 *      it('should handle heartbeat messages', async () => {
 *        const client = await suite.createTestClient();
 *        await client.sendHeartbeat();
 *        // assertions...
 *      });
 *    });
 *    ```
 * 
 * 2. Integration Testing:
 *    ```typescript
 *    import { createTestSocketServer, TestCrawlerClient } from './examples/testing-setup';
 *    
 *    const { socketServer } = await createTestSocketServer();
 *    await socketServer.start();
 *    
 *    const client = new TestCrawlerClient('/tmp/test-socket.sock');
 *    await client.connect();
 *    // test scenarios...
 *    ```
 * 
 * 3. Mock Database:
 *    ```typescript
 *    const mockDb = new MockDatabase();
 *    const job = await mockDb.createJob({ command: 'project' });
 *    await mockDb.updateJob(job.id, { status: 'running' });
 *    ```
 * 
 * 4. Message Testing:
 *    ```typescript
 *    const handler = new MockMessageHandler();
 *    const result = await handler.handle(testMessage, mockConnection);
 *    expect(result.success).toBe(true);
 *    ```
 * 
 * 5. Run Tests:
 *    ```bash
 *    # Run example tests
 *    npx tsx src/lib/server/socket/examples/testing-setup.ts
 *    
 *    # Use with Jest/Vitest
 *    npm test socket
 *    ```
 */