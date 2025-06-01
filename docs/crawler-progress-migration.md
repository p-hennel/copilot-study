# Crawler Progress Migration Guide

This guide helps you migrate existing crawler implementations from the legacy progress tracking system to the enhanced progress tracking system with intelligent data accumulation and detailed timeline tracking.

## Table of Contents

1. [Migration Overview](#migration-overview)
2. [Backward Compatibility](#backward-compatibility)
3. [Field Mapping](#field-mapping)
4. [Migration Strategies](#migration-strategies)
5. [Code Examples](#code-examples)
6. [Testing Migration](#testing-migration)
7. [Rollback Plan](#rollback-plan)

## Migration Overview

### What's Changing

The enhanced progress tracking system introduces:

- **Intelligent Data Accumulation**: Progress data accumulates instead of being overwritten
- **Detailed Item Type Tracking**: Track specific types of items processed
- **Timeline Events**: Complete audit trail of all progress events
- **Enhanced Resumability**: Better support for pausing and resuming operations
- **Structured Error Handling**: More detailed error tracking with context

### What Stays the Same

- **API Endpoint**: Same `/api/internal/jobs/progress` endpoint
- **Authentication**: Same Bearer token authentication
- **Basic Fields**: Core fields like `taskId`, `status`, `timestamp` unchanged
- **Legacy Field Support**: All existing fields continue to work

### Migration Benefits

- **No Breaking Changes**: Existing crawlers continue working without modification
- **Gradual Enhancement**: Add new features incrementally
- **Better Debugging**: Enhanced logging and timeline tracking
- **Improved Reliability**: Intelligent accumulation prevents data loss

## Backward Compatibility

### Legacy Field Support

The system maintains full backward compatibility with these legacy fields:

```typescript
interface LegacyProgressFields {
  processed?: number;        // Maps to processedItems
  total?: number;           // Maps to totalItems
  groupCount?: number;      // Legacy field for GROUP_PROJECT_DISCOVERY
  projectCount?: number;    // Legacy field for GROUP_PROJECT_DISCOVERY
  groupTotal?: number;      // Legacy total count for groups
  projectTotal?: number;    // Legacy total count for projects
}
```

### Automatic Field Mapping

The system automatically maps legacy fields to new fields:

```typescript
// Legacy update still works
const legacyUpdate = {
  taskId: "job_123",
  status: "processing",
  timestamp: "2025-01-06T19:15:30.000Z",
  processed: 50,        // Automatically mapped to processedItems
  total: 100           // Automatically mapped to totalItems
};

// Internally converted to enhanced format
const enhancedUpdate = {
  taskId: "job_123",
  status: "processing", 
  timestamp: "2025-01-06T19:15:30.000Z",
  processedItems: 50,   // Mapped from processed
  totalItems: 100      // Mapped from total
};
```

## Field Mapping

### Basic Progress Fields

| Legacy Field | New Field | Notes |
|-------------|-----------|-------|
| `processed` | `processedItems` | Direct mapping, both supported |
| `total` | `totalItems` | Direct mapping, both supported |
| `message` | `message` | Unchanged |
| `error` | `error` | Enhanced with structured error support |

### Discovery-Specific Fields

| Legacy Field | New Field | Notes |
|-------------|-----------|-------|
| `groupCount` | `itemsByType.groups` | Enhanced with accumulation |
| `projectCount` | `itemsByType.projects` | Enhanced with accumulation |
| `groupTotal` | `totalItems` (context-dependent) | Used when processing groups |
| `projectTotal` | `totalItems` (context-dependent) | Used when processing projects |

### New Enhanced Fields

These fields are new and have no legacy equivalent:

| New Field | Purpose | Migration Strategy |
|-----------|---------|------------------|
| `itemsByType` | Detailed type breakdown | Add incrementally to new operations |
| `lastProcessedId` | Resumability support | Add when implementing resume functionality |
| `stage` | Processing stage tracking | Add to provide operational visibility |
| `operationType` | Operation categorization | Add to categorize different crawler operations |
| `timeline` | Audit trail | Automatically generated, no action needed |

## Migration Strategies

### Strategy 1: No-Change Migration (Immediate)

Keep existing crawler code unchanged and benefit from enhanced backend processing:

**Pros:**
- Zero code changes required
- Immediate benefit from data accumulation
- Enhanced logging and debugging

**Cons:**
- Miss out on new features
- No detailed item type tracking
- No resumability improvements

**Implementation:**
```typescript
// Existing code continues to work exactly as before
const progressUpdate = {
  taskId: jobId,
  status: "processing",
  timestamp: new Date().toISOString(),
  processed: itemCount,
  total: totalItems,
  message: "Processing items..."
};

// No changes needed - backend handles enhancement automatically
await sendProgressUpdate(progressUpdate);
```

### Strategy 2: Gradual Enhancement (Recommended)

Incrementally add enhanced fields to improve functionality:

**Phase 1: Add Basic Enhanced Fields**
```typescript
const progressUpdate = {
  taskId: jobId,
  status: "processing",
  timestamp: new Date().toISOString(),
  
  // Legacy fields (keep for compatibility)
  processed: itemCount,
  total: totalItems,
  
  // New enhanced fields (add gradually)
  processedItems: itemCount,      // Explicit new field
  totalItems: totalItems,         // Explicit new field
  currentDataType: "issues",      // Add data type tracking
  stage: "data_collection",       // Add stage tracking
  operationType: "data_collection" // Add operation type
};
```

**Phase 2: Add Item Type Tracking**
```typescript
const progressUpdate = {
  taskId: jobId,
  status: "processing",
  timestamp: new Date().toISOString(),
  processedItems: itemCount,
  totalItems: totalItems,
  currentDataType: "issues",
  
  // Add detailed item type breakdown
  itemsByType: {
    issues: issueCount,
    mergeRequests: mrCount,
    commits: commitCount
  },
  
  stage: "data_collection",
  operationType: "data_collection"
};
```

**Phase 3: Add Resumability**
```typescript
const progressUpdate = {
  taskId: jobId,
  status: "processing",
  timestamp: new Date().toISOString(),
  processedItems: itemCount,
  totalItems: totalItems,
  currentDataType: "issues",
  itemsByType: {
    issues: issueCount,
    mergeRequests: mrCount
  },
  
  // Add resumability support
  lastProcessedId: lastItemId,    // Enable resume functionality
  
  stage: "data_collection",
  operationType: "data_collection"
};
```

### Strategy 3: Full Migration (Advanced)

Complete rewrite to take advantage of all enhanced features:

**Benefits:**
- Full feature utilization
- Best performance and reliability
- Enhanced debugging capabilities
- Future-proof implementation

**Implementation:**
```typescript
class EnhancedProgressTracker {
  private itemCounts: Record<string, number> = {};
  
  async sendEnhancedUpdate(
    status: string,
    updates: {
      processedItems?: number;
      totalItems?: number;
      currentDataType?: string;
      itemsByType?: Record<string, number>;
      lastProcessedId?: string;
      stage?: string;
      operationType?: string;
      message?: string;
    }
  ) {
    // Accumulate item counts locally
    if (updates.itemsByType) {
      Object.entries(updates.itemsByType).forEach(([type, count]) => {
        this.itemCounts[type] = (this.itemCounts[type] || 0) + count;
      });
    }
    
    const payload = {
      taskId: this.taskId,
      status,
      timestamp: new Date().toISOString(),
      ...updates,
      itemsByType: { ...this.itemCounts } // Send accumulated counts
    };
    
    return this.sendProgressUpdate(payload);
  }
}
```

## Code Examples

### Migrating Discovery Operations

**Legacy Discovery Code:**
```typescript
// Old discovery implementation
async function discoverAreas(jobId: string) {
  let groupCount = 0;
  let projectCount = 0;
  
  const areas = await fetchAreas();
  
  for (const area of areas) {
    if (area.type === 'group') groupCount++;
    if (area.type === 'project') projectCount++;
    
    // Legacy progress update
    await sendProgressUpdate({
      taskId: jobId,
      status: "processing",
      timestamp: new Date().toISOString(),
      groupCount,
      projectCount,
      message: `Discovered ${groupCount} groups, ${projectCount} projects`
    });
  }
}
```

**Enhanced Discovery Code:**
```typescript
// Enhanced discovery implementation
async function discoverAreasEnhanced(jobId: string) {
  const discoveredAreas: DiscoveredAreaData[] = [];
  
  const areas = await fetchAreas();
  
  // Process areas and build discovery data
  for (const area of areas) {
    discoveredAreas.push({
      type: area.type as 'group' | 'project',
      name: area.name,
      gitlabId: area.id,
      fullPath: area.full_path,
      webUrl: area.web_url,
      description: area.description,
      discoveredBy: 'crawler_token_123'
    });
  }
  
  // Send enhanced discovery update
  await sendProgressUpdate({
    taskId: jobId,
    status: "new_areas_discovered",
    timestamp: new Date().toISOString(),
    areas: discoveredAreas,
    itemsByType: {
      groups: discoveredAreas.filter(a => a.type === 'group').length,
      projects: discoveredAreas.filter(a => a.type === 'project').length
    },
    stage: "discovery",
    operationType: "discovery",
    message: `Discovered ${discoveredAreas.length} areas`
  });
}
```

### Migrating Data Collection

**Legacy Data Collection:**
```typescript
// Old data collection
async function collectIssues(jobId: string, projectId: string) {
  let processed = 0;
  const issues = await getIssues(projectId);
  const total = issues.length;
  
  for (const issue of issues) {
    await processIssue(issue);
    processed++;
    
    // Legacy progress update
    if (processed % 10 === 0) {
      await sendProgressUpdate({
        taskId: jobId,
        status: "processing",
        timestamp: new Date().toISOString(),
        processed,
        total,
        message: `Processed ${processed}/${total} issues`
      });
    }
  }
}
```

**Enhanced Data Collection:**
```typescript
// Enhanced data collection with resumability
async function collectIssuesEnhanced(
  jobId: string, 
  projectId: string, 
  resumeFromId?: string
) {
  let processedItems = 0;
  let lastProcessedId: string | undefined;
  
  const issues = await getIssues(projectId, resumeFromId);
  const totalItems = await getIssueCount(projectId);
  
  for (const issue of issues) {
    await processIssue(issue);
    processedItems++;
    lastProcessedId = issue.id;
    
    // Enhanced progress update
    if (processedItems % 10 === 0) {
      await sendProgressUpdate({
        taskId: jobId,
        status: "processing",
        timestamp: new Date().toISOString(),
        processedItems,
        totalItems,
        currentDataType: "issues",
        itemsByType: {
          issues: processedItems
        },
        lastProcessedId,
        stage: "data_collection",
        operationType: "data_collection",
        message: `Processed ${processedItems}/${totalItems} issues`
      });
    }
  }
  
  // Final completion update
  await sendProgressUpdate({
    taskId: jobId,
    status: "completed",
    timestamp: new Date().toISOString(),
    processedItems,
    totalItems,
    currentDataType: "issues",
    itemsByType: {
      issues: processedItems
    },
    lastProcessedId,
    stage: "finalization",
    message: `Completed processing ${processedItems} issues`
  });
}
```

### Wrapper for Gradual Migration

Create a wrapper that supports both legacy and enhanced modes:

```typescript
class ProgressTracker {
  constructor(
    private taskId: string,
    private enhanced: boolean = false
  ) {}
  
  async updateProgress(options: {
    processed?: number;
    total?: number;
    message?: string;
    // Enhanced options
    processedItems?: number;
    totalItems?: number;
    currentDataType?: string;
    itemsByType?: Record<string, number>;
    lastProcessedId?: string;
    stage?: string;
    operationType?: string;
  }) {
    if (this.enhanced) {
      // Use enhanced tracking
      return this.sendEnhancedUpdate(options);
    } else {
      // Use legacy tracking
      return this.sendLegacyUpdate(options);
    }
  }
  
  private async sendLegacyUpdate(options: any) {
    return sendProgressUpdate({
      taskId: this.taskId,
      status: "processing",
      timestamp: new Date().toISOString(),
      processed: options.processed,
      total: options.total,
      message: options.message
    });
  }
  
  private async sendEnhancedUpdate(options: any) {
    return sendProgressUpdate({
      taskId: this.taskId,
      status: "processing",
      timestamp: new Date().toISOString(),
      processedItems: options.processedItems || options.processed,
      totalItems: options.totalItems || options.total,
      currentDataType: options.currentDataType,
      itemsByType: options.itemsByType,
      lastProcessedId: options.lastProcessedId,
      stage: options.stage,
      operationType: options.operationType,
      message: options.message
    });
  }
}

// Usage - can switch between modes
const tracker = new ProgressTracker(jobId, true); // enhanced mode
// const tracker = new ProgressTracker(jobId, false); // legacy mode
```

## Testing Migration

### Pre-Migration Testing

Test existing functionality continues to work:

```typescript
describe('Legacy Progress Compatibility', () => {
  it('should handle legacy progress fields', async () => {
    const legacyUpdate = {
      taskId: 'test_job',
      status: 'processing',
      timestamp: new Date().toISOString(),
      processed: 50,
      total: 100,
      groupCount: 5,
      projectCount: 10
    };
    
    const response = await sendProgressUpdate(legacyUpdate);
    expect(response.status).toBe('received');
  });
});
```

### Post-Migration Testing

Test enhanced functionality works correctly:

```typescript
describe('Enhanced Progress Features', () => {
  it('should handle enhanced progress fields', async () => {
    const enhancedUpdate = {
      taskId: 'test_job',
      status: 'processing', 
      timestamp: new Date().toISOString(),
      processedItems: 50,
      totalItems: 100,
      itemsByType: {
        groups: 5,
        projects: 10,
        issues: 35
      },
      lastProcessedId: 'item_50',
      stage: 'data_collection',
      operationType: 'data_collection'
    };
    
    const response = await sendProgressUpdate(enhancedUpdate);
    expect(response.status).toBe('received');
  });
  
  it('should accumulate progress data correctly', async () => {
    // Send first update
    await sendProgressUpdate({
      taskId: 'test_job',
      status: 'processing',
      timestamp: new Date().toISOString(),
      itemsByType: { issues: 25 }
    });
    
    // Send second update
    await sendProgressUpdate({
      taskId: 'test_job', 
      status: 'processing',
      timestamp: new Date().toISOString(),
      itemsByType: { issues: 15 }
    });
    
    // Verify accumulation (issues should total 40)
    const job = await getJob('test_job');
    expect(job.progress.itemsByType.issues).toBe(40);
  });
});
```

### Migration Testing Checklist

- [ ] Legacy fields continue to work
- [ ] Enhanced fields provide additional functionality
- [ ] Data accumulation works correctly
- [ ] Timeline events are created
- [ ] Resumability functions properly
- [ ] Error handling is enhanced
- [ ] Performance is maintained or improved

## Rollback Plan

### Immediate Rollback

If issues arise, the system supports immediate rollback since legacy fields are fully supported:

1. **Disable Enhanced Features**: Simply stop sending enhanced fields
2. **Revert to Legacy Updates**: Use original progress update format
3. **No Data Loss**: All progress data is preserved

### Emergency Rollback Code

```typescript
// Emergency rollback to legacy mode
class EmergencyLegacyTracker {
  async sendLegacyUpdate(taskId: string, processed: number, total: number) {
    return sendProgressUpdate({
      taskId,
      status: "processing",
      timestamp: new Date().toISOString(),
      processed,    // Use legacy field
      total,        // Use legacy field
      message: `Processed ${processed}/${total} items`
    });
  }
}
```

### Rollback Testing

```typescript
// Test rollback functionality
describe('Rollback Compatibility', () => {
  it('should work with pure legacy fields after rollback', async () => {
    const purelyLegacyUpdate = {
      taskId: 'rollback_test',
      status: 'processing',
      timestamp: new Date().toISOString(),
      processed: 75,
      total: 150
    };
    
    const response = await sendProgressUpdate(purelyLegacyUpdate);
    expect(response.status).toBe('received');
  });
});
```

## Migration Timeline Recommendations

### Week 1-2: Preparation
- Review existing crawler implementations
- Identify migration candidates
- Set up testing environment
- Plan migration phases

### Week 3-4: Phase 1 Migration
- Deploy enhanced backend (no changes to crawlers needed)
- Monitor for any issues
- Verify legacy compatibility

### Week 5-8: Phase 2 Migration
- Begin adding basic enhanced fields (`processedItems`, `currentDataType`, `stage`)
- Update critical crawlers first
- Monitor accumulation behavior

### Week 9-12: Phase 3 Migration  
- Add detailed item type tracking (`itemsByType`)
- Implement resumability (`lastProcessedId`)
- Add operation type categorization

### Week 13+: Phase 4 Migration
- Complete migration to full enhanced mode
- Remove legacy field usage (optional)
- Implement advanced features (custom item types, etc.)

This migration guide provides a comprehensive approach to upgrading your crawler progress tracking while maintaining full backward compatibility and minimizing risk.
