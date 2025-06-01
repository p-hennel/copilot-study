# Progress Types Reference

This document provides comprehensive documentation of all TypeScript interfaces and types used in the enhanced progress tracking system, including field descriptions, validation rules, and usage examples.

## Table of Contents

1. [Core Interfaces](#core-interfaces)
2. [Helper Types](#helper-types)
3. [API Payload Types](#api-payload-types)
4. [Utility Functions](#utility-functions)
5. [Usage Examples](#usage-examples)
6. [Validation Rules](#validation-rules)
7. [Best Practices](#best-practices)

## Core Interfaces

### CrawlerProgressData

**File**: [`src/lib/types/progress.ts`](../src/lib/types/progress.ts:8)

The main interface for all progress tracking data throughout the application.

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
  
  // Legacy fields for backward compatibility
  processed?: number;
  total?: number;
  groupCount?: number;
  projectCount?: number;
  groupTotal?: number;
  projectTotal?: number;
  
  // Error tracking
  error?: string;
  errorTimestamp?: string;
  
  // Credential status (for credential-related progress updates)
  credentialStatus?: {
    type?: string;
    severity?: string;
    errorType?: string;
    providerId?: string;
    instanceType?: string;
    message?: string;
    adminGuidance?: string[];
    timestamp?: string;
    lastUpdate?: string;
  };
  
  // Areas discovery (for discovery jobs)
  lastAreasDiscovery?: {
    timestamp: string;
    groupsCount: number;
    projectsCount: number;
    totalDiscovered: number;
  };
}
```

#### Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `processedItems` | `number` | No | Number of items processed so far |
| `totalItems` | `number` | No | Total number of items to process |
| `currentDataType` | `string` | No | Type of data currently being processed (e.g., "issues", "projects") |
| `itemsByType` | `object` | No | Detailed breakdown of processed items by type |
| `lastProcessedId` | `string` | No | ID of the last processed item (for resumability) |
| `stage` | `string` | No | Current processing stage (e.g., "discovery", "data_collection") |
| `operationType` | `enum` | No | Type of operation being performed |
| `message` | `string` | No | Human-readable progress message |
| `lastUpdate` | `string` | No | ISO timestamp of last update |
| `timeline` | `array` | No | Array of timeline events for audit trail |

#### ItemsByType Breakdown

The `itemsByType` object provides detailed tracking of different item types:

```typescript
interface ItemsByType {
  groups?: number;          // GitLab groups discovered/processed
  projects?: number;        // GitLab projects discovered/processed
  issues?: number;         // Issues processed
  mergeRequests?: number;  // Merge requests processed
  commits?: number;        // Commits processed
  pipelines?: number;      // CI/CD pipelines processed
  branches?: number;       // Git branches processed
  tags?: number;          // Git tags processed
  users?: number;         // Users/members processed
  milestones?: number;    // Project milestones processed
  labels?: number;        // Issue/MR labels processed
  [key: string]: number | undefined; // Extensible for custom types
}
```

### ProgressTimelineEvent

Timeline events provide a complete audit trail of progress history.

```typescript
interface ProgressTimelineEvent {
  timestamp: string;
  event: 'progress_update' | 'areas_discovered' | 'credential_status_change' | 
         'discovery_progress' | 'stage_change' | 'error' | 'completion';
  details: {
    [key: string]: any;
  };
}
```

#### Event Types

| Event Type | Description | Typical Details |
|------------|-------------|-----------------|
| `progress_update` | Regular progress update | `processedItems`, `currentDataType`, `stage` |
| `areas_discovered` | New areas found during discovery | `groupsCount`, `projectsCount`, `totalDiscovered` |
| `credential_status_change` | Authentication status change | `status`, `credentialType`, `severity` |
| `discovery_progress` | Discovery operation milestone | `groupsAdded`, `projectsAdded`, `totalGroups` |
| `stage_change` | Processing stage transition | `fromStage`, `toStage`, `operationType` |
| `error` | Error occurrence | `errorType`, `errorMessage`, `context` |
| `completion` | Job completion | `finalCounts`, `duration`, `summary` |

## Helper Types

### Operation Type Enumeration

```typescript
type OperationType = 'discovery' | 'branch_crawling' | 'data_collection' | 'finalization';
```

**Descriptions**:
- `discovery`: Finding and cataloging new groups, projects, or data sources
- `branch_crawling`: Processing git branches and related metadata
- `data_collection`: Gathering primary data (issues, MRs, commits, etc.)
- `finalization`: Cleanup, indexing, and completion tasks

### Legacy Progress Fields

For backward compatibility with existing crawlers:

```typescript
interface LegacyProgressFields {
  processed?: number;        // Legacy alias for processedItems
  total?: number;           // Legacy alias for totalItems
  groupCount?: number;      // Legacy field for GROUP_PROJECT_DISCOVERY
  projectCount?: number;    // Legacy field for GROUP_PROJECT_DISCOVERY
  groupTotal?: number;      // Legacy total count for groups
  projectTotal?: number;    // Legacy total count for projects
}
```

## API Payload Types

### ProgressUpdatePayload

The complete payload structure for sending progress updates to the API.

```typescript
interface ProgressUpdatePayload {
  // Required fields
  taskId: string;                    // Job ID from database
  status: string;                    // Job status
  timestamp: string;                 // ISO 8601 timestamp
  
  // Basic progress fields
  processedItems?: number;           // Items processed count
  totalItems?: number;              // Total items to process
  currentDataType?: string;         // Current data type being processed
  message?: string;                 // Human-readable message
  error?: string | Record<string, any>; // Error information
  progress?: any;                   // Resume state data
  
  // Enhanced progress fields
  itemsByType?: {
    groups?: number;
    projects?: number;
    issues?: number;
    mergeRequests?: number;
    commits?: number;
    pipelines?: number;
    [key: string]: number | undefined;
  };
  lastProcessedId?: string;         // Last processed item ID
  stage?: string;                   // Processing stage
  operationType?: OperationType;    // Operation type
  
  // Special operation fields
  areas?: DiscoveredAreaData[];     // For area discoveries
  credentialStatus?: CredentialStatusUpdate; // For credential updates
}
```

### DiscoveredAreaData

For reporting newly discovered GitLab groups and projects:

```typescript
interface DiscoveredAreaData {
  type: 'group' | 'project';       // Type of discovered area
  name: string;                    // Area name
  gitlabId: string;               // GitLab ID
  fullPath: string;               // Full path identifier
  webUrl?: string;                // Web URL
  description?: string | null;     // Description
  parentPath?: string | null;      // Parent path for projects
  discoveredBy: string;           // Discovery token/account ID
}
```

### CredentialStatusUpdate

For reporting authentication and credential status changes:

```typescript
interface CredentialStatusUpdate {
  type?: string;                   // Credential type
  severity?: string;              // Issue severity level
  errorType?: string;             // Specific error type
  providerId?: string;            // Provider identifier
  instanceType?: string;          // Instance type
  message?: string;               // Status message
  adminGuidance?: string[];       // Admin action recommendations
  timestamp?: string;             // Status change timestamp
  lastUpdate?: string;            // Last update timestamp
}
```

## Utility Functions

### extractProgressData()

**File**: [`src/lib/types/progress.ts`](../src/lib/types/progress.ts:85)

Safely extracts progress data from job records with error handling.

```typescript
function extractProgressData(progressBlob: unknown): CrawlerProgressData
```

**Usage**:
```typescript
const progress = extractProgressData(jobRecord.progress);
console.log(progress.processedItems || 0);
```

**Error Handling**: Returns empty object `{}` if extraction fails.

### mergeProgressData()

**File**: [`src/lib/types/progress.ts`](../src/lib/types/progress.ts:103)

Intelligently merges progress data with accumulation logic.

```typescript
function mergeProgressData(
  existing: CrawlerProgressData,
  incoming: Partial<CrawlerProgressData>
): CrawlerProgressData
```

**Merging Rules**:
- `processedItems`: Uses `Math.max()` for monotonic progression
- `itemsByType`: Accumulates counts instead of overwriting
- `timeline`: Appends new events to existing timeline
- Other fields: Incoming values override existing (when provided)

**Usage**:
```typescript
const updated = mergeProgressData(currentProgress, {
  processedItems: 150,
  itemsByType: { issues: 25 },
  currentDataType: 'issues'
});
```

### createTimelineEvent()

**File**: [`src/lib/types/progress.ts`](../src/lib/types/progress.ts:173)

Creates standardized timeline events for progress tracking.

```typescript
function createTimelineEvent(
  event: ProgressTimelineEvent['event'],
  details: Record<string, any>,
  timestamp?: string
): ProgressTimelineEvent
```

**Usage**:
```typescript
const event = createTimelineEvent('progress_update', {
  processedItems: 100,
  stage: 'data_collection',
  currentDataType: 'issues'
});
```

### calculateProgressPercentage()

**File**: [`src/lib/types/progress.ts`](../src/lib/types/progress.ts:188)

Calculates completion percentage from progress data.

```typescript
function calculateProgressPercentage(progress: CrawlerProgressData): number | null
```

**Returns**: Percentage (0-100) or `null` if total is unknown.

**Usage**:
```typescript
const percentage = calculateProgressPercentage(progress);
if (percentage !== null) {
  console.log(`Progress: ${percentage}%`);
}
```

### getProgressSummary()

**File**: [`src/lib/types/progress.ts`](../src/lib/types/progress.ts:200)

Generates human-readable progress summary.

```typescript
function getProgressSummary(progress: CrawlerProgressData): string
```

**Usage**:
```typescript
const summary = getProgressSummary(progress);
// Example output: "150/500 issues (30%)"
console.log(summary);
```

## Usage Examples

### Basic Progress Tracking

```typescript
import { 
  CrawlerProgressData, 
  createTimelineEvent, 
  mergeProgressData 
} from '$lib/types/progress';

// Create initial progress
const initialProgress: CrawlerProgressData = {
  processedItems: 0,
  totalItems: 100,
  currentDataType: 'issues',
  stage: 'data_collection',
  operationType: 'data_collection',
  itemsByType: {},
  timeline: []
};

// Update progress
const progressUpdate: Partial<CrawlerProgressData> = {
  processedItems: 25,
  itemsByType: { issues: 25 },
  lastProcessedId: 'issue_25',
  timeline: [
    createTimelineEvent('progress_update', {
      processedItems: 25,
      currentDataType: 'issues'
    })
  ]
};

// Merge updates
const updatedProgress = mergeProgressData(initialProgress, progressUpdate);
```

### Discovery Operation

```typescript
import { DiscoveredAreaData, ProgressUpdatePayload } from '$lib/types/progress';

const discoveredAreas: DiscoveredAreaData[] = [
  {
    type: 'group',
    name: 'Engineering Team',
    gitlabId: '123',
    fullPath: 'engineering-team',
    webUrl: 'https://gitlab.example.com/engineering-team',
    discoveredBy: 'crawler_token_abc'
  },
  {
    type: 'project',
    name: 'Frontend App',
    gitlabId: '456',
    fullPath: 'engineering-team/frontend-app',
    parentPath: 'engineering-team',
    discoveredBy: 'crawler_token_abc'
  }
];

const discoveryPayload: ProgressUpdatePayload = {
  taskId: 'discovery_job_123',
  status: 'new_areas_discovered',
  timestamp: new Date().toISOString(),
  areas: discoveredAreas,
  itemsByType: {
    groups: 1,
    projects: 1
  },
  stage: 'discovery',
  operationType: 'discovery',
  message: `Discovered ${discoveredAreas.length} areas`
};
```

### Error Handling

```typescript
import { CrawlerProgressData, createTimelineEvent } from '$lib/types/progress';

const errorProgress: Partial<CrawlerProgressData> = {
  error: 'GitLab API rate limit exceeded',
  errorTimestamp: new Date().toISOString(),
  lastProcessedId: 'issue_125',
  timeline: [
    createTimelineEvent('error', {
      errorType: 'RateLimitError',
      errorMessage: 'GitLab API rate limit exceeded',
      retryAfter: 3600,
      context: {
        lastProcessedId: 'issue_125',
        processedItems: 125
      }
    })
  ]
};
```

### Resumable Operations

```typescript
import { CrawlerProgressData } from '$lib/types/progress';

// Save resume state
const resumeState: CrawlerProgressData = {
  lastProcessedId: 'issue_150',
  processedItems: 150,
  itemsByType: {
    issues: 150,
    mergeRequests: 75
  },
  stage: 'data_collection',
  operationType: 'data_collection'
};

// Resume from state
async function resumeFromProgress(savedProgress: CrawlerProgressData) {
  const startFrom = savedProgress.lastProcessedId;
  const currentCounts = savedProgress.itemsByType || {};
  
  // Continue processing from where we left off
  await continueProcessing(startFrom, currentCounts);
}
```

## Validation Rules

### Field Validation

#### Required Fields (API Payload)
- `taskId`: Must be non-empty string
- `status`: Must be valid status string
- `timestamp`: Must be valid ISO 8601 timestamp

#### Numeric Field Constraints
- `processedItems`: Must be >= 0
- `totalItems`: Must be >= 0
- `itemsByType` values: Must be >= 0
- `processedItems` <= `totalItems` (when both provided)

#### String Field Constraints
- `taskId`: Maximum 255 characters
- `currentDataType`: Maximum 100 characters
- `stage`: Maximum 100 characters
- `message`: Maximum 1000 characters
- `lastProcessedId`: Maximum 255 characters

#### Timestamp Validation
- All timestamp fields must be valid ISO 8601 format
- Timestamps should not be in the future (with reasonable tolerance)

### Validation Examples

```typescript
function validateProgressPayload(payload: ProgressUpdatePayload): string[] {
  const errors: string[] = [];

  // Required fields
  if (!payload.taskId) errors.push('taskId is required');
  if (!payload.status) errors.push('status is required');
  if (!payload.timestamp) errors.push('timestamp is required');

  // Numeric constraints
  if (payload.processedItems !== undefined && payload.processedItems < 0) {
    errors.push('processedItems cannot be negative');
  }

  if (payload.totalItems !== undefined && payload.totalItems < 0) {
    errors.push('totalItems cannot be negative');
  }

  // Logical constraints
  if (payload.processedItems !== undefined && payload.totalItems !== undefined) {
    if (payload.processedItems > payload.totalItems) {
      errors.push('processedItems cannot exceed totalItems');
    }
  }

  // ItemsByType validation
  if (payload.itemsByType) {
    Object.entries(payload.itemsByType).forEach(([type, count]) => {
      if (count !== undefined && count < 0) {
        errors.push(`itemsByType.${type} cannot be negative`);
      }
    });
  }

  return errors;
}
```

## Best Practices

### Type Safety

```typescript
// Use proper typing for progress data
const progress: CrawlerProgressData = {
  processedItems: 100,
  totalItems: 500,
  itemsByType: {
    issues: 100
  }
};

// Avoid any types - use proper interfaces
// ❌ Don't do this
const badProgress: any = { /* ... */ };

// ✅ Do this instead
const goodProgress: CrawlerProgressData = { /* ... */ };
```

### Null Safety

```typescript
// Always check for undefined/null values
const processedCount = progress.processedItems || 0;
const timeline = progress.timeline || [];
const itemCounts = progress.itemsByType || {};

// Use optional chaining for nested properties
const groupCount = progress.itemsByType?.groups || 0;
const lastEvent = progress.timeline?.[progress.timeline.length - 1];
```

### Incremental Updates

```typescript
// Build progress incrementally rather than all at once
class ProgressBuilder {
  private progress: CrawlerProgressData = {};

  addProcessedItems(count: number) {
    this.progress.processedItems = (this.progress.processedItems || 0) + count;
    return this;
  }

  addItemsByType(type: string, count: number) {
    if (!this.progress.itemsByType) {
      this.progress.itemsByType = {};
    }
    this.progress.itemsByType[type] = (this.progress.itemsByType[type] || 0) + count;
    return this;
  }

  setStage(stage: string) {
    this.progress.stage = stage;
    return this;
  }

  build(): CrawlerProgressData {
    return { ...this.progress };
  }
}

// Usage
const progress = new ProgressBuilder()
  .addProcessedItems(25)
  .addItemsByType('issues', 25)
  .setStage('data_collection')
  .build();
```

### Error Handling Patterns

```typescript
// Graceful degradation for progress operations
function safeProgressUpdate(progress: unknown): CrawlerProgressData {
  try {
    return extractProgressData(progress);
  } catch (error) {
    console.warn('Failed to extract progress data:', error);
    return {}; // Return empty progress rather than failing
  }
}

// Validate before processing
function processProgressUpdate(payload: ProgressUpdatePayload) {
  const errors = validateProgressPayload(payload);
  if (errors.length > 0) {
    throw new Error(`Invalid progress payload: ${errors.join(', ')}`);
  }
  
  // Process validated payload
  return handleProgressUpdate(payload);
}
```

This types reference provides comprehensive documentation for all progress tracking interfaces and their proper usage. For implementation examples, see the [Crawler Progress Integration Guide](./crawler-progress-integration-guide.md).