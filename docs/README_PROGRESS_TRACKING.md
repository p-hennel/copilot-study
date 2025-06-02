# Enhanced Progress Tracking System

A comprehensive progress tracking enhancement for web crawler applications, providing intelligent data accumulation, detailed item type tracking, timeline events, and enhanced administrative visibility.

## 🚀 Quick Start Guide

### For Administrators

**View Enhanced Progress Dashboard**
1. Navigate to `/admin/crawler` in your web application
2. Monitor real-time progress with detailed breakdowns
3. View timeline events and stage transitions
4. Access comprehensive error information with context

**Key Dashboard Features**
- **Real-time Updates**: Live progress monitoring with sub-5-second updates
- **Item Type Breakdown**: Detailed tracking of groups, projects, issues, merge requests, commits, etc.
- **Timeline Events**: Complete audit trail of all operations and milestones
- **Progress Visualization**: Percentage completion with visual progress bars
- **Error Context**: Enhanced error reporting with actionable debugging information

### For Developers

**Basic Integration (5 minutes)**
```typescript
import { EnhancedProgressTracker } from './enhanced-progress-tracker';

// Create tracker instance
const tracker = new EnhancedProgressTracker({
  apiEndpoint: 'https://your-app.com/api/internal2/tasks',
  apiToken: process.env.CRAWLER_API_TOKEN,
  taskId: 'your_job_id'
});

// Send enhanced progress updates
await tracker.updateProgress({
  processedItems: 150,
  totalItems: 500,
  currentDataType: 'issues',
  itemsByType: { issues: 25 },
  stage: 'data_collection',
  operationType: 'data_collection',
  message: 'Processing GitLab issues...'
});
```

**Legacy Compatibility (0 minutes)**
```typescript
// Existing legacy code continues to work without changes
const progressUpdate = {
  taskId: jobId,
  status: "processing",
  timestamp: new Date().toISOString(),
  processed: 150,        // Automatically mapped to processedItems
  total: 500,           // Automatically mapped to totalItems
  message: "Processing items..."
};

// No code changes needed - backend handles enhancement automatically
await sendProgressUpdate(progressUpdate);
```

## 📚 Documentation Overview

### Essential Reading
- **[Integration Checklist](docs/CRAWLER_INTEGRATION_CHECKLIST.md)** - Step-by-step implementation guide
- **[Implementation Examples](docs/crawler-implementation-examples.md)** - Real-world code templates
- **[Migration Guide](docs/crawler-progress-migration.md)** - Upgrade from legacy system
- **[Types Reference](docs/progress-types-reference.md)** - Complete TypeScript documentation

### Quick Reference Links
- [API Endpoints](#api-endpoints) - Enhanced progress tracking endpoints
- [Data Structures](#data-structures) - Progress payload formats
- [Common Patterns](#common-integration-patterns) - Frequently used implementations
- [Troubleshooting](#troubleshooting) - Common issues and solutions

## 🛠️ For Developers

### Installation and Setup

#### Prerequisites
- Node.js 16+ or Python 3.8+
- Valid API token for progress tracking endpoints
- Access to enhanced progress tracking API

#### Environment Configuration
```bash
# Required environment variables
CRAWLER_API_ENDPOINT=https://your-app.com/api/internal2/tasks
CRAWLER_API_TOKEN=your_crawler_api_token

# Optional: Enhanced features
ENHANCED_PROGRESS_TRACKING=true
PROGRESS_UPDATE_BATCH_SIZE=10
TIMELINE_EVENTS_ENABLED=true
```

### Quick Integration Patterns

#### Pattern 1: Basic Enhanced Tracking
```typescript
class BasicCrawler {
  private tracker: EnhancedProgressTracker;
  
  constructor(jobId: string) {
    this.tracker = new EnhancedProgressTracker({
      apiEndpoint: process.env.CRAWLER_API_ENDPOINT!,
      apiToken: process.env.CRAWLER_API_TOKEN!,
      taskId: jobId
    });
  }
  
  async processItems(items: any[]) {
    await this.tracker.changeStage('data_collection', 'data_collection');
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      await this.processItem(item);
      
      // Update progress every 10 items
      if ((i + 1) % 10 === 0) {
        await this.tracker.updateProgress({
          processedItems: i + 1,
          totalItems: items.length,
          currentDataType: 'issues',
          itemsByType: { issues: 1 }, // Increment by 1 for accumulation
          lastProcessedId: item.id,
          message: `Processed ${i + 1}/${items.length} issues`
        });
      }
    }
    
    await this.tracker.markCompleted({
      total_processed: items.length,
      summary: `Successfully processed ${items.length} items`
    });
  }
}
```

#### Pattern 2: Resumable Operations
```typescript
class ResumableCrawler extends BasicCrawler {
  async processWithResume(items: any[], resumeFromId?: string) {
    // Find resume point
    let startIndex = 0;
    if (resumeFromId) {
      startIndex = items.findIndex(item => item.id === resumeFromId);
      if (startIndex !== -1) {
        startIndex++; // Start after last processed
        console.log(`Resuming from item ${resumeFromId}`);
      }
    }
    
    // Process remaining items
    for (let i = startIndex; i < items.length; i++) {
      const item = items[i];
      await this.processItem(item);
      
      // Save checkpoint every 50 items
      if ((i + 1) % 50 === 0) {
        await this.tracker.saveResumeState(item.id, {
          processedCount: i + 1,
          timestamp: new Date().toISOString()
        });
      }
    }
  }
}
```

#### Pattern 3: Error Handling with Context
```typescript
class RobustCrawler extends ResumableCrawler {
  async processWithErrorHandling(items: any[]) {
    try {
      await this.processWithResume(items);
    } catch (error) {
      await this.tracker.reportError(error as Error, {
        stage: 'data_collection',
        lastProcessedId: this.getLastProcessedId(),
        operationType: 'data_collection',
        additionalContext: {
          totalItems: items.length,
          errorLocation: 'processWithResume',
          itemsRemaining: items.length - this.getProcessedCount()
        }
      });
      throw error;
    }
  }
}
```

### API Endpoints

#### Enhanced Progress Update
```http
POST /api/internal2/tasks/{taskId}/progress
Authorization: Bearer {your_api_token}
Content-Type: application/json

{
  "type": "progress",
  "processedItems": 150,
  "totalItems": 500,
  "currentDataType": "issues",
  "itemsByType": {
    "issues": 25,
    "mergeRequests": 10
  },
  "lastProcessedId": "issue_150",
  "stage": "data_collection",
  "operationType": "data_collection",
  "message": "Processing GitLab issues...",
  "timestamp": "2025-01-06T19:15:30.000Z"
}
```

#### Response Format
```json
{
  "data": {
    "taskId": "job_123",
    "status": "acknowledged",
    "message": "Progress update processed for task job_123",
    "timestamp": "2025-01-06T19:15:30.000Z",
    "currentStatus": "running",
    "progress": {
      "processed": 150,
      "total": 500,
      "percentage": 30,
      "currentStep": "data_collection",
      "message": "Processing GitLab issues..."
    }
  }
}
```

### Data Structures

#### Core Progress Data
```typescript
interface CrawlerProgressData {
  // Enhanced tracking
  processedItems?: number;      // Items processed so far
  totalItems?: number;          // Total items to process
  currentDataType?: string;     // Type being processed (e.g., "issues")
  
  // Detailed breakdown
  itemsByType?: {
    groups?: number;
    projects?: number;
    issues?: number;
    mergeRequests?: number;
    commits?: number;
    [key: string]: number | undefined;
  };
  
  // Resumability
  lastProcessedId?: string;     // Last processed item ID
  
  // Operation context
  stage?: string;               // Current stage (e.g., "data_collection")
  operationType?: 'discovery' | 'branch_crawling' | 'data_collection' | 'finalization';
  
  // Audit trail
  timeline?: ProgressTimelineEvent[];
  
  // Legacy compatibility
  processed?: number;           // Maps to processedItems
  total?: number;              // Maps to totalItems
}
```

#### Timeline Events
```typescript
interface ProgressTimelineEvent {
  timestamp: string;
  event: 'progress_update' | 'stage_change' | 'error' | 'completion' | 'discovery_progress';
  details: {
    [key: string]: any;
  };
}
```

### Common Integration Patterns

#### Batch Processing with Progress Updates
```typescript
async function processBatch<T>(
  items: T[],
  processor: (item: T) => Promise<void>,
  tracker: EnhancedProgressTracker,
  batchSize = 10
) {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    
    // Process batch
    await Promise.all(batch.map(processor));
    
    // Update progress
    await tracker.updateProgress({
      processedItems: Math.min(i + batchSize, items.length),
      totalItems: items.length,
      itemsByType: { [getItemType(batch[0])]: batch.length },
      lastProcessedId: batch[batch.length - 1].id
    });
  }
}
```

#### Discovery Operations
```typescript
async function performDiscovery(tracker: EnhancedProgressTracker) {
  await tracker.changeStage('discovery', 'discovery');
  
  const discoveredAreas = [];
  const itemCounts = { groups: 0, projects: 0 };
  
  for await (const area of discoverAreas()) {
    discoveredAreas.push(area);
    itemCounts[area.type]++;
    
    if (discoveredAreas.length % 5 === 0) {
      await tracker.updateProgress({
        processedItems: discoveredAreas.length,
        currentDataType: 'areas',
        itemsByType: { [area.type]: 1 },
        stage: 'discovery',
        operationType: 'discovery',
        message: `Discovered ${discoveredAreas.length} areas`
      });
    }
  }
  
  return discoveredAreas;
}
```

#### Error Recovery Pattern
```typescript
async function processWithRecovery<T>(
  items: T[],
  processor: (item: T) => Promise<void>,
  tracker: EnhancedProgressTracker
) {
  let processedCount = 0;
  
  for (const item of items) {
    try {
      await processor(item);
      processedCount++;
      
      // Regular progress update
      if (processedCount % 10 === 0) {
        await tracker.saveResumeState(item.id);
      }
      
    } catch (error) {
      // Report error but continue processing
      await tracker.reportError(error as Error, {
        lastProcessedId: item.id,
        additionalContext: { 
          itemType: typeof item,
          processedCount,
          totalItems: items.length
        }
      });
      
      // Continue with next item
      continue;
    }
  }
}
```

### Troubleshooting

#### Common Issue: Progress Not Updating in Dashboard
**Symptoms**: Crawler sends updates but dashboard doesn't show changes

**Solution**:
```typescript
// 1. Verify API response
async function debugProgressUpdate(update: any) {
  try {
    const response = await sendProgressUpdate(update);
    console.log('API Response:', response.status, response.data);
  } catch (error) {
    console.error('API Error:', error.response?.status, error.response?.data);
  }
}

// 2. Check authentication
const headers = {
  'Authorization': `Bearer ${process.env.CRAWLER_API_TOKEN}`,
  'Content-Type': 'application/json'
};

// 3. Validate payload format
const validPayload = {
  type: 'progress',  // Required field
  taskId: 'job_123', // Required field
  timestamp: new Date().toISOString(), // Required field
  // ... other fields
};
```

#### Common Issue: Data Not Accumulating Correctly
**Solution**:
```typescript
// Use incremental updates for itemsByType
const goodUpdate = {
  itemsByType: { issues: 5 }  // Increment of 5 issues processed
};

// Avoid sending total counts
const badUpdate = {
  itemsByType: { issues: 150 } // This resets the count to 150
};
```

#### Common Issue: Resume Not Working
**Solution**:
```typescript
// Always save and validate resume state
async function saveCheckpoint(itemId: string) {
  await tracker.saveResumeState(itemId, {
    timestamp: new Date().toISOString(),
    processedCount: currentCount,
    additionalState: { /* any needed state */ }
  });
}

// Validate resume ID exists before using
async function resume(savedProgress: any) {
  const resumeId = savedProgress.lastProcessedId;
  if (resumeId && await validateItemExists(resumeId)) {
    return resumeId;
  }
  return null; // Start from beginning
}
```

## 📊 For Administrators

### Enhanced Dashboard Features

#### Real-time Progress Monitoring
- **Live Updates**: Progress changes appear within 5 seconds
- **Multiple Jobs**: Monitor multiple crawler operations simultaneously
- **Historical Data**: View progress history and timeline events

#### Detailed Progress Breakdowns
- **Item Type Visualization**: See exactly what data types are being processed
- **Stage Tracking**: Monitor current processing stage and transitions
- **Performance Metrics**: View processing rates and estimated completion times

#### Error Tracking and Debugging
- **Contextual Errors**: Detailed error information with processing context
- **Timeline Events**: Complete audit trail of all operations
- **Recovery Guidance**: Actionable steps for resolving issues

### Monitoring Best Practices

#### Key Metrics to Watch
- **Progress Update Success Rate**: Should be > 99%
- **Processing Rate**: Items processed per minute/hour
- **Error Rate**: Should be < 1% of total operations
- **Stage Transition Times**: Monitor for bottlenecks

#### Performance Indicators
- **Dashboard Responsiveness**: Updates should appear within 5 seconds
- **Memory Usage**: Monitor for memory leaks during long operations
- **API Response Times**: Progress updates should complete in < 100ms

### Administrative Actions

#### Managing Crawler Operations
```bash
# View active crawler jobs
GET /admin/crawler

# Check specific job progress
GET /api/internal2/tasks/{taskId}/progress

# Monitor system health
GET /admin/system/health
```

#### Troubleshooting Operations
1. **Check API Connectivity**: Verify crawler can reach progress endpoints
2. **Validate Authentication**: Ensure API tokens are valid and properly configured
3. **Monitor Resource Usage**: Check system resources during crawler operations
4. **Review Error Logs**: Examine timeline events for error patterns

### System Health Monitoring

#### Automated Alerts
Set up monitoring for:
- Progress update failure rates > 5%
- Dashboard update delays > 10 seconds
- Crawler performance degradation > 20%
- Memory usage increases > 50% from baseline

#### Performance Baselines
Establish baselines for:
- Items processed per hour by data type
- Memory usage during typical operations
- API response times for progress updates
- Dashboard rendering performance

## 🔧 Advanced Configuration

### Performance Tuning

#### Batch Size Optimization
```typescript
// Adjust batch size based on item processing time
const BATCH_SIZES = {
  issues: 10,      // Complex processing
  commits: 50,     // Simple processing
  branches: 25     // Medium processing
};
```

#### Timeline Event Management
```typescript
// Configure timeline event creation
const timelineConfig = {
  maxEvents: 100,           // Limit timeline size
  criticalEventsOnly: false, // All events vs critical only
  flushInterval: 10000      // Batch timeline updates
};
```

### Security Configuration

#### API Token Management
```bash
# Rotate API tokens regularly
CRAWLER_API_TOKEN=new_token_here

# Use environment-specific tokens
CRAWLER_API_TOKEN_DEV=dev_token
CRAWLER_API_TOKEN_PROD=prod_token
```

#### Network Security
- Use HTTPS for all API communications
- Implement proper token validation
- Configure rate limiting on progress endpoints
- Monitor for suspicious API usage patterns

---

## 🎯 Next Steps

### For New Implementations
1. **Start with Legacy Mode**: Begin with existing progress tracking code
2. **Add Basic Enhancement**: Gradually add `processedItems`, `stage`, `operationType` fields
3. **Implement Item Tracking**: Add detailed `itemsByType` breakdown
4. **Enable Resumability**: Implement `lastProcessedId` tracking
5. **Full Enhancement**: Complete migration to all enhanced features

### For Existing Crawlers
1. **Review Integration Checklist**: Follow [CRAWLER_INTEGRATION_CHECKLIST.md](docs/CRAWLER_INTEGRATION_CHECKLIST.md)
2. **Choose Migration Strategy**: Select appropriate migration approach from [Migration Guide](docs/crawler-progress-migration.md)
3. **Implement Gradually**: Use phase-by-phase enhancement approach
4. **Validate and Test**: Follow validation procedures in documentation

### Support and Resources
- **Technical Documentation**: Complete guides in `/docs` directory
- **Code Examples**: Real-world implementation patterns
- **Migration Support**: Backward-compatible transition path
- **Performance Monitoring**: Enhanced dashboard for operational visibility

**Ready to enhance your crawler progress tracking?** Start with the [Integration Checklist](docs/CRAWLER_INTEGRATION_CHECKLIST.md) for step-by-step implementation guidance.