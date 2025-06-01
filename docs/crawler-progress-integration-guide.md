# Crawler Progress Integration Guide

This comprehensive guide provides everything you need to integrate your crawler with the enhanced progress tracking system. The system offers detailed progress tracking, intelligent data accumulation, resumability support, and rich timeline tracking.

## Table of Contents

1. [Quick Start](#quick-start)
2. [API Integration Details](#api-integration-details)
3. [Progress Data Structure](#progress-data-structure)
4. [Implementation Examples](#implementation-examples)
5. [Best Practices](#best-practices)
6. [Error Handling](#error-handling)
7. [Testing and Debugging](#testing-and-debugging)

## Quick Start

### Basic Progress Update

Here's the minimal setup to send progress updates:

```typescript
// Basic progress update
const progressUpdate = {
  taskId: "job_123",
  status: "processing",
  timestamp: new Date().toISOString(),
  processedItems: 50,
  totalItems: 200,
  currentDataType: "issues"
};

const response = await fetch('/api/internal/jobs/progress', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${CRAWLER_API_TOKEN}`
  },
  body: JSON.stringify(progressUpdate)
});
```

### Enhanced Progress Update

For more detailed tracking, include the enhanced fields:

```typescript
const enhancedProgressUpdate = {
  taskId: "job_123",
  status: "processing",
  timestamp: new Date().toISOString(),
  processedItems: 150,
  totalItems: 500,
  currentDataType: "issues",
  
  // Enhanced fields for detailed tracking
  itemsByType: {
    groups: 5,
    projects: 20,
    issues: 150,
    mergeRequests: 75
  },
  lastProcessedId: "issue_12345",
  stage: "data_collection",
  operationType: "branch_crawling",
  message: "Processing merge requests for project XYZ"
};
```

## API Integration Details

### Authentication

All requests to the progress API require authentication using the `CRAWLER_API_TOKEN`:

```typescript
const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${process.env.CRAWLER_API_TOKEN}`
};
```

**Security Note**: The `CRAWLER_API_TOKEN` should be stored securely and never committed to version control.

### Endpoint URL

```
POST /api/internal/jobs/progress
```

### Complete Payload Structure

```typescript
interface ProgressUpdatePayload {
  // Required fields
  taskId: string;                    // Job ID from the database
  status: string;                    // Job status (see status types below)
  timestamp: string;                 // ISO 8601 timestamp
  
  // Basic progress fields
  processedItems?: number;           // Number of items processed
  totalItems?: number;              // Total items to process
  currentDataType?: string;         // Current data type being processed
  message?: string;                 // Human-readable progress message
  error?: string | Record<string, any>; // Error information if applicable
  progress?: any;                   // Resume state data
  
  // Enhanced progress fields
  itemsByType?: {
    groups?: number;                // Number of groups processed
    projects?: number;              // Number of projects processed
    issues?: number;               // Number of issues processed
    mergeRequests?: number;        // Number of merge requests processed
    commits?: number;              // Number of commits processed
    pipelines?: number;            // Number of pipelines processed
    branches?: number;             // Number of branches processed
    tags?: number;                 // Number of tags processed
    users?: number;                // Number of users processed
    milestones?: number;           // Number of milestones processed
    labels?: number;               // Number of labels processed
    [key: string]: number | undefined; // Extensible for custom types
  };
  lastProcessedId?: string;         // ID of last processed item (for resumability)
  stage?: string;                   // Current processing stage
  operationType?: 'discovery' | 'branch_crawling' | 'data_collection' | 'finalization';
  
  // Special purpose fields
  areas?: DiscoveredAreaData[];     // For area discovery operations
  credentialStatus?: CredentialStatusUpdate; // For credential status changes
}
```

### Status Types

The `status` field determines how the progress update is processed:

| Status | Description | When to Use |
|--------|-------------|-------------|
| `started` | Job has begun | When crawler starts processing |
| `processing` | Job is actively running | During normal progress updates |
| `completed` | Job finished successfully | When all processing is complete |
| `failed` | Job encountered fatal error | When job cannot continue |
| `paused` | Job temporarily stopped | When job is paused but can resume |
| `new_areas_discovered` | New areas found | During discovery operations |
| `credential_expiry` | Credentials expired | When authentication fails |
| `credential_renewal` | Credentials being renewed | During credential refresh |
| `credential_resumed` | Credentials restored | After successful credential renewal |

### Operation Types

Use `operationType` to categorize the type of operation:

- **`discovery`**: Finding new groups, projects, or areas
- **`branch_crawling`**: Processing branches and related data
- **`data_collection`**: Gathering issues, MRs, commits, etc.
- **`finalization`**: Cleanup and completion tasks

## Progress Data Structure

### Core Progress Data Interface

The system uses the [`CrawlerProgressData`](../src/lib/types/progress.ts:8) interface for all progress tracking:

```typescript
interface CrawlerProgressData {
  // Basic progress tracking
  processedItems?: number;
  totalItems?: number;
  currentDataType?: string;
  
  // Detailed breakdown by item type
  itemsByType?: {
    groups?: number;
    projects?: number;
    issues?: number;
    mergeRequests?: number;
    commits?: number;
    pipelines?: number;
    branches?: number;
    tags?: number;
    users?: number;
    milestones?: number;
    labels?: number;
    [key: string]: number | undefined;
  };
  
  // Progress tracking metadata
  lastProcessedId?: string;
  stage?: string;
  operationType?: 'discovery' | 'branch_crawling' | 'data_collection' | 'finalization';
  message?: string;
  lastUpdate?: string;
  
  // Timeline tracking for detailed progress history
  timeline?: ProgressTimelineEvent[];
}
```

### Timeline Events

The system automatically creates timeline events for audit and debugging:

```typescript
interface ProgressTimelineEvent {
  timestamp: string;
  event: 'progress_update' | 'areas_discovered' | 'credential_status_change' | 'discovery_progress' | 'stage_change' | 'error' | 'completion';
  details: {
    [key: string]: any;
  };
}
```

### Intelligent Data Accumulation

The progress system intelligently accumulates data:

- **`processedItems`**: Uses `Math.max()` to ensure monotonic progression
- **`itemsByType`**: Accumulates counts rather than overwriting
- **`totalItems`**: Updates when new totals are provided
- **`lastProcessedId`**: Always uses the most recent value for resumability
- **Timeline**: Appends new events to existing timeline

## Implementation Examples

### 1. Basic Job Lifecycle

```typescript
class CrawlerProgressTracker {
  constructor(private taskId: string, private apiToken: string) {}

  async sendUpdate(update: Partial<ProgressUpdatePayload>) {
    const payload: ProgressUpdatePayload = {
      taskId: this.taskId,
      timestamp: new Date().toISOString(),
      ...update
    };

    const response = await fetch('/api/internal/jobs/progress', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiToken}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Progress update failed: ${response.statusText}`);
    }

    return response.json();
  }

  // Start job
  async start() {
    return this.sendUpdate({
      status: 'started',
      stage: 'initialization',
      operationType: 'discovery',
      message: 'Starting crawler operation'
    });
  }

  // Report progress
  async updateProgress(processed: number, total?: number, dataType?: string) {
    return this.sendUpdate({
      status: 'processing',
      processedItems: processed,
      totalItems: total,
      currentDataType: dataType,
      stage: 'data_collection',
      operationType: 'data_collection'
    });
  }

  // Complete job
  async complete() {
    return this.sendUpdate({
      status: 'completed',
      stage: 'finalization',
      message: 'Crawler operation completed successfully'
    });
  }

  // Report error
  async reportError(error: string | Error) {
    return this.sendUpdate({
      status: 'failed',
      error: error instanceof Error ? error.message : error,
      message: 'Crawler operation failed'
    });
  }
}
```

### 2. Discovery Operation Example

```typescript
async function performDiscovery(tracker: CrawlerProgressTracker) {
  // Start discovery
  await tracker.sendUpdate({
    status: 'started',
    stage: 'discovery',
    operationType: 'discovery',
    message: 'Beginning area discovery'
  });

  // Discover groups and projects
  const discoveredAreas = await discoverAreas();
  
  // Report discovered areas
  await tracker.sendUpdate({
    status: 'new_areas_discovered',
    areas: discoveredAreas.map(area => ({
      type: area.type as 'group' | 'project',
      name: area.name,
      gitlabId: area.id,
      fullPath: area.full_path,
      webUrl: area.web_url,
      description: area.description,
      discoveredBy: 'crawler_token_123'
    })),
    itemsByType: {
      groups: discoveredAreas.filter(a => a.type === 'group').length,
      projects: discoveredAreas.filter(a => a.type === 'project').length
    },
    stage: 'discovery',
    operationType: 'discovery',
    message: `Discovered ${discoveredAreas.length} areas`
  });
}
```

### 3. Data Collection with Resumability

```typescript
async function collectIssues(tracker: CrawlerProgressTracker, projectId: string, resumeFromId?: string) {
  let lastProcessedId = resumeFromId;
  let processedCount = 0;
  
  const issues = await getIssues(projectId, resumeFromId);
  const totalIssues = await getIssueCount(projectId);

  for (const issue of issues) {
    // Process the issue
    await processIssue(issue);
    processedCount++;
    lastProcessedId = issue.id;

    // Send progress update every 10 items
    if (processedCount % 10 === 0) {
      await tracker.sendUpdate({
        status: 'processing',
        processedItems: processedCount,
        totalItems: totalIssues,
        currentDataType: 'issues',
        lastProcessedId: lastProcessedId,
        itemsByType: {
          issues: processedCount
        },
        stage: 'data_collection',
        operationType: 'data_collection',
        message: `Processed ${processedCount}/${totalIssues} issues`
      });
    }
  }

  // Final update
  await tracker.sendUpdate({
    status: 'completed',
    processedItems: processedCount,
    totalItems: totalIssues,
    currentDataType: 'issues',
    lastProcessedId: lastProcessedId,
    itemsByType: {
      issues: processedCount
    },
    stage: 'finalization',
    message: `Completed processing ${processedCount} issues`
  });
}
```

### 4. Batch Progress Updates

```typescript
class BatchProgressTracker {
  private batchSize = 50;
  private currentBatch: Partial<ProgressUpdatePayload> = {};
  
  constructor(private tracker: CrawlerProgressTracker) {}

  addItems(type: string, count: number) {
    if (!this.currentBatch.itemsByType) {
      this.currentBatch.itemsByType = {};
    }
    this.currentBatch.itemsByType[type] = (this.currentBatch.itemsByType[type] || 0) + count;
  }

  updateProgress(processed: number, lastId?: string) {
    this.currentBatch.processedItems = processed;
    if (lastId) {
      this.currentBatch.lastProcessedId = lastId;
    }
  }

  async flush() {
    if (Object.keys(this.currentBatch).length > 0) {
      await this.tracker.sendUpdate({
        status: 'processing',
        ...this.currentBatch
      });
      this.currentBatch = {};
    }
  }
}
```

### 5. Error Handling and Recovery

```typescript
async function crawlWithRecovery(tracker: CrawlerProgressTracker) {
  try {
    await tracker.start();
    
    // Your crawling logic here
    await performCrawling(tracker);
    
    await tracker.complete();
  } catch (error) {
    console.error('Crawler error:', error);
    
    // Report the error
    await tracker.sendUpdate({
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      message: 'Crawler encountered an error'
    });
    
    // Optionally save resume state
    const resumeState = getCurrentProcessingState();
    await tracker.sendUpdate({
      status: 'paused',
      progress: resumeState,
      message: 'Crawler paused for recovery'
    });
    
    throw error;
  }
}
```

## Best Practices

### 1. Progress Update Frequency

**Recommended Update Intervals:**

- **High-frequency operations** (processing items): Every 10-50 items
- **Medium-frequency operations** (API calls): Every 5-10 API calls  
- **Low-frequency operations** (discovery): After each significant discovery
- **Time-based updates**: At least every 30-60 seconds for long-running operations

```typescript
// Example: Adaptive update frequency
class AdaptiveProgressTracker {
  private lastUpdate = Date.now();
  private itemsSinceLastUpdate = 0;
  private readonly MIN_UPDATE_INTERVAL = 30000; // 30 seconds
  private readonly ITEMS_UPDATE_THRESHOLD = 25;

  shouldSendUpdate(): boolean {
    const timeSinceUpdate = Date.now() - this.lastUpdate;
    return (
      this.itemsSinceLastUpdate >= this.ITEMS_UPDATE_THRESHOLD ||
      timeSinceUpdate >= this.MIN_UPDATE_INTERVAL
    );
  }

  async conditionalUpdate(tracker: CrawlerProgressTracker, update: Partial<ProgressUpdatePayload>) {
    this.itemsSinceLastUpdate++;
    
    if (this.shouldSendUpdate()) {
      await tracker.sendUpdate(update);
      this.lastUpdate = Date.now();
      this.itemsSinceLastUpdate = 0;
    }
  }
}
```

### 2. Resumability Implementation

Always include `lastProcessedId` for operations that can be resumed:

```typescript
interface CrawlerState {
  lastProcessedId?: string;
  lastProcessedType?: string;
  currentStage?: string;
  processedCounts?: Record<string, number>;
}

class ResumableCrawler {
  private state: CrawlerState = {};

  async saveCheckpoint(tracker: CrawlerProgressTracker) {
    await tracker.sendUpdate({
      status: 'processing',
      lastProcessedId: this.state.lastProcessedId,
      progress: this.state, // Save full state for resumability
      itemsByType: this.state.processedCounts,
      stage: this.state.currentStage
    });
  }

  async resumeFromState(state: CrawlerState) {
    this.state = { ...state };
    // Resume processing from lastProcessedId
  }
}
```

### 3. Error Handling Strategy

Implement comprehensive error handling with context preservation:

```typescript
async function handleCrawlerError(
  error: Error,
  tracker: CrawlerProgressTracker,
  context: {
    lastProcessedId?: string;
    currentOperation?: string;
    processedItems?: number;
  }
) {
  const errorInfo = {
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
    context
  };

  await tracker.sendUpdate({
    status: 'failed',
    error: errorInfo,
    lastProcessedId: context.lastProcessedId,
    processedItems: context.processedItems,
    message: `Error in ${context.currentOperation}: ${error.message}`
  });
}
```

### 4. Performance Considerations

- **Batch small updates**: Don't send progress updates for every single item
- **Use reasonable intervals**: Balance between visibility and performance
- **Include relevant data only**: Don't send unchanged data in every update
- **Handle network failures**: Implement retry logic for progress updates

```typescript
class PerformantProgressTracker {
  private pendingUpdate: Partial<ProgressUpdatePayload> = {};
  private updateTimer?: NodeJS.Timeout;
  private readonly UPDATE_DEBOUNCE_MS = 1000;

  queueUpdate(update: Partial<ProgressUpdatePayload>) {
    // Merge with pending update
    this.pendingUpdate = {
      ...this.pendingUpdate,
      ...update,
      itemsByType: {
        ...this.pendingUpdate.itemsByType,
        ...update.itemsByType
      }
    };

    // Debounce the actual update
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
    }
    
    this.updateTimer = setTimeout(() => {
      this.flushUpdate();
    }, this.UPDATE_DEBOUNCE_MS);
  }

  private async flushUpdate() {
    if (Object.keys(this.pendingUpdate).length > 0) {
      await this.sendUpdate(this.pendingUpdate);
      this.pendingUpdate = {};
    }
  }
}
```

## Error Handling

### Network Error Recovery

```typescript
async function sendProgressWithRetry(
  payload: ProgressUpdatePayload,
  maxRetries = 3,
  delayMs = 1000
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch('/api/internal/jobs/progress', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.CRAWLER_API_TOKEN}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.warn(`Progress update attempt ${attempt} failed:`, error);
      
      if (attempt === maxRetries) {
        console.error('All progress update attempts failed, continuing without progress tracking');
        throw error;
      }
      
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, delayMs * Math.pow(2, attempt - 1)));
    }
  }
}
```

### Validation and Error Prevention

```typescript
function validateProgressPayload(payload: ProgressUpdatePayload): string[] {
  const errors: string[] = [];

  if (!payload.taskId) errors.push('taskId is required');
  if (!payload.status) errors.push('status is required');
  if (!payload.timestamp) errors.push('timestamp is required');

  if (payload.processedItems !== undefined && payload.processedItems < 0) {
    errors.push('processedItems cannot be negative');
  }

  if (payload.totalItems !== undefined && payload.totalItems < 0) {
    errors.push('totalItems cannot be negative');
  }

  if (payload.processedItems !== undefined && payload.totalItems !== undefined) {
    if (payload.processedItems > payload.totalItems) {
      errors.push('processedItems cannot exceed totalItems');
    }
  }

  return errors;
}
```

## Testing and Debugging

### Progress Update Testing

```typescript
// Test helper for mocking progress updates
class MockProgressTracker {
  private updates: ProgressUpdatePayload[] = [];

  async sendUpdate(update: Partial<ProgressUpdatePayload>) {
    const fullUpdate: ProgressUpdatePayload = {
      taskId: 'test_job',
      status: 'processing',
      timestamp: new Date().toISOString(),
      ...update
    };
    
    this.updates.push(fullUpdate);
    console.log('Mock progress update:', fullUpdate);
    return { status: 'received' };
  }

  getUpdates() {
    return [...this.updates];
  }

  getLastUpdate() {
    return this.updates[this.updates.length - 1];
  }

  clear() {
    this.updates = [];
  }
}
```

### Debug Logging

```typescript
class DebuggingProgressTracker {
  constructor(
    private baseTracker: CrawlerProgressTracker,
    private enableDebug = process.env.NODE_ENV === 'development'
  ) {}

  async sendUpdate(update: Partial<ProgressUpdatePayload>) {
    if (this.enableDebug) {
      console.log('Progress Update Debug:', {
        timestamp: new Date().toISOString(),
        update,
        validationErrors: validateProgressPayload(update as ProgressUpdatePayload)
      });
    }

    return this.baseTracker.sendUpdate(update);
  }
}
```

### Integration Testing

```typescript
describe('Crawler Progress Integration', () => {
  let tracker: CrawlerProgressTracker;

  beforeEach(() => {
    tracker = new CrawlerProgressTracker('test_job_123', 'test_token');
  });

  it('should send basic progress update', async () => {
    const response = await tracker.sendUpdate({
      status: 'processing',
      processedItems: 50,
      totalItems: 100
    });

    expect(response.status).toBe('received');
  });

  it('should handle discovery updates', async () => {
    const response = await tracker.sendUpdate({
      status: 'new_areas_discovered',
      areas: [
        {
          type: 'group',
          name: 'Test Group',
          gitlabId: '123',
          fullPath: 'test-group',
          discoveredBy: 'test_crawler'
        }
      ]
    });

    expect(response.status).toBe('received');
  });

  it('should accumulate progress data', async () => {
    // Send first update
    await tracker.sendUpdate({
      status: 'processing',
      itemsByType: { groups: 5 }
    });

    // Send second update
    await tracker.sendUpdate({
      status: 'processing',
      itemsByType: { projects: 10 }
    });

    // Verify accumulation (would need to check database or API response)
  });
});
```

This guide provides comprehensive coverage of integrating with the enhanced progress tracking system. For additional information, see:

- [API Progress Endpoints Reference](./api-progress-endpoints.md)
- [Progress Types Reference](./progress-types-reference.md)
- [Migration Guide](./crawler-progress-migration.md)
- [System Overview](./PROGRESS_TRACKING_OVERVIEW.md)