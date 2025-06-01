# Crawler Integration Checklist

This checklist provides a comprehensive guide for implementing the enhanced progress tracking system in your crawler applications. Follow these steps to integrate with the new progress tracking features while maintaining backward compatibility.

## Table of Contents

1. [Pre-Integration Requirements](#pre-integration-requirements)
2. [Implementation Checklist](#implementation-checklist)
3. [Testing Requirements](#testing-requirements)
4. [Deployment Considerations](#deployment-considerations)
5. [Validation Steps](#validation-steps)
6. [Troubleshooting Guide](#troubleshooting-guide)

## Pre-Integration Requirements

### Required Dependencies

#### TypeScript Projects
```bash
# Ensure TypeScript 4.5+ for proper type support
npm install typescript@^4.5.0

# Required HTTP client (choose one)
npm install axios
# OR
npm install node-fetch
```

#### Node.js Version
- **Minimum**: Node.js 16.x
- **Recommended**: Node.js 18.x or 20.x
- **Compatibility**: ESM and CommonJS both supported

#### Environment Variables
```bash
# Required: API endpoint and authentication
CRAWLER_API_ENDPOINT=https://your-app.domain.com/api/internal2/tasks
CRAWLER_API_TOKEN=your_crawler_api_token

# Optional: Enhanced features configuration
ENHANCED_PROGRESS_TRACKING=true
PROGRESS_UPDATE_BATCH_SIZE=10
TIMELINE_EVENTS_ENABLED=true
```

### Environment Setup Considerations

#### Development Environment
- Set up test API endpoint pointing to development instance
- Configure logging level for enhanced debugging during integration
- Prepare test datasets for validation

#### Production Environment
- Validate API endpoint accessibility and authentication
- Configure appropriate retry policies and timeout values
- Set up monitoring and alerting for progress tracking failures

### Authentication Requirements

#### API Token Authentication
```typescript
// Required headers for all progress update requests
const headers = {
  'Authorization': `Bearer ${process.env.CRAWLER_API_TOKEN}`,
  'Content-Type': 'application/json'
};
```

#### Token Validation
- [ ] Verify token has proper permissions for progress updates
- [ ] Test token against development API endpoint
- [ ] Confirm token expiration and refresh policies

## Implementation Checklist

### Core Integration Tasks

#### [ ] 1. Update Crawler to Send Enhanced Progress Payloads

**Priority**: High  
**Effort**: 2-4 hours  
**Dependencies**: None  

**Implementation Steps**:
```typescript
// Before (Legacy)
const progressUpdate = {
  taskId: jobId,
  status: "processing",
  timestamp: new Date().toISOString(),
  processed: itemCount,
  total: totalItems,
  message: "Processing items..."
};

// After (Enhanced)
const progressUpdate = {
  taskId: jobId,
  status: "processing", 
  timestamp: new Date().toISOString(),
  processedItems: itemCount,           // Enhanced field
  totalItems: totalItems,              // Enhanced field
  currentDataType: "issues",           // NEW: Specify what's being processed
  stage: "data_collection",            // NEW: Processing stage
  operationType: "data_collection",    // NEW: Operation type
  message: "Processing issues..."
};
```

**Validation**:
- [ ] Legacy fields continue to work
- [ ] Enhanced fields provide additional context
- [ ] API accepts updated payload structure

#### [ ] 2. Implement `itemsByType` Tracking

**Priority**: High  
**Effort**: 3-6 hours  
**Dependencies**: Task 1 completed  

**Implementation Steps**:
```typescript
class ItemTypeTracker {
  private counts: Record<string, number> = {};
  
  addItems(type: string, count: number) {
    this.counts[type] = (this.counts[type] || 0) + count;
  }
  
  getCurrentCounts(): Record<string, number> {
    return { ...this.counts };
  }
  
  reset() {
    this.counts = {};
  }
}

// Usage in crawler
const tracker = new ItemTypeTracker();

// Track different item types as they're processed
await processIssues(issues); 
tracker.addItems('issues', issues.length);

await processMergeRequests(mrs);
tracker.addItems('mergeRequests', mrs.length);

// Send progress update with item breakdown
const progressUpdate = {
  // ... other fields
  itemsByType: tracker.getCurrentCounts(),
  // Result: { issues: 25, mergeRequests: 10 }
};
```

**Validation**:
- [ ] Item types accurately reflect processed data
- [ ] Counts accumulate correctly across updates
- [ ] Dashboard shows detailed breakdowns

#### [ ] 3. Add `stage` and `operationType` Fields

**Priority**: Medium  
**Effort**: 1-2 hours  
**Dependencies**: Task 1 completed  

**Implementation Steps**:
```typescript
// Define operation types for your crawler
type CrawlerOperationType = 'discovery' | 'branch_crawling' | 'data_collection' | 'finalization';

// Define stages for each operation type
const OPERATION_STAGES = {
  discovery: ['initializing', 'scanning_groups', 'scanning_projects', 'finalizing'],
  data_collection: ['preparing', 'fetching_issues', 'fetching_mrs', 'fetching_commits', 'completing'],
  branch_crawling: ['listing_branches', 'processing_commits', 'analyzing_history'],
  finalization: ['cleanup', 'indexing', 'verification', 'completion']
};

// Update progress with stage information
async function updateProgressWithStage(
  operation: CrawlerOperationType,
  currentStage: string,
  additionalData: any = {}
) {
  const progressUpdate = {
    taskId: jobId,
    status: "processing",
    timestamp: new Date().toISOString(),
    stage: currentStage,
    operationType: operation,
    ...additionalData
  };
  
  return sendProgressUpdate(progressUpdate);
}
```

**Validation**:
- [ ] Stage transitions are logical and sequential
- [ ] Operation types match actual crawler functionality
- [ ] Dashboard displays stage information clearly

#### [ ] 4. Implement `lastProcessedId` for Resumability

**Priority**: High  
**Effort**: 4-8 hours  
**Dependencies**: Tasks 1-3 completed  

**Implementation Steps**:
```typescript
class ResumableProcessor {
  private lastProcessedId: string | null = null;
  
  // Save resume state
  async saveResumeState(itemId: string, additionalState?: any) {
    this.lastProcessedId = itemId;
    
    const progressUpdate = {
      taskId: this.jobId,
      status: "processing",
      timestamp: new Date().toISOString(),
      lastProcessedId: itemId,
      // Include any additional state needed for resume
      progress: {
        resumeState: additionalState,
        savepoint: new Date().toISOString()
      }
    };
    
    return this.sendProgressUpdate(progressUpdate);
  }
  
  // Resume from saved state
  async resumeFromState(savedProgress: any): Promise<string | null> {
    const lastId = savedProgress.lastProcessedId;
    const resumeState = savedProgress.progress?.resumeState;
    
    if (lastId) {
      console.log(`Resuming from item: ${lastId}`);
      // Restore any additional state
      if (resumeState) {
        this.restoreState(resumeState);
      }
    }
    
    return lastId;
  }
  
  // Process items with resume support
  async processWithResume(items: any[], processor: (item: any) => Promise<void>) {
    for (const item of items) {
      await processor(item);
      
      // Save resume state periodically
      await this.saveResumeState(item.id, {
        processedCount: this.processedCount,
        currentBatch: this.currentBatch
      });
    }
  }
}
```

**Validation**:
- [ ] Resume functionality works after interruption
- [ ] No duplicate processing when resuming
- [ ] Resume state persists correctly

#### [ ] 5. Add Timeline Event Creation

**Priority**: Medium  
**Effort**: 2-3 hours  
**Dependencies**: Task 1 completed  

**Implementation Steps**:
```typescript
class TimelineEventManager {
  createEvent(
    eventType: 'progress_update' | 'stage_change' | 'error' | 'completion' | 'discovery_progress',
    details: Record<string, any>
  ) {
    return {
      timestamp: new Date().toISOString(),
      event: eventType,
      details
    };
  }
  
  async sendProgressWithTimeline(baseUpdate: any, event: any) {
    const progressUpdate = {
      ...baseUpdate,
      timeline: [event]
    };
    
    return this.sendProgressUpdate(progressUpdate);
  }
}

// Usage examples
const timeline = new TimelineEventManager();

// Stage change event
const stageChangeEvent = timeline.createEvent('stage_change', {
  fromStage: 'discovery',
  toStage: 'data_collection',
  operationType: 'data_collection',
  itemsDiscovered: 150
});

// Progress update event
const progressEvent = timeline.createEvent('progress_update', {
  processedItems: 100,
  currentDataType: 'issues',
  processingRate: '15 items/minute'
});

// Error event
const errorEvent = timeline.createEvent('error', {
  errorType: 'RateLimitError',
  errorMessage: 'GitLab API rate limit exceeded',
  retryAfter: 3600,
  context: { lastProcessedId: 'issue_100' }
});
```

**Validation**:
- [ ] Timeline events appear in dashboard
- [ ] Event details provide useful context
- [ ] Timeline maintains chronological order

#### [ ] 6. Update Error Handling to Include Context

**Priority**: High  
**Effort**: 3-5 hours  
**Dependencies**: Tasks 1, 5 completed  

**Implementation Steps**:
```typescript
class EnhancedErrorHandler {
  async handleError(error: any, context: {
    taskId: string;
    currentStage?: string;
    lastProcessedId?: string;
    operationType?: string;
    additionalContext?: any;
  }) {
    const errorEvent = {
      timestamp: new Date().toISOString(),
      event: 'error' as const,
      details: {
        errorType: error.name || 'UnknownError',
        errorMessage: error.message,
        stack: error.stack,
        context: {
          stage: context.currentStage,
          lastProcessedId: context.lastProcessedId,
          operationType: context.operationType,
          ...context.additionalContext
        },
        timestamp: new Date().toISOString()
      }
    };
    
    const progressUpdate = {
      taskId: context.taskId,
      status: "error",
      timestamp: new Date().toISOString(),
      error: error.message,
      errorTimestamp: new Date().toISOString(),
      timeline: [errorEvent],
      lastProcessedId: context.lastProcessedId,
      stage: context.currentStage
    };
    
    // Send error progress update
    try {
      await this.sendProgressUpdate(progressUpdate);
    } catch (updateError) {
      console.error('Failed to send error progress update:', updateError);
    }
    
    // Log locally as backup
    console.error('Crawler error with context:', {
      originalError: error,
      context,
      timestamp: new Date().toISOString()
    });
  }
}
```

**Validation**:
- [ ] Error context provides actionable debugging information
- [ ] Error timeline events are created correctly
- [ ] Dashboard shows enhanced error details

#### [ ] 7. Test Progress Accumulation Scenarios

**Priority**: High  
**Effort**: 4-6 hours  
**Dependencies**: Tasks 1-6 completed  

**Test Scenarios**:
```typescript
// Test 1: Basic accumulation
describe('Progress Accumulation', () => {
  it('should accumulate item counts correctly', async () => {
    // Send first update
    await sendProgressUpdate({
      taskId: 'test_job',
      itemsByType: { issues: 25, projects: 5 }
    });
    
    // Send second update  
    await sendProgressUpdate({
      taskId: 'test_job',
      itemsByType: { issues: 15, mergeRequests: 10 }
    });
    
    // Verify accumulation
    const job = await getJobProgress('test_job');
    expect(job.itemsByType.issues).toBe(40);      // 25 + 15
    expect(job.itemsByType.projects).toBe(5);     // unchanged
    expect(job.itemsByType.mergeRequests).toBe(10); // new
  });
});

// Test 2: Resume functionality
describe('Resume Functionality', () => {
  it('should resume from last processed ID', async () => {
    const processor = new ResumableProcessor('test_job');
    
    // Simulate interruption
    await processor.saveResumeState('item_50');
    
    // Simulate restart
    const savedProgress = await getJobProgress('test_job');
    const resumeFromId = await processor.resumeFromState(savedProgress);
    
    expect(resumeFromId).toBe('item_50');
  });
});
```

**Validation**:
- [ ] Multiple progress updates accumulate correctly
- [ ] Resume functionality works after interruption
- [ ] No data loss during accumulation

#### [ ] 8. Verify Real-time Dashboard Updates

**Priority**: Medium  
**Effort**: 2-3 hours  
**Dependencies**: Tasks 1-7 completed  

**Testing Steps**:
1. **Start Crawler Process**: Begin a crawler operation that sends enhanced progress updates
2. **Monitor Dashboard**: Verify real-time updates appear in admin dashboard
3. **Validate Data**: Confirm progress data matches what crawler is sending
4. **Test Timeline**: Verify timeline events appear chronologically
5. **Check Item Breakdown**: Ensure `itemsByType` data displays correctly

**Validation Checklist**:
- [ ] Dashboard updates in real-time (within 5 seconds)
- [ ] Progress percentages calculate correctly
- [ ] Item type breakdowns are accurate
- [ ] Timeline events display chronologically
- [ ] Stage transitions are visible
- [ ] Error information appears with context

## Testing Requirements

### Unit Testing

#### Progress Update Function Tests
```typescript
import { describe, it, expect } from 'vitest';

describe('Enhanced Progress Updates', () => {
  it('should format enhanced progress payload correctly', () => {
    const update = createEnhancedProgressUpdate({
      processedItems: 100,
      totalItems: 500,
      currentDataType: 'issues',
      itemsByType: { issues: 100 },
      stage: 'data_collection',
      operationType: 'data_collection'
    });
    
    expect(update).toMatchObject({
      processedItems: 100,
      totalItems: 500,
      currentDataType: 'issues',
      itemsByType: { issues: 100 },
      stage: 'data_collection',
      operationType: 'data_collection',
      timestamp: expect.any(String)
    });
  });
});
```

#### Timeline Event Tests
```typescript
describe('Timeline Events', () => {
  it('should create valid timeline events', () => {
    const event = createTimelineEvent('progress_update', {
      processedItems: 50,
      stage: 'data_collection'
    });
    
    expect(event).toMatchObject({
      timestamp: expect.any(String),
      event: 'progress_update',
      details: {
        processedItems: 50,
        stage: 'data_collection'
      }
    });
  });
});
```

### Integration Testing

#### API Endpoint Testing
```typescript
describe('Progress API Integration', () => {
  it('should accept enhanced progress updates', async () => {
    const response = await fetch('/api/internal2/tasks/test_job/progress', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'progress',
        processedItems: 100,
        totalItems: 500,
        itemsByType: { issues: 100 },
        stage: 'data_collection',
        operationType: 'data_collection',
        timestamp: new Date().toISOString()
      })
    });
    
    expect(response.status).toBe(200);
    
    const result = await response.json();
    expect(result.data.status).toBe('acknowledged');
  });
});
```

### Performance Testing

#### Progress Update Performance
- **Target**: < 100ms per progress update
- **Load**: Handle 10+ concurrent progress updates
- **Memory**: No memory leaks during extended operations
- **Network**: Efficient payload sizes (< 5KB per update)

#### Dashboard Performance
- **Real-time Updates**: < 5 second latency for progress changes
- **Data Rendering**: Handle 1000+ timeline events without performance degradation
- **Concurrent Users**: Support 10+ administrators viewing dashboard simultaneously

### Error Handling Testing

#### Network Failure Scenarios
```typescript
describe('Error Handling', () => {
  it('should handle network failures gracefully', async () => {
    // Simulate network failure
    mockNetworkFailure();
    
    const result = await sendProgressUpdateWithRetry({
      taskId: 'test_job',
      status: 'processing'
    });
    
    // Should retry and eventually succeed
    expect(result.success).toBe(true);
    expect(result.attempts).toBeGreaterThan(1);
  });
});
```

#### API Error Response Testing
- Test handling of 401 (authentication failure)
- Test handling of 404 (task not found)
- Test handling of 500 (server error)
- Test retry logic and backoff strategies

## Deployment Considerations

### Pre-Deployment Checklist

#### Environment Configuration
- [ ] API endpoints configured correctly for target environment
- [ ] Authentication tokens generated and distributed securely
- [ ] Environment variables set appropriately
- [ ] Logging configuration optimized for production

#### Code Review Requirements
- [ ] Enhanced progress tracking implementation reviewed
- [ ] Error handling and retry logic validated
- [ ] Performance impact assessed
- [ ] Security considerations reviewed (token handling, data exposure)

#### Testing Validation
- [ ] All integration tests passing
- [ ] Performance tests meet requirements
- [ ] Error handling scenarios validated
- [ ] Dashboard functionality verified in target environment

### Rollback Plan

#### Immediate Rollback (If Issues Arise)
```typescript
// Emergency rollback to legacy mode
const ROLLBACK_TO_LEGACY = process.env.ROLLBACK_TO_LEGACY === 'true';

function sendProgressUpdate(update: any) {
  if (ROLLBACK_TO_LEGACY) {
    // Use only legacy fields
    return sendLegacyProgressUpdate({
      taskId: update.taskId,
      status: update.status,
      timestamp: update.timestamp,
      processed: update.processedItems || update.processed,
      total: update.totalItems || update.total,
      message: update.message
    });
  } else {
    // Use enhanced progress tracking
    return sendEnhancedProgressUpdate(update);
  }
}
```

#### Rollback Triggers
- Progress updates failing at > 5% rate
- Dashboard not displaying updates within 10 seconds
- Crawler performance degradation > 20%
- Memory leaks or resource exhaustion detected

#### Rollback Procedure
1. **Set Environment Variable**: `ROLLBACK_TO_LEGACY=true`
2. **Restart Crawler Processes**: Deploy with rollback configuration
3. **Monitor Legacy Mode**: Verify crawler functionality restored
4. **Investigate Issues**: Analyze logs and performance metrics
5. **Plan Re-deployment**: Address issues and schedule re-deployment

### Monitoring and Alerting Setup

#### Key Metrics to Monitor
- **Progress Update Success Rate**: Should be > 99%
- **Progress Update Latency**: Should be < 100ms p95
- **Dashboard Update Latency**: Should be < 5 seconds
- **Crawler Processing Rate**: Baseline established pre-deployment
- **Error Rate**: Should be < 1% of total operations

#### Alerting Configuration
```yaml
# Example alerting rules
alerts:
  - name: ProgressUpdateFailureRate
    condition: progress_update_failure_rate > 0.05
    duration: 5m
    action: notify_on_call_engineer
    
  - name: DashboardUpdateDelay
    condition: dashboard_update_latency_p95 > 10s
    duration: 2m
    action: notify_platform_team
    
  - name: CrawlerPerformanceDegradation
    condition: crawler_processing_rate < baseline * 0.8
    duration: 10m
    action: investigate_performance
```

### Performance Baseline Establishment

#### Pre-Deployment Measurements
- [ ] Crawler processing rate (items/hour)
- [ ] Memory usage patterns
- [ ] CPU utilization during operations
- [ ] Network bandwidth usage
- [ ] Database query performance

#### Post-Deployment Monitoring
- [ ] Compare processing rates before/after enhancement
- [ ] Monitor memory usage for leaks or increases
- [ ] Track API response times and error rates
- [ ] Validate dashboard performance under load

## Validation Steps

After completing the implementation checklist, follow these validation steps to ensure the enhanced progress tracking system is working correctly:

### 1. Basic Functionality Validation
- [ ] Crawler starts and sends initial progress update
- [ ] Dashboard displays progress information
- [ ] Progress updates accumulate correctly
- [ ] Timeline events are created and displayed

### 2. Enhanced Features Validation
- [ ] Item type breakdown displays in dashboard
- [ ] Stage transitions work and are visible
- [ ] Resume functionality works after interruption
- [ ] Error handling provides detailed context

### 3. Performance Validation
- [ ] Progress updates don't slow down crawler operations
- [ ] Dashboard remains responsive with active crawlers
- [ ] Memory usage remains stable during long operations
- [ ] Network usage is reasonable (< 5KB per update)

### 4. Integration Validation
- [ ] Multiple crawlers can send updates simultaneously
- [ ] Dashboard handles multiple concurrent operations
- [ ] API handles load without errors
- [ ] Database performance remains stable

## Troubleshooting Guide

### Common Issues and Solutions

#### Issue: Progress Updates Not Appearing in Dashboard
**Symptoms**: Crawler sends updates but dashboard doesn't show changes

**Debugging Steps**:
1. Check API response status codes
2. Verify authentication token is valid
3. Check browser console for SSE connection errors
4. Validate progress update payload format

**Solutions**:
```typescript
// Add debug logging to progress updates
async function sendProgressUpdateWithDebug(update: any) {
  console.log('Sending progress update:', JSON.stringify(update, null, 2));
  
  try {
    const response = await sendProgressUpdate(update);
    console.log('Progress update response:', response);
    return response;
  } catch (error) {
    console.error('Progress update failed:', error);
    throw error;
  }
}
```

#### Issue: Progress Data Not Accumulating Correctly
**Symptoms**: Item counts reset instead of accumulating

**Debugging Steps**:
1. Verify using enhanced fields (`processedItems`, `itemsByType`)
2. Check for overwrites instead of accumulation
3. Validate API endpoint is using enhanced merging logic

**Solutions**:
```typescript
// Ensure proper accumulation by sending incremental updates
let totalProcessed = 0;
const itemCounts = { issues: 0, mergeRequests: 0 };

// Instead of sending total counts
const badUpdate = {
  processedItems: totalProcessed, // This works correctly
  itemsByType: itemCounts        // This resets if sent as totals
};

// Send incremental counts for itemsByType
const goodUpdate = {
  processedItems: totalProcessed,
  itemsByType: { issues: 5 }      // Increment of 5 issues processed
};
```

#### Issue: Resume Functionality Not Working
**Symptoms**: Crawler restarts from beginning instead of resuming

**Debugging Steps**:
1. Verify `lastProcessedId` is being saved correctly
2. Check resume state retrieval logic
3. Validate API preserves `lastProcessedId` field

**Solutions**:
```typescript
// Add resume state validation
async function resumeWithValidation(savedProgress: any) {
  const lastId = savedProgress.lastProcessedId;
  
  if (!lastId) {
    console.warn('No resume state found, starting from beginning');
    return null;
  }
  
  // Validate the resume ID exists in your data source
  const itemExists = await validateItemExists(lastId);
  if (!itemExists) {
    console.warn(`Resume ID ${lastId} not found, starting from beginning`);
    return null;
  }
  
  console.log(`Successfully resuming from ${lastId}`);
  return lastId;
}
```

#### Issue: Dashboard Performance Degradation
**Symptoms**: Dashboard becomes slow with large amounts of progress data

**Debugging Steps**:
1. Check timeline event count (should be < 1000 per job)
2. Monitor browser memory usage
3. Validate SSE connection efficiency

**Solutions**:
```typescript
// Implement timeline event pruning
const MAX_TIMELINE_EVENTS = 100;

function pruneTimelineEvents(timeline: any[]): any[] {
  if (timeline.length <= MAX_TIMELINE_EVENTS) {
    return timeline;
  }
  
  // Keep recent events and important milestones
  const recent = timeline.slice(-50);
  const milestones = timeline.filter(event => 
    ['stage_change', 'error', 'completion'].includes(event.event)
  ).slice(-25);
  
  return [...milestones, ...recent].slice(-MAX_TIMELINE_EVENTS);
}
```

### Debug Logging Configuration

```typescript
// Enhanced debug logging for troubleshooting
const DEBUG_PROGRESS = process.env.DEBUG_PROGRESS === 'true';

class DebugProgressTracker {
  async sendProgressUpdate(update: any) {
    if (DEBUG_PROGRESS) {
      console.log('=== Progress Update Debug ===');
      console.log('Timestamp:', new Date().toISOString());
      console.log('Update payload:', JSON.stringify(update, null, 2));
      console.log('Payload size:', JSON.stringify(update).length, 'bytes');
    }
    
    const startTime = Date.now();
    
    try {
      const response = await this.doSendProgressUpdate(update);
      
      if (DEBUG_PROGRESS) {
        console.log('Response time:', Date.now() - startTime, 'ms');
        console.log('Response status:', response.status);
        console.log('=== End Progress Update Debug ===');
      }
      
      return response;
    } catch (error) {
      if (DEBUG_PROGRESS) {
        console.error('Progress update error:', error);
        console.log('Error time:', Date.now() - startTime, 'ms');
        console.log('=== End Progress Update Debug (ERROR) ===');
      }
      throw error;
    }
  }
}
```

### Performance Optimization Tips

#### Batch Progress Updates
```typescript
// Instead of sending updates for every item
for (const item of items) {
  await processItem(item);
  await sendProgressUpdate(/* ... */); // Too frequent
}

// Batch updates for better performance
let processedCount = 0;
const BATCH_SIZE = 10;

for (const item of items) {
  await processItem(item);
  processedCount++;
  
  if (processedCount % BATCH_SIZE === 0) {
    await sendProgressUpdate({
      processedItems: processedCount,
      itemsByType: { [item.type]: BATCH_SIZE }
    });
  }
}
```

#### Efficient Timeline Management
```typescript
// Minimize timeline event creation
const shouldCreateTimelineEvent = (eventType: string, context: any): boolean => {
  // Only create timeline events for significant milestones
  if (eventType === 'stage_change') return true;
  if (eventType === 'error') return true;
  if (eventType === 'completion') return true;
  
  // For progress updates, only create events periodically
  if (eventType === 'progress_update') {
    return context.processedItems % 100 === 0; // Every 100 items
  }
  
  return false;
};
```

---

**Next Step**: Begin implementation starting with Task 1 (Enhanced Progress Payloads) and proceed through the checklist systematically. Each task builds on the previous ones, so complete them in order for the smoothest integration experience.

**Support**: Refer to the [Progress Types Reference](./progress-types-reference.md) and [Migration Guide](./crawler-progress-migration.md) for detailed implementation guidance.