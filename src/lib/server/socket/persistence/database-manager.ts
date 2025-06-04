import { drizzle } from 'drizzle-orm/better-sqlite3';
import { job, area } from '$lib/server/db/base-schema';
import { Database } from 'bun:sqlite'
import { eq, and, lte } from 'drizzle-orm';
import type {
  SocketDatabaseOperations,
  ConnectionStateOperations,
  JobQueueOperations
} from '../types/database.js';
import { JobStatus } from '$lib/types';

/**
 * Central database connection and transaction management for socket operations
 * 
 * Provides:
 * - Database connection and health management
 * - Transaction handling with proper rollback
 * - Repository pattern implementation
 * - Connection pooling and retry logic
 */
export class DatabaseManager {
  private db: ReturnType<typeof drizzle> | null = null;
  private sqlite: Database | null = null;
  private isConnected = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private readonly reconnectDelay = 1000; // 1 second

  constructor(private databaseUrl?: string) {
    this.databaseUrl = databaseUrl || process.env.DATABASE_URL || 'file:/home/bun/data/config/main.db';
  }

  /**
   * Initialize database connection
   */
  async connect(): Promise<void> {
    try {
      // Extract file path from database URL
      const dbPath = this.databaseUrl!.replace('file:', '');
      
      this.sqlite = new Database(dbPath);
      this.sqlite.exec('PRAGMA journal_mode = WAL;');
      this.sqlite.exec('PRAGMA synchronous = NORMAL;');
      this.sqlite.exec('PRAGMA cache_size = -64000;'); // 64MB cache
      this.sqlite.exec('PRAGMA temp_store = MEMORY;');
      
      this.db = drizzle(this.sqlite);
      this.isConnected = true;
      this.reconnectAttempts = 0;
      
      console.log(`Database connected: ${dbPath}`);
    } catch (error) {
      console.error('Failed to connect to database:', error);
      throw error;
    }
  }

  /**
   * Close database connection
   */
  async disconnect(): Promise<void> {
    try {
      if (this.sqlite) {
        this.sqlite.close();
        this.sqlite = null;
      }
      this.db = null;
      this.isConnected = false;
      console.log('Database disconnected');
    } catch (error) {
      console.error('Error disconnecting from database:', error);
      throw error;
    }
  }

  /**
   * Get database instance
   */
  getDatabase(): ReturnType<typeof drizzle> {
    if (!this.db || !this.isConnected) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.db;
  }

  /**
   * Check database health
   */
  async healthCheck(): Promise<boolean> {
    try {
      if (!this.db) return false;
      
      // Simple query to check connection
      await this.db.select().from(job).limit(1);
      return true;
    } catch (error) {
      console.error('Database health check failed:', error);
      return false;
    }
  }

  /**
   * Attempt to reconnect to database
   */
  async reconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      throw new Error(`Max reconnection attempts (${this.maxReconnectAttempts}) exceeded`);
    }

    this.reconnectAttempts++;
    console.log(`Attempting database reconnection (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    // Close existing connection
    await this.disconnect();

    // Wait before reconnecting
    await new Promise(resolve => setTimeout(resolve, this.reconnectDelay * this.reconnectAttempts));

    // Attempt to reconnect
    await this.connect();
  }

  /**
   * Execute operation with automatic retry on connection failure
   */
  async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      // Check if it's a connection error
      if (this.isConnectionError(error)) {
        console.warn('Database connection error detected, attempting reconnection...');
        await this.reconnect();
        return await operation();
      }
      throw error;
    }
  }

  /**
   * Execute operation within a transaction
   */
  async withTransaction<T>(operation: (db: ReturnType<typeof drizzle>) => Promise<T>): Promise<T> {
    const db = this.getDatabase();
    
    return await this.withRetry(async () => {
      return await db.transaction(async (tx) => {
        try {
          const result = await operation(tx as any);
          return result;
        } catch (error) {
          // Transaction will automatically rollback on error
          console.error('Transaction failed, rolling back:', error);
          throw error;
        }
      });
    });
  }

  /**
   * Create database operations adapter
   */
  createDatabaseOperations(): SocketDatabaseOperations {
    return new SocketDatabaseOperationsImpl(this);
  }

  /**
   * Create connection state operations
   */
  createConnectionStateOperations(): ConnectionStateOperations {
    return new ConnectionStateOperationsImpl(this);
  }

  /**
   * Create job queue operations
   */
  createJobQueueOperations(): JobQueueOperations {
    return new JobQueueOperationsImpl(this);
  }

  /**
   * Get database statistics
   */
  async getStatistics(): Promise<DatabaseStatistics> {
    return await this.withRetry(async () => {
      const db = this.getDatabase();
      
      // Count jobs by status
      const jobCounts = await db.select().from(job);
      const jobStats = jobCounts.reduce((acc, j) => {
        acc.total++;
        switch (j.status) {
          case 'queued': acc.queued++; break;
          case 'running': acc.running++; break;
          case 'finished': acc.completed++; break;
          case 'failed': acc.failed++; break;
        }
        return acc;
      }, { total: 0, queued: 0, running: 0, completed: 0, failed: 0 });

      const areaCounts = await db.select().from(area);

      return {
        jobs: jobStats,
        areas: {
          total: areaCounts.length
        },
        connection: {
          isHealthy: await this.healthCheck(),
          reconnectAttempts: this.reconnectAttempts
        }
      };
    });
  }

  /**
   * Cleanup old records
   */
  async cleanup(olderThan: Date): Promise<CleanupResult> {
    //const db = this.getDatabase();
    
    return await this.withTransaction(async (tx) => {
      // Delete completed jobs older than specified date
      const deletedJobs = await tx
        .delete(job)
        .where(
          and(
            eq(job.status, JobStatus.finished),
            lte(job.finished_at, olderThan)
          )
        );

      return {
        deletedJobs: deletedJobs.changes || 0,
        deletedErrors: 0, // Will be implemented with error logging
        deletedConnections: 0 // Will be implemented with connection tracking
      };
    });
  }

  private isConnectionError(error: any): boolean {
    if (!error) return false;
    
    const errorMessage = error.message?.toLowerCase() || '';
    return (
      errorMessage.includes('database is locked') ||
      errorMessage.includes('database disk image is malformed') ||
      errorMessage.includes('no such table') ||
      errorMessage.includes('connection') ||
      error.code === 'SQLITE_BUSY' ||
      error.code === 'SQLITE_LOCKED'
    );
  }
}

/**
 * Implementation of socket database operations
 */
class SocketDatabaseOperationsImpl implements SocketDatabaseOperations {
  constructor(private dbManager: DatabaseManager) {}

  async createJobFromAssignment(assignment: any): Promise<any> {
    // Implementation will be in job-repository.ts
    throw new Error('Method not implemented. Use JobRepository instead.');
  }

  async updateJobFromProgress(jobId: string, progress: any): Promise<any> {
    // Implementation will be in job-repository.ts
    throw new Error('Method not implemented. Use JobRepository instead.');
  }

  async updateJobStatus(jobId: string, status: any): Promise<any> {
    // Implementation will be in job-repository.ts
    throw new Error('Method not implemented. Use JobRepository instead.');
  }

  async saveProgressUpdate(jobId: string, progress: any): Promise<void> {
    // Implementation will be in progress-repository.ts
    throw new Error('Method not implemented. Use ProgressRepository instead.');
  }

  async getJobProgress(jobId: string): Promise<any> {
    // Implementation will be in progress-repository.ts
    throw new Error('Method not implemented. Use ProgressRepository instead.');
  }

  async logJobError(jobId: string, error: any): Promise<void> {
    // Implementation will be in error logging system
    throw new Error('Method not implemented.');
  }

  async getJobErrors(jobId: string): Promise<any[]> {
    // Implementation will be in error logging system
    throw new Error('Method not implemented.');
  }

  async createAssignmentMapping(mapping: any): Promise<any> {
    // Implementation will be in job-repository.ts
    throw new Error('Method not implemented.');
  }

  async getAssignmentMapping(webAppJobId: string): Promise<any> {
    // Implementation will be in job-repository.ts
    throw new Error('Method not implemented.');
  }

  async updateAssignmentStatus(webAppJobId: string, status: any): Promise<void> {
    // Implementation will be in job-repository.ts
    throw new Error('Method not implemented.');
  }

  async cleanupCompletedJobs(olderThan: Date): Promise<number> {
    const result = await this.dbManager.cleanup(olderThan);
    return result.deletedJobs;
  }

  async cleanupFailedJobs(olderThan: Date, maxRetries: number): Promise<number> {
    // Implementation for failed job cleanup
    return 0;
  }
}

/**
 * Implementation of connection state operations
 */
class ConnectionStateOperationsImpl implements ConnectionStateOperations {
  constructor(private dbManager: DatabaseManager) {}

  async registerConnection(connection: any): Promise<any> {
    // Implementation for connection state tracking
    throw new Error('Method not implemented.');
  }

  async updateHeartbeat(connectionId: string, status?: any): Promise<void> {
    // Implementation for heartbeat tracking
    throw new Error('Method not implemented.');
  }

  async updateActiveJobs(connectionId: string, jobIds: string[]): Promise<void> {
    // Implementation for active job tracking
    throw new Error('Method not implemented.');
  }

  async markDisconnected(connectionId: string): Promise<void> {
    // Implementation for disconnection tracking
    throw new Error('Method not implemented.');
  }

  async getActiveConnections(): Promise<any[]> {
    // Implementation for active connection retrieval
    throw new Error('Method not implemented.');
  }

  async getConnection(id: string): Promise<any> {
    // Implementation for connection retrieval
    throw new Error('Method not implemented.');
  }

  async cleanupStaleConnections(timeout: number): Promise<number> {
    // Implementation for stale connection cleanup
    throw new Error('Method not implemented.');
  }
}

/**
 * Implementation of job queue operations
 */
class JobQueueOperationsImpl implements JobQueueOperations {
  constructor(private dbManager: DatabaseManager) {}

  async enqueue(jobData: any): Promise<any> {
    // Implementation for job queue management
    throw new Error('Method not implemented.');
  }

  async dequeue(limit?: number): Promise<any[]> {
    // Implementation for job dequeue
    throw new Error('Method not implemented.');
  }

  async markProcessing(id: string): Promise<void> {
    // Implementation for processing status
    throw new Error('Method not implemented.');
  }

  async markCompleted(id: string): Promise<void> {
    // Implementation for completion status
    throw new Error('Method not implemented.');
  }

  async markFailed(id: string, error: string): Promise<void> {
    // Implementation for failure status
    throw new Error('Method not implemented.');
  }

  async getQueueStatus(): Promise<any> {
    // Implementation for queue status
    throw new Error('Method not implemented.');
  }

  async retryFailed(maxAge: Date): Promise<number> {
    // Implementation for retry logic
    throw new Error('Method not implemented.');
  }

  async cleanup(olderThan: Date): Promise<number> {
    // Implementation for queue cleanup
    throw new Error('Method not implemented.');
  }
}

// Type definitions
interface DatabaseStatistics {
  jobs: {
    total: number;
    queued: number;
    running: number;
    completed: number;
    failed: number;
  };
  areas: {
    total: number;
  };
  connection: {
    isHealthy: boolean;
    reconnectAttempts: number;
  };
}

interface CleanupResult {
  deletedJobs: number;
  deletedErrors: number;
  deletedConnections: number;
}

// Export singleton instance
export const databaseManager = new DatabaseManager();