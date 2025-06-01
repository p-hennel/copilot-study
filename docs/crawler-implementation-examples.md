# Crawler Implementation Examples

This document provides practical code templates and implementation patterns for integrating the enhanced progress tracking system into various crawler frameworks and architectures.

## Table of Contents

1. [Code Templates](#code-templates)
2. [Integration Patterns](#integration-patterns)
3. [Common Scenarios](#common-scenarios)
4. [Framework-Specific Examples](#framework-specific-examples)
5. [Performance Optimization](#performance-optimization)
6. [Error Handling Patterns](#error-handling-patterns)

## Code Templates

### TypeScript/JavaScript Enhanced Progress Tracker

```typescript
import axios, { AxiosResponse } from 'axios';

interface EnhancedProgressConfig {
  apiEndpoint: string;
  apiToken: string;
  taskId: string;
  batchSize?: number;
  timelineEnabled?: boolean;
  retryAttempts?: number;
  retryDelay?: number;
}

interface ProgressUpdateOptions {
  processedItems?: number;
  totalItems?: number;
  currentDataType?: string;
  itemsByType?: Record<string, number>;
  lastProcessedId?: string;
  stage?: string;
  operationType?: 'discovery' | 'branch_crawling' | 'data_collection' | 'finalization';
  message?: string;
  error?: string;
  timeline?: boolean;
}

class EnhancedProgressTracker {
  private config: EnhancedProgressConfig;
  private localCounts: Record<string, number> = {};
  private lastUpdate: Date = new Date();
  private updateQueue: ProgressUpdateOptions[] = [];

  constructor(config: EnhancedProgressConfig) {
    this.config = {
      batchSize: 10,
      timelineEnabled: true,
      retryAttempts: 3,
      retryDelay: 1000,
      ...config
    };
  }

  /**
   * Send enhanced progress update with retry logic
   */
  async updateProgress(options: ProgressUpdateOptions): Promise<void> {
    try {
      // Accumulate local counts for itemsByType
      if (options.itemsByType) {
        Object.entries(options.itemsByType).forEach(([type, count]) => {
          this.localCounts[type] = (this.localCounts[type] || 0) + count;
        });
      }

      const payload = this.buildProgressPayload(options);
      
      await this.sendWithRetry(payload);
      
      // Create timeline event if enabled
      if (this.config.timelineEnabled && options.timeline !== false) {
        await this.createTimelineEvent('progress_update', {
          processedItems: options.processedItems,
          currentDataType: options.currentDataType,
          stage: options.stage,
          itemsByType: options.itemsByType
        });
      }
      
      this.lastUpdate = new Date();
      
    } catch (error) {
      console.error('Failed to send progress update:', error);
      throw error;
    }
  }

  /**
   * Send stage change update with timeline event
   */
  async changeStage(
    newStage: string, 
    operationType: ProgressUpdateOptions['operationType'],
    additionalData?: Partial<ProgressUpdateOptions>
  ): Promise<void> {
    const currentStage = this.getCurrentStage();
    
    await this.updateProgress({
      stage: newStage,
      operationType,
      message: `Transitioning to ${newStage}`,
      ...additionalData
    });

    if (this.config.timelineEnabled) {
      await this.createTimelineEvent('stage_change', {
        fromStage: currentStage,
        toStage: newStage,
        operationType,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Handle errors with enhanced context
   */
  async reportError(
    error: Error, 
    context: {
      stage?: string;
      lastProcessedId?: string;
      operationType?: string;
      additionalContext?: any;
    }
  ): Promise<void> {
    const errorPayload = {
      error: error.message,
      stage: context.stage,
      lastProcessedId: context.lastProcessedId,
      operationType: context.operationType,
      message: `Error: ${error.message}`
    };

    await this.updateProgress(errorPayload);

    if (this.config.timelineEnabled) {
      await this.createTimelineEvent('error', {
        errorType: error.name,
        errorMessage: error.message,
        stack: error.stack,
        context: context.additionalContext,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Mark operation as completed
   */
  async markCompleted(finalSummary?: {
    totalProcessed?: number;
    finalCounts?: Record<string, number>;
    duration?: number;
    summary?: string;
  }): Promise<void> {
    await this.updateProgress({
      processedItems: finalSummary?.totalProcessed,
      stage: 'completed',
      message: finalSummary?.summary || 'Operation completed successfully'
    });

    if (this.config.timelineEnabled) {
      await this.createTimelineEvent('completion', {
        finalCounts: finalSummary?.finalCounts || this.localCounts,
        duration: finalSummary?.duration,
        summary: finalSummary?.summary,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Save resume state for resumability
   */
  async saveResumeState(
    lastProcessedId: string, 
    resumeData?: any
  ): Promise<void> {
    await this.updateProgress({
      lastProcessedId,
      message: `Checkpoint saved at ${lastProcessedId}`,
      timeline: false // Don't create timeline events for frequent checkpoints
    });
  }

  /**
   * Batch update progress (for high-frequency operations)
   */
  queueUpdate(options: ProgressUpdateOptions): void {
    this.updateQueue.push(options);
    
    if (this.updateQueue.length >= (this.config.batchSize || 10)) {
      this.flushQueue();
    }
  }

  /**
   * Flush queued updates as a batch
   */
  async flushQueue(): Promise<void> {
    if (this.updateQueue.length === 0) return;

    // Merge queued updates
    const merged = this.mergeQueuedUpdates(this.updateQueue);
    this.updateQueue = [];

    await this.updateProgress(merged);
  }

  // Private helper methods
  private buildProgressPayload(options: ProgressUpdateOptions): any {
    return {
      type: options.error ? 'error' : 'progress',
      taskId: this.config.taskId,
      timestamp: new Date().toISOString(),
      processedItems: options.processedItems,
      totalItems: options.totalItems,
      currentDataType: options.currentDataType,
      itemsByType: options.itemsByType,
      lastProcessedId: options.lastProcessedId,
      stage: options.stage,
      operationType: options.operationType,
      message: options.message,
      error: options.error
    };
  }

  private async sendWithRetry(payload: any): Promise<AxiosResponse> {
    let lastError: Error;

    for (let attempt = 1; attempt <= (this.config.retryAttempts || 3); attempt++) {
      try {
        return await axios.post(
          `${this.config.apiEndpoint}/${this.config.taskId}/progress`,
          payload,
          {
            headers: {
              'Authorization': `Bearer ${this.config.apiToken}`,
              'Content-Type': 'application/json'
            },
            timeout: 10000 // 10 second timeout
          }
        );
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < (this.config.retryAttempts || 3)) {
          const delay = (this.config.retryDelay || 1000) * Math.pow(2, attempt - 1);
          console.warn(`Progress update attempt ${attempt} failed, retrying in ${delay}ms:`, error);
          await this.sleep(delay);
        }
      }
    }

    throw lastError!;
  }

  private async createTimelineEvent(eventType: string, details: any): Promise<void> {
    const timelinePayload = {
      type: 'progress',
      taskId: this.config.taskId,
      timestamp: new Date().toISOString(),
      timeline: [{
        timestamp: new Date().toISOString(),
        event: eventType,
        details
      }]
    };

    await this.sendWithRetry(timelinePayload);
  }

  private mergeQueuedUpdates(updates: ProgressUpdateOptions[]): ProgressUpdateOptions {
    const merged: ProgressUpdateOptions = {};
    
    // Take the latest values for most fields
    const latest = updates[updates.length - 1];
    merged.processedItems = latest.processedItems;
    merged.totalItems = latest.totalItems;
    merged.currentDataType = latest.currentDataType;
    merged.lastProcessedId = latest.lastProcessedId;
    merged.stage = latest.stage;
    merged.operationType = latest.operationType;
    merged.message = latest.message;

    // Accumulate itemsByType across all updates
    merged.itemsByType = {};
    updates.forEach(update => {
      if (update.itemsByType) {
        Object.entries(update.itemsByType).forEach(([type, count]) => {
          merged.itemsByType![type] = (merged.itemsByType![type] || 0) + count;
        });
      }
    });

    return merged;
  }

  private getCurrentStage(): string {
    // This should be stored in instance state
    return 'unknown';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### Python Enhanced Progress Tracker

```python
import asyncio
import aiohttp
import logging
from typing import Dict, Optional, Any, List
from datetime import datetime
import json

class EnhancedProgressTracker:
    def __init__(self, api_endpoint: str, api_token: str, task_id: str, 
                 batch_size: int = 10, timeline_enabled: bool = True):
        self.api_endpoint = api_endpoint
        self.api_token = api_token
        self.task_id = task_id
        self.batch_size = batch_size
        self.timeline_enabled = timeline_enabled
        self.local_counts: Dict[str, int] = {}
        self.session: Optional[aiohttp.ClientSession] = None
        
        # Setup logging
        self.logger = logging.getLogger(f'progress_tracker_{task_id}')
        
    async def __aenter__(self):
        self.session = aiohttp.ClientSession(
            headers={'Authorization': f'Bearer {self.api_token}'},
            timeout=aiohttp.ClientTimeout(total=10)
        )
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
    
    async def update_progress(self, 
                            processed_items: Optional[int] = None,
                            total_items: Optional[int] = None,
                            current_data_type: Optional[str] = None,
                            items_by_type: Optional[Dict[str, int]] = None,
                            last_processed_id: Optional[str] = None,
                            stage: Optional[str] = None,
                            operation_type: Optional[str] = None,
                            message: Optional[str] = None,
                            error: Optional[str] = None) -> bool:
        """Send enhanced progress update"""
        
        try:
            # Accumulate local counts
            if items_by_type:
                for item_type, count in items_by_type.items():
                    self.local_counts[item_type] = self.local_counts.get(item_type, 0) + count
            
            payload = {
                'type': 'error' if error else 'progress',
                'taskId': self.task_id,
                'timestamp': datetime.utcnow().isoformat() + 'Z',
                'processedItems': processed_items,
                'totalItems': total_items,
                'currentDataType': current_data_type,
                'itemsByType': items_by_type,
                'lastProcessedId': last_processed_id,
                'stage': stage,
                'operationType': operation_type,
                'message': message,
                'error': error
            }
            
            # Remove None values
            payload = {k: v for k, v in payload.items() if v is not None}
            
            success = await self._send_with_retry(payload)
            
            if success and self.timeline_enabled:
                await self._create_timeline_event('progress_update', {
                    'processedItems': processed_items,
                    'currentDataType': current_data_type,
                    'stage': stage,
                    'itemsByType': items_by_type
                })
            
            return success
            
        except Exception as e:
            self.logger.error(f"Failed to send progress update: {e}")
            return False
    
    async def change_stage(self, new_stage: str, operation_type: str, 
                          additional_data: Optional[Dict] = None) -> bool:
        """Change processing stage with timeline event"""
        
        data = additional_data or {}
        success = await self.update_progress(
            stage=new_stage,
            operation_type=operation_type,
            message=f"Transitioning to {new_stage}",
            **data
        )
        
        if success and self.timeline_enabled:
            await self._create_timeline_event('stage_change', {
                'toStage': new_stage,
                'operationType': operation_type,
                'timestamp': datetime.utcnow().isoformat() + 'Z'
            })
        
        return success
    
    async def report_error(self, error: Exception, context: Dict[str, Any]) -> bool:
        """Report error with enhanced context"""
        
        return await self.update_progress(
            error=str(error),
            stage=context.get('stage'),
            last_processed_id=context.get('last_processed_id'),
            operation_type=context.get('operation_type'),
            message=f"Error: {str(error)}"
        )
    
    async def mark_completed(self, final_summary: Optional[Dict] = None) -> bool:
        """Mark operation as completed"""
        
        summary = final_summary or {}
        
        success = await self.update_progress(
            processed_items=summary.get('total_processed'),
            stage='completed',
            message=summary.get('summary', 'Operation completed successfully')
        )
        
        if success and self.timeline_enabled:
            await self._create_timeline_event('completion', {
                'finalCounts': summary.get('final_counts', self.local_counts),
                'duration': summary.get('duration'),
                'summary': summary.get('summary'),
                'timestamp': datetime.utcnow().isoformat() + 'Z'
            })
        
        return success
    
    async def _send_with_retry(self, payload: Dict, max_retries: int = 3) -> bool:
        """Send HTTP request with retry logic"""
        
        if not self.session:
            self.logger.error("Session not initialized")
            return False
        
        url = f"{self.api_endpoint}/{self.task_id}/progress"
        
        for attempt in range(max_retries):
            try:
                async with self.session.post(url, json=payload) as response:
                    if response.status == 200:
                        return True
                    else:
                        self.logger.warning(f"Progress update failed with status {response.status}")
                        
            except Exception as e:
                if attempt < max_retries - 1:
                    delay = 2 ** attempt  # Exponential backoff
                    self.logger.warning(f"Attempt {attempt + 1} failed, retrying in {delay}s: {e}")
                    await asyncio.sleep(delay)
                else:
                    self.logger.error(f"All attempts failed: {e}")
        
        return False
    
    async def _create_timeline_event(self, event_type: str, details: Dict) -> bool:
        """Create timeline event"""
        
        timeline_payload = {
            'type': 'progress',
            'taskId': self.task_id,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'timeline': [{
                'timestamp': datetime.utcnow().isoformat() + 'Z',
                'event': event_type,
                'details': details
            }]
        }
        
        return await self._send_with_retry(timeline_payload)

# Example usage
async def example_crawler():
    async with EnhancedProgressTracker(
        api_endpoint="https://api.example.com/api/internal2/tasks",
        api_token="your_token_here",
        task_id="job_123"
    ) as tracker:
        
        # Start discovery stage
        await tracker.change_stage("discovery", "discovery")
        
        # Process items with progress updates
        items = await fetch_items()
        total_items = len(items)
        
        for i, item in enumerate(items):
            await process_item(item)
            
            # Update progress every 10 items
            if (i + 1) % 10 == 0:
                await tracker.update_progress(
                    processed_items=i + 1,
                    total_items=total_items,
                    current_data_type="issues",
                    items_by_type={"issues": 10},
                    last_processed_id=item.id
                )
        
        # Mark as completed
        await tracker.mark_completed({
            'total_processed': len(items),
            'summary': f'Successfully processed {len(items)} items'
        })
```

## Integration Patterns

### Async/Await Pattern for API Calls

```typescript
class AsyncProgressTracker {
  private updatePromises: Promise<void>[] = [];
  
  async updateProgressAsync(options: ProgressUpdateOptions): Promise<void> {
    // Non-blocking progress update
    const updatePromise = this.doUpdateProgress(options)
      .catch(error => {
        console.error('Progress update failed:', error);
        // Don't throw - keep crawler running
      });
    
    this.updatePromises.push(updatePromise);
    
    // Clean up completed promises periodically
    if (this.updatePromises.length > 10) {
      this.updatePromises = this.updatePromises.filter(p => 
        p.constructor.name === 'Promise' // Keep only pending promises
      );
    }
  }
  
  async waitForAllUpdates(): Promise<void> {
    await Promise.allSettled(this.updatePromises);
    this.updatePromises = [];
  }
  
  private async doUpdateProgress(options: ProgressUpdateOptions): Promise<void> {
    // Actual implementation here
  }
}
```

### Rate Limiting and Throttling

```typescript
class ThrottledProgressTracker {
  private lastUpdateTime = 0;
  private minUpdateInterval = 1000; // 1 second minimum between updates
  private pendingUpdate: ProgressUpdateOptions | null = null;
  private updateTimer: NodeJS.Timeout | null = null;
  
  async updateProgress(options: ProgressUpdateOptions): Promise<void> {
    const now = Date.now();
    
    // Update pending state
    this.pendingUpdate = this.mergePendingUpdate(this.pendingUpdate, options);
    
    // If enough time has passed, send immediately
    if (now - this.lastUpdateTime >= this.minUpdateInterval) {
      await this.sendPendingUpdate();
    } else {
      // Schedule update for later
      this.scheduleUpdate();
    }
  }
  
  private scheduleUpdate(): void {
    if (this.updateTimer) return; // Already scheduled
    
    const nextUpdateTime = this.lastUpdateTime + this.minUpdateInterval;
    const delay = Math.max(0, nextUpdateTime - Date.now());
    
    this.updateTimer = setTimeout(() => {
      this.updateTimer = null;
      this.sendPendingUpdate();
    }, delay);
  }
  
  private async sendPendingUpdate(): Promise<void> {
    if (!this.pendingUpdate) return;
    
    const update = this.pendingUpdate;
    this.pendingUpdate = null;
    this.lastUpdateTime = Date.now();
    
    await this.doSendUpdate(update);
  }
  
  private mergePendingUpdate(
    existing: ProgressUpdateOptions | null, 
    incoming: ProgressUpdateOptions
  ): ProgressUpdateOptions {
    if (!existing) return incoming;
    
    return {
      ...existing,
      ...incoming,
      // Accumulate itemsByType
      itemsByType: {
        ...existing.itemsByType,
        ...incoming.itemsByType,
        // Merge counts
        ...Object.fromEntries(
          Object.entries(incoming.itemsByType || {}).map(([type, count]) => [
            type,
            (existing.itemsByType?.[type] || 0) + count
          ])
        )
      }
    };
  }
}
```

### Connection Pooling for API Calls

```typescript
import { Agent } from 'https';
import axios from 'axios';

class PooledProgressTracker {
  private httpAgent: Agent;
  private axiosInstance: typeof axios;
  
  constructor(config: EnhancedProgressConfig) {
    // Create connection pool
    this.httpAgent = new Agent({
      keepAlive: true,
      maxSockets: 5,
      maxFreeSockets: 2,
      timeout: 10000,
      freeSocketTimeout: 30000
    });
    
    // Configure axios with connection pooling
    this.axiosInstance = axios.create({
      baseURL: config.apiEndpoint,
      timeout: 10000,
      headers: {
        'Authorization': `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
        'Connection': 'keep-alive'
      },
      httpsAgent: this.httpAgent,
      // Retry configuration
      validateStatus: (status) => status < 500, // Don't retry on 4xx errors
    });
    
    // Add response interceptor for automatic retries
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      async (error) => {
        const config = error.config;
        
        // Retry on network errors or 5xx responses
        if (this.shouldRetry(error) && config && !config._retryCount) {
          config._retryCount = (config._retryCount || 0) + 1;
          
          if (config._retryCount <= 3) {
            const delay = Math.pow(2, config._retryCount) * 1000;
            await this.sleep(delay);
            return this.axiosInstance.request(config);
          }
        }
        
        return Promise.reject(error);
      }
    );
  }
  
  async sendProgressUpdate(payload: any): Promise<void> {
    try {
      const response = await this.axiosInstance.post(
        `/${payload.taskId}/progress`,
        payload
      );
      
      if (response.status !== 200) {
        throw new Error(`API returned status ${response.status}`);
      }
    } catch (error) {
      console.error('Progress update failed:', error);
      throw error;
    }
  }
  
  destroy(): void {
    this.httpAgent.destroy();
  }
  
  private shouldRetry(error: any): boolean {
    // Retry on network errors
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      return true;
    }
    
    // Retry on 5xx status codes
    if (error.response && error.response.status >= 500) {
      return true;
    }
    
    return false;
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

## Common Scenarios

### Discovery Operation Progress Tracking

```typescript
class DiscoveryProgressTracker extends EnhancedProgressTracker {
  private discoveredAreas: any[] = [];
  
  async trackDiscoveryOperation(discoveryFunction: () => AsyncGenerator<any>): Promise<void> {
    await this.changeStage('discovery', 'discovery');
    
    let totalDiscovered = 0;
    const itemCounts = { groups: 0, projects: 0 };
    
    try {
      for await (const area of discoveryFunction()) {
        this.discoveredAreas.push(area);
        totalDiscovered++;
        
        if (area.type === 'group') itemCounts.groups++;
        if (area.type === 'project') itemCounts.projects++;
        
        // Update progress every 10 discoveries
        if (totalDiscovered % 10 === 0) {
          await this.updateProgress({
            processedItems: totalDiscovered,
            currentDataType: 'areas',
            itemsByType: { [area.type]: 1 }, // Increment by 1 for accumulation
            lastProcessedId: area.id,
            stage: 'discovery',
            operationType: 'discovery',
            message: `Discovered ${totalDiscovered} areas (${itemCounts.groups} groups, ${itemCounts.projects} projects)`
          });
        }
      }
      
      // Final discovery update
      await this.updateProgress({
        processedItems: totalDiscovered,
        currentDataType: 'areas',
        stage: 'discovery',
        operationType: 'discovery',
        message: `Discovery completed: ${totalDiscovered} areas discovered`
      });
      
      // Send discovered areas data if API supports it
      await this.sendDiscoveredAreas(this.discoveredAreas);
      
    } catch (error) {
      await this.reportError(error as Error, {
        stage: 'discovery',
        lastProcessedId: this.discoveredAreas[this.discoveredAreas.length - 1]?.id,
        operationType: 'discovery',
        additionalContext: {
          totalDiscovered,
          itemCounts
        }
      });
      throw error;
    }
  }
  
  private async sendDiscoveredAreas(areas: any[]): Promise<void> {
    // Format areas for API
    const discoveredAreaData = areas.map(area => ({
      type: area.type,
      name: area.name,
      gitlabId: area.id,
      fullPath: area.full_path,
      webUrl: area.web_url,
      description: area.description,
      discoveredBy: 'crawler_token_123'
    }));
    
    // Send as special discovery update
    const payload = {
      type: 'progress',
      taskId: this.config.taskId,
      status: 'new_areas_discovered',
      timestamp: new Date().toISOString(),
      areas: discoveredAreaData,
      itemsByType: {
        groups: areas.filter(a => a.type === 'group').length,
        projects: areas.filter(a => a.type === 'project').length
      },
      stage: 'discovery',
      operationType: 'discovery',
      message: `Discovered ${areas.length} areas`
    };
    
    await this.sendWithRetry(payload);
  }
}
```

### Data Collection Progress Updates

```typescript
class DataCollectionTracker extends EnhancedProgressTracker {
  async trackDataCollection<T>(
    items: T[],
    processor: (item: T) => Promise<void>,
    options: {
      dataType: string;
      batchSize?: number;
      resumeFromId?: string;
    }
  ): Promise<void> {
    const { dataType, batchSize = 10, resumeFromId } = options;
    
    await this.changeStage('data_collection', 'data_collection');
    
    // Find resume point if specified
    let startIndex = 0;
    if (resumeFromId) {
      startIndex = items.findIndex((item: any) => item.id === resumeFromId);
      if (startIndex === -1) {
        console.warn(`Resume ID ${resumeFromId} not found, starting from beginning`);
        startIndex = 0;
      } else {
        startIndex++; // Start after the last processed item
      }
    }
    
    const totalItems = items.length;
    let processedItems = startIndex;
    let batchCount = 0;
    
    try {
      for (let i = startIndex; i < items.length; i++) {
        const item = items[i];
        
        await processor(item);
        processedItems++;
        batchCount++;
        
        // Update progress every batch or at completion
        if (batchCount >= batchSize || i === items.length - 1) {
          await this.updateProgress({
            processedItems,
            totalItems,
            currentDataType: dataType,
            itemsByType: { [dataType]: batchCount },
            lastProcessedId: (item as any).id,
            stage: 'data_collection',
            operationType: 'data_collection',
            message: `Processed ${processedItems}/${totalItems} ${dataType}`
          });
          
          batchCount = 0; // Reset batch count for accumulation
        }
      }
      
      await this.changeStage('finalization', 'data_collection', {
        processedItems,
        totalItems,
        message: `Completed processing ${processedItems} ${dataType}`
      });
      
    } catch (error) {
      await this.reportError(error as Error, {
        stage: 'data_collection',
        lastProcessedId: processedItems > 0 ? (items[processedItems - 1] as any).id : undefined,
        operationType: 'data_collection',
        additionalContext: {
          dataType,
          processedItems,
          totalItems,
          progressPercentage: Math.round((processedItems / totalItems) * 100)
        }
      });
      throw error;
    }
  }
}
```

### Error Recovery and Resumability

```typescript
class ResumableCrawlerTracker extends EnhancedProgressTracker {
  private checkpointInterval = 50; // Save checkpoint every 50 items
  
  async processWithRecovery<T>(
    items: T[],
    processor: (item: T) => Promise<any>,
    options: {
      dataType: string;
      operationType: string;
      resumeState?: any;
    }
  ): Promise<void> {
    const { dataType, operationType, resumeState } = options;
    
    // Resume from saved state if available
    let startIndex = 0;
    let processedCount = 0;
    
    if (resumeState?.lastProcessedId) {
      const resumeIndex = items.findIndex((item: any) => item.id === resumeState.lastProcessedId);
      if (resumeIndex !== -1) {
        startIndex = resumeIndex + 1;
        processedCount = resumeState.processedCount || resumeIndex + 1;
        console.log(`Resuming from index ${startIndex}, ${processedCount} items already processed`);
      }
    }
    
    try {
      for (let i = startIndex; i < items.length; i++) {
        const item = items[i];
        
        try {
          await processor(item);
          processedCount++;
          
          // Save checkpoint periodically
          if (processedCount % this.checkpointInterval === 0) {
            await this.saveCheckpoint((item as any).id, {
              processedCount,
              currentIndex: i,
              timestamp: new Date().toISOString()
            });
          }
          
          // Regular progress update
          if (processedCount % 10 === 0) {
            await this.updateProgress({
              processedItems: processedCount,
              totalItems: items.length,
              currentDataType: dataType,
              itemsByType: { [dataType]: 1 },
              lastProcessedId: (item as any).id,
              stage: 'data_collection',
              operationType: operationType as any,
              message: `Processing ${dataType}: ${processedCount}/${items.length}`
            });
          }
          
        } catch (itemError) {
          // Handle individual item errors
          console.error(`Error processing item ${(item as any).id}:`, itemError);
          
          await this.reportError(itemError as Error, {
            stage: 'data_collection',
            lastProcessedId: (item as any).id,
            operationType,
            additionalContext: {
              itemId: (item as any).id,
              itemType: dataType,
              processedCount,
              totalItems: items.length
            }
          });
          
          // Continue with next item instead of failing entire operation
          continue;
        }
      }
      
      // Final completion update
      await this.markCompleted({
        total_processed: processedCount,
        final_counts: { [dataType]: processedCount },
        summary: `Successfully processed ${processedCount}/${items.length} ${dataType}`
      });
      
    } catch (fatalError) {
      // Save final state for recovery
      const lastProcessedItem = processedCount > 0 ? items[startIndex + processedCount - 1] : null;
      
      await this.saveCheckpoint(
        lastProcessedItem ? (lastProcessedItem as any).id : null,
        {
          processedCount,
          fatalError: fatalError.message,
          timestamp: new Date().toISOString()
        }
      );
      
      throw fatalError;
    }
  }
  
  private async saveCheckpoint(lastProcessedId: string | null, checkpointData: any): Promise<void> {
    await this.updateProgress({
      lastProcessedId,
      message: `Checkpoint saved: ${checkpointData.processedCount} items processed`,
      timeline: false // Don't spam timeline with checkpoints
    });
    
    // Could also save to local file system as backup
    console.log('Checkpoint saved:', { lastProcessedId, ...checkpointData });
  }
}
```

### Job Completion Reporting

```typescript
class CompletionReportTracker extends EnhancedProgressTracker {
  private startTime = new Date();
  private operationStats = {
    itemsProcessed: 0,
    errors: 0,
    warnings: 0,
    bytesProcessed: 0
  };
  
  trackOperation<T>(operation: () => Promise<T>): Promise<T> {
    return this.withCompletionReport(operation);
  }
  
  private async withCompletionReport<T>(operation: () => Promise<T>): Promise<T> {
    this.startTime = new Date();
    
    try {
      const result = await operation();
      
      // Calculate duration
      const duration = Date.now() - this.startTime.getTime();
      
      // Generate completion report
      await this.generateCompletionReport({
        success: true,
        duration,
        result
      });
      
      return result;
      
    } catch (error) {
      const duration = Date.now() - this.startTime.getTime();
      
      await this.generateCompletionReport({
        success: false,
        duration,
        error: error as Error
      });
      
      throw error;
    }
  }
  
  private async generateCompletionReport(data: {
    success: boolean;
    duration: number;
    result?: any;
    error?: Error;
  }): Promise<void> {
    const { success, duration, result, error } = data;
    
    const report = {
      success,
      duration,
      durationFormatted: this.formatDuration(duration),
      startTime: this.startTime.toISOString(),
      endTime: new Date().toISOString(),
      stats: { ...this.operationStats },
      performance: {
        itemsPerSecond: this.operationStats.itemsProcessed / (duration / 1000),
        mbProcessed: this.operationStats.bytesProcessed / (1024 * 1024)
      }
    };
    
    if (success) {
      await this.markCompleted({
        total_processed: this.operationStats.itemsProcessed,
        duration,
        summary: `Operation completed successfully in ${report.durationFormatted}`,
        final_counts: result?.itemCounts || {},
        performance_metrics: report.performance
      });
    } else {
      await this.reportError(error!, {
        stage: 'completion',
        operationType: 'finalization',
        additionalContext: {
          ...report,
          errorType: error?.name,
          errorMessage: error?.message
        }
      });
    }
  }
  
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
  
  // Helper methods to track stats
  incrementItemsProcessed(count = 1): void {
    this.operationStats.itemsProcessed += count;
  }
  
  incrementErrors(count = 1): void {
    this.operationStats.errors += count;
  }
  
  addBytesProcessed(bytes: number): void {
    this.operationStats.bytesProcessed += bytes;
  }
}
```

## Framework-Specific Examples

### Express.js/Node.js Crawler Integration

```typescript
import express from 'express';
import { EnhancedProgressTracker } from './enhanced-progress-tracker';

class ExpressCrawlerService {
  private app = express();
  private activeJobs = new Map<string, EnhancedProgressTracker>();
  
  constructor() {
    this.setupRoutes();
  }
  
  private setupRoutes(): void {
    // Start crawler job
    this.app.post('/crawler/start', async (req, res) => {
      const { jobId, config } = req.body;
      
      try {
        const tracker = new EnhancedProgressTracker({
          apiEndpoint: process.env.API_ENDPOINT!,
          apiToken: process.env.API_TOKEN!,
          taskId: jobId
        });
        
        this.activeJobs.set(jobId, tracker);
        
        // Start crawler in background
        this.startCrawlerJob(jobId, config, tracker);
        
        res.json({ success: true, jobId });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // Get job status
    this.app.get('/crawler/status/:jobId', (req, res) => {
      const { jobId } = req.params;
      const tracker = this.activeJobs.get(jobId);
      
      if (!tracker) {
        return res.status(404).json({ error: 'Job not found' });
      }
      
      res.json({
        jobId,
        status: 'running',
        lastUpdate: tracker.lastUpdate
      });
    });
  }
  
  private async startCrawlerJob(
    jobId: string, 
    config: any, 
    tracker: EnhancedProgressTracker
  ): Promise<void> {
    try {
      await tracker.changeStage('initializing', 'discovery');
      
      // Discovery phase
      const discoveredAreas = await this.performDiscovery(tracker, config);
      
      // Data collection phase
      await this.performDataCollection(tracker, discoveredAreas);
      
      // Cleanup
      this.activeJobs.delete(jobId);
      
    } catch (error) {
      await tracker.reportError(error as Error, {
        stage: 'unknown',
        operationType: 'unknown',
        additionalContext: { jobId, config }
      });
      
      this.activeJobs.delete(jobId);
    }
  }
  
  private async performDiscovery(
    tracker: EnhancedProgressTracker, 
    config: any
  ): Promise<any[]> {
    await tracker.changeStage('discovery', 'discovery');
    
    const areas = await this.fetchAreasFromAPI(config);
    
    for (let i = 0; i < areas.length; i++) {
      const area = areas[i];
      
      // Process area
      await this.processArea(area);
      
      if ((i + 1) % 5 === 0) {
        await tracker.updateProgress({
          processedItems: i + 1,
          totalItems: areas.length,
          currentDataType: 'areas',
          itemsByType: { [area.type]: 1 },
          lastProcessedId: area.id,
          stage: 'discovery',
          operationType: 'discovery'
        });
      }
    }
    
    return areas;
  }
  
  private async performDataCollection(
    tracker: EnhancedProgressTracker,
    areas: any[]
  ): Promise<void> {
    await tracker.changeStage('data_collection', 'data_collection');
    
    // Process each area
    for (const area of areas) {
      if (area.type === 'project') {
        await this.collectProjectData(tracker, area);
      }
    }
  }
  
  private async collectProjectData(
    tracker: EnhancedProgressTracker,
    project: any
  ): Promise<void> {
    // Collect issues
    const issues = await this.fetchProjectIssues(project.id);
    await this.processItemsWithTracking(tracker, issues, 'issues');
    
    // Collect merge requests
    const mrs = await this.fetchProjectMergeRequests(project.id);
    await this.processItemsWithTracking(tracker, mrs, 'mergeRequests');
  }
  
  private async processItemsWithTracking(
    tracker: EnhancedProgressTracker,
    items: any[],
    itemType: string
  ): Promise<void> {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
      await this.processItem(item);
      
      if ((i + 1) % 10 === 0) {
        await tracker.updateProgress({
          processedItems: i + 1,
          currentDataType: itemType,
          itemsByType: { [itemType]: 10 },
          lastProcessedId: item.id,
          stage: 'data_collection',
          operationType: 'data_collection'
        });
      }
    }
  }
  
  // Placeholder methods - implement based on your crawler logic
  private async fetchAreasFromAPI(config: any): Promise<any[]> { return []; }
  private async processArea(area: any): Promise<void> { }
  private async fetchProjectIssues(projectId: string): Promise<any[]> { return []; }
  private async fetchProjectMergeRequests(projectId: string): Promise<any[]> { return []; }
  private async processItem(item: any): Promise<void> { }
}
```

### Python asyncio Crawler Integration

```python
import asyncio
import aiohttp
from typing import List, Dict, Any
from enhanced_progress_tracker import EnhancedProgressTracker

class AsyncCrawlerService:
    def __init__(self, api_endpoint: str, api_token: str):
        self.api_endpoint = api_endpoint
        self.api_token = api_token
        self.active_jobs: Dict[str, EnhancedProgressTracker] = {}
    
    async def start_crawler_job(self, job_id: str, config: Dict[str, Any]):
        """Start a new crawler job with enhanced progress tracking"""
        
        async with EnhancedProgressTracker(
            api_endpoint=self.api_endpoint,
            api_token=self.api_token,
            task_id=job_id
        ) as tracker:
            
            self.active_jobs[job_id] = tracker
            
            try:
                await tracker.change_stage("initializing", "discovery")
                
                # Discovery phase
                discovered_areas = await self.perform_discovery(tracker, config)
                
                # Data collection phase
                await self.perform_data_collection(tracker, discovered_areas)
                
                await tracker.mark_completed({
                    'total_processed': len(discovered_areas),
                    'summary': f'Successfully completed job {job_id}'
                })
                
            except Exception as error:
                await tracker.report_error(error, {
                    'stage': 'unknown',
                    'operation_type': 'unknown',
                    'job_id': job_id,
                    'config': config
                })
                raise
            finally:
                self.active_jobs.pop(job_id, None)
    
    async def perform_discovery(self, tracker: EnhancedProgressTracker, config: Dict) -> List[Any]:
        """Perform discovery phase with progress tracking"""
        
        await tracker.change_stage("discovery", "discovery")
        
        # Fetch areas (groups, projects) from API
        areas = await self.fetch_areas_from_api(config)
        
        processed_count = 0
        item_counts = {'groups': 0, 'projects': 0}
        
        # Process areas in batches for better performance
        batch_size = 10
        for i in range(0, len(areas), batch_size):
            batch = areas[i:i + batch_size]
            
            # Process batch concurrently
            tasks = [self.process_area(area) for area in batch]
            await asyncio.gather(*tasks)
            
            # Update counts
            for area in batch:
                processed_count += 1
                item_counts[area['type']] += 1
            
            # Send progress update
            await tracker.update_progress(
                processed_items=processed_count,
                total_items=len(areas),
                current_data_type='areas',
                items_by_type={area['type']: 1 for area in batch},  # Increment counts
                last_processed_id=batch[-1]['id'],
                stage='discovery',
                operation_type='discovery',
                message=f"Discovered {processed_count}/{len(areas)} areas"
            )
        
        return areas
    
    async def perform_data_collection(self, tracker: EnhancedProgressTracker, areas: List[Any]):
        """Perform data collection phase with progress tracking"""
        
        await tracker.change_stage("data_collection", "data_collection")
        
        # Filter for projects only
        projects = [area for area in areas if area['type'] == 'project']
        
        for i, project in enumerate(projects):
            await self.collect_project_data(tracker, project)
            
            # Update progress every 5 projects
            if (i + 1) % 5 == 0:
                await tracker.update_progress(
                    processed_items=i + 1,
                    total_items=len(projects),
                    current_data_type='projects',
                    last_processed_id=project['id'],
                    stage='data_collection',
                    operation_type='data_collection',
                    message=f"Processed {i + 1}/{len(projects)} projects"
                )
    
    async def collect_project_data(self, tracker: EnhancedProgressTracker, project: Dict[str, Any]):
        """Collect data for a specific project"""
        
        try:
            # Collect issues
            issues = await self.fetch_project_issues(project['id'])
            await self.process_items_with_tracking(tracker, issues, 'issues')
            
            # Collect merge requests
            merge_requests = await self.fetch_project_merge_requests(project['id'])
            await self.process_items_with_tracking(tracker, merge_requests, 'merge_requests')
            
            # Collect commits
            commits = await self.fetch_project_commits(project['id'])
            await self.process_items_with_tracking(tracker, commits, 'commits')
            
        except Exception as error:
            await tracker.report_error(error, {
                'stage': 'data_collection',
                'operation_type': 'data_collection',
                'project_id': project['id'],
                'project_name': project.get('name', 'unknown')
            })
            # Continue with next project instead of failing entire job
    
    async def process_items_with_tracking(
        self, 
        tracker: EnhancedProgressTracker, 
        items: List[Any], 
        item_type: str
    ):
        """Process items with progress tracking"""
        
        batch_size = 20
        for i in range(0, len(items), batch_size):
            batch = items[i:i + batch_size]
            
            # Process batch
            tasks = [self.process_item(item) for item in batch]
            await asyncio.gather(*tasks, return_exceptions=True)
            
            # Update progress
            await tracker.update_progress(
                current_data_type=item_type,
                items_by_type={item_type: len(batch)},
                last_processed_id=batch[-1]['id'] if batch else None,
                stage='data_collection',
                operation_type='data_collection',
                message=f"Processed {min(i + batch_size, len(items))}/{len(items)} {item_type}"
            )
    
    # Placeholder methods - implement based on your crawler logic
    async def fetch_areas_from_api(self, config: Dict) -> List[Any]:
        # Implementation here
        return []
    
    async def process_area(self, area: Dict[str, Any]):
        # Implementation here
        pass
    
    async def fetch_project_issues(self, project_id: str) -> List[Any]:
        # Implementation here
        return []
    
    async def fetch_project_merge_requests(self, project_id: str) -> List[Any]:
        # Implementation here
        return []
    
    async def fetch_project_commits(self, project_id: str) -> List[Any]:
        # Implementation here
        return []
    
    async def process_item(self, item: Dict[str, Any]):
        # Implementation here
        pass

# Usage example
async def main():
    crawler = AsyncCrawlerService(
        api_endpoint="https://api.example.com/api/internal2/tasks",
        api_token="your_token_here"
    )
    
    await crawler.start_crawler_job("job_123", {
        'source': 'gitlab',
        'base_url': 'https://gitlab.example.com',
        'target_groups': ['group1', 'group2']
    })

if __name__ == "__main__":
    asyncio.run(main())
```

## Performance Optimization

### Efficient Progress Update Batching

```typescript
class BatchedProgressTracker extends EnhancedProgressTracker {
  private batchQueue: ProgressUpdateOptions[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private readonly batchInterval = 2000; // 2 seconds
  private readonly maxBatchSize = 50;
  
  async updateProgressBatched(options: ProgressUpdateOptions): Promise<void> {
    this.batchQueue.push(options);
    
    // Send immediately if batch is full
    if (this.batchQueue.length >= this.maxBatchSize) {
      await this.flushBatch();
    } else {
      // Schedule batch send if not already scheduled
      this.scheduleBatchSend();
    }
  }
  
  private scheduleBatchSend(): void {
    if (this.batchTimer) return; // Already scheduled
    
    this.batchTimer = setTimeout(async () => {
      this.batchTimer = null;
      await this.flushBatch();
    }, this.batchInterval);
  }
  
  private async flushBatch(): Promise<void> {
    if (this.batchQueue.length === 0) return;
    
    // Merge all updates in the batch
    const merged = this.mergeBatchUpdates(this.batchQueue);
    this.batchQueue = [];
    
    await this.updateProgress(merged);
  }
  
  private mergeBatchUpdates(updates: ProgressUpdateOptions[]): ProgressUpdateOptions {
    if (updates.length === 1) return updates[0];
    
    const merged: ProgressUpdateOptions = {};
    const itemsByType: Record<string, number> = {};
    
    // Take latest values for most fields
    const latest = updates[updates.length - 1];
    merged.processedItems = latest.processedItems;
    merged.totalItems = latest.totalItems;
    merged.currentDataType = latest.currentDataType;
    merged.lastProcessedId = latest.lastProcessedId;
    merged.stage = latest.stage;
    merged.operationType = latest.operationType;
    merged.message = latest.message;
    
    // Accumulate itemsByType across all updates
    updates.forEach(update => {
      if (update.itemsByType) {
        Object.entries(update.itemsByType).forEach(([type, count]) => {
          itemsByType[type] = (itemsByType[type] || 0) + count;
        });
      }
    });
    
    if (Object.keys(itemsByType).length > 0) {
      merged.itemsByType = itemsByType;
    }
    
    return merged;
  }
  
  // Ensure final batch is sent
  async destroy(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    
    await this.flushBatch();
  }
}
```

### Memory-Efficient Timeline Management

```typescript
class MemoryEfficientTracker extends EnhancedProgressTracker {
  private timelineBuffer: any[] = [];
  private readonly maxTimelineEvents = 100;
  private readonly timelineFlushInterval = 10000; // 10 seconds
  
  protected async createTimelineEvent(eventType: string, details: any): Promise<void> {
    // Add to buffer instead of sending immediately
    this.timelineBuffer.push({
      timestamp: new Date().toISOString(),
      event: eventType,
      details
    });
    
    // Flush if buffer is full or on critical events
    if (this.timelineBuffer.length >= this.maxTimelineEvents || this.isCriticalEvent(eventType)) {
      await this.flushTimelineBuffer();
    }
  }
  
  private async flushTimelineBuffer(): Promise<void> {
    if (this.timelineBuffer.length === 0) return;
    
    // Send timeline events
    const timelinePayload = {
      type: 'progress',
      taskId: this.config.taskId,
      timestamp: new Date().toISOString(),
      timeline: [...this.timelineBuffer]
    };
    
    this.timelineBuffer = [];
    
    await this.sendWithRetry(timelinePayload);
  }
  
  private isCriticalEvent(eventType: string): boolean {
    return ['error', 'completion', 'stage_change'].includes(eventType);
  }
  
  // Auto-flush timeline buffer periodically
  private startTimelineAutoFlush(): void {
    setInterval(async () => {
      await this.flushTimelineBuffer();
    }, this.timelineFlushInterval);
  }
}
```

This comprehensive implementation guide provides practical, production-ready code examples for integrating the enhanced progress tracking system into various crawler architectures. Each example includes error handling, performance optimizations, and best practices for real-world deployment.