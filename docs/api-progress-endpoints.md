# API Progress Endpoints Reference

This document provides comprehensive API reference documentation for the enhanced progress tracking endpoints in the web application.

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Main Progress Endpoint](#main-progress-endpoint)
4. [Progress Accumulation Logic](#progress-accumulation-logic)
5. [Response Formats](#response-formats)
6. [Error Handling](#error-handling)
7. [Integration Testing](#integration-testing)

## Overview

The progress tracking API provides endpoints for crawlers to report detailed progress information to the web application. The system is designed to:

- Accept progress updates from crawler processes
- Intelligently accumulate progress data
- Maintain timeline history for audit trails
- Support resumable operations
- Handle various crawler operation types

## Authentication

### Required Headers

All requests to progress endpoints require authentication:

```http
POST /api/internal/jobs/progress
Content-Type: application/json
Authorization: Bearer <CRAWLER_API_TOKEN>
```

### Token Configuration

The `CRAWLER_API_TOKEN` must be configured in the application settings:

```bash
# Environment variable
CRAWLER_API_TOKEN=your_secure_token_here
```

**Security Notes:**
- Token should be a cryptographically secure random string
- Minimum 32 characters recommended
- Store securely and rotate regularly
- Never log or expose in error messages

### Authentication Flow

```typescript
// Verify token in request
const authHeader = request.headers.get('Authorization');
if (!authHeader || !authHeader.startsWith('Bearer ')) {
  return json({ error: 'Unauthorized' }, { status: 401 });
}

const token = authHeader.substring('Bearer '.length);
if (token !== CRAWLER_API_TOKEN) {
  return json({ error: 'Unauthorized' }, { status: 401 });
}
```

## Main Progress Endpoint

### Endpoint Details

**URL**: `/api/internal/jobs/progress`  
**Method**: `POST`  
**Content-Type**: `application/json`  
**Authentication**: Required (`Bearer` token)

### Request Payload

```typescript
interface ProgressUpdatePayload {
  // Required fields
  taskId: string;                    // Job ID from database
  status: string;                    // Operation status
  timestamp: string;                 // ISO 8601 timestamp
  
  // Basic progress fields
  processedItems?: number;           // Items processed count
  totalItems?: number;              // Total items to process
  currentDataType?: string;         // Type of data being processed
  message?: string;                 // Human-readable message
  error?: string | Record<string, any>; // Error information
  progress?: any;                   // Resume state data
  
  // Enhanced progress fields
  itemsByType?: {
    groups?: number;                // Groups processed
    projects?: number;              // Projects processed
    issues?: number;               // Issues processed
    mergeRequests?: number;        // Merge requests processed
    commits?: number;              // Commits processed
    pipelines?: number;            // Pipelines processed
    branches?: number;             // Branches processed
    tags?: number;                 // Tags processed
    users?: number;                // Users processed
    milestones?: number;           // Milestones processed
    labels?: number;               // Labels processed
    [key: string]: number | undefined;
  };
  lastProcessedId?: string;         // Last processed item ID
  stage?: string;                   // Processing stage
  operationType?: 'discovery' | 'branch_crawling' | 'data_collection' | 'finalization';
  
  // Special operation fields
  areas?: DiscoveredAreaData[];     // For area discoveries
  credentialStatus?: CredentialStatusUpdate; // For credential updates
}
```

### DiscoveredAreaData Interface

```typescript
interface DiscoveredAreaData {
  type: 'group' | 'project';       // Type of discovered area
  name: string;                    // Area name
  gitlabId: string;               // GitLab ID
  fullPath: string;               // Full path identifier
  webUrl?: string;                // Web URL
  description?: string | null;     // Description
  parentPath?: string | null;      // Parent path
  discoveredBy: string;           // Discovery token/account ID
}
```

### Status Types and Behaviors

#### Standard Status Types

| Status | Behavior | Database Updates | Use Case |
|--------|----------|------------------|----------|
| `started` | Sets job to RUNNING, records start time | `status`, `started_at`, `resumeState` | Job initialization |
| `processing` | Maintains RUNNING status, updates progress | `status`, `progress`, `updated_at` | Regular progress updates |
| `completed` | Sets job to FINISHED, records end time | `status`, `finished_at`, clears `resumeState` | Successful completion |
| `failed` | Sets job to FAILED, records error | `status`, `finished_at`, `progress` with error | Unrecoverable errors |
| `paused` | Sets job to PAUSED, preserves state | `status`, `resumeState`, `progress` | Temporary suspension |

#### Special Status Types

| Status | Behavior | Special Processing |
|--------|----------|-------------------|
| `new_areas_discovered` | Processes area discoveries | Creates areas, authorizations, job associations |
| `credential_expiry` | Sets CREDENTIAL_EXPIRED status | Updates credential status tracking |
| `credential_renewal` | Sets WAITING_CREDENTIAL_RENEWAL | Preserves progress, tracks credential state |
| `credential_resumed` | Sets CREDENTIAL_RENEWED status | Resumes normal operation tracking |

### Request Examples

#### Basic Progress Update

```http
POST /api/internal/jobs/progress
Authorization: Bearer your_token_here
Content-Type: application/json

{
  "taskId": "job_12345",
  "status": "processing", 
  "timestamp": "2025-01-06T19:15:30.000Z",
  "processedItems": 150,
  "totalItems": 500,
  "currentDataType": "issues",
  "message": "Processing issues for project ABC"
}
```

#### Enhanced Progress Update

```http
POST /api/internal/jobs/progress
Authorization: Bearer your_token_here
Content-Type: application/json

{
  "taskId": "job_12345",
  "status": "processing",
  "timestamp": "2025-01-06T19:15:30.000Z",
  "processedItems": 275,
  "totalItems": 500,
  "currentDataType": "merge_requests",
  "itemsByType": {
    "groups": 5,
    "projects": 20,
    "issues": 150,
    "mergeRequests": 100
  },
  "lastProcessedId": "mr_98765",
  "stage": "data_collection",
  "operationType": "branch_crawling",
  "message": "Processing merge requests and related data"
}
```

#### Area Discovery Update

```http
POST /api/internal/jobs/progress
Authorization: Bearer your_token_here
Content-Type: application/json

{
  "taskId": "discovery_job_789",
  "status": "new_areas_discovered",
  "timestamp": "2025-01-06T19:00:15.000Z",
  "areas": [
    {
      "type": "group",
      "name": "Engineering Team",
      "gitlabId": "123",
      "fullPath": "engineering-team",
      "webUrl": "https://gitlab.example.com/engineering-team",
      "description": "Main engineering group",
      "discoveredBy": "crawler_token_abc"
    },
    {
      "type": "project",
      "name": "Frontend App",
      "gitlabId": "456", 
      "fullPath": "engineering-team/frontend-app",
      "webUrl": "https://gitlab.example.com/engineering-team/frontend-app",
      "parentPath": "engineering-team",
      "discoveredBy": "crawler_token_abc"
    }
  ],
  "itemsByType": {
    "groups": 1,
    "projects": 1
  },
  "stage": "discovery",
  "operationType": "discovery",
  "message": "Discovered 1 group and 1 project"
}
```

#### Error Reporting

```http
POST /api/internal/jobs/progress
Authorization: Bearer your_token_here
Content-Type: application/json

{
  "taskId": "job_12345",
  "status": "failed",
  "timestamp": "2025-01-06T19:30:45.000Z",
  "error": {
    "type": "APIError",
    "message": "GitLab API rate limit exceeded",
    "code": 429,
    "retryAfter": 3600
  },
  "lastProcessedId": "issue_54321",
  "processedItems": 125,
  "itemsByType": {
    "issues": 125
  },
  "message": "Job failed due to rate limiting"
}
```

## Progress Accumulation Logic

The API implements intelligent data accumulation to prevent progress loss and ensure consistent state:

### Basic Field Accumulation

```typescript
// processedItems - monotonic progression
const newProcessedItems = processedItems !== undefined
  ? Math.max(processedItems, currentProgress.processedItems || 0)
  : currentProgress.processedItems;

// totalItems - update when provided
const newTotalItems = totalItems || currentProgress.totalItems;

// lastProcessedId - always use latest
const newLastProcessedId = lastProcessedId || currentProgress.lastProcessedId;
```

### ItemsByType Accumulation

```typescript
// Merge itemsByType with accumulation
const accumulatedItemsByType = {
  ...currentProgress.itemsByType,
  ...(payload.itemsByType || {})
};

// For each type, accumulate counts
Object.entries(payload.itemsByType || {}).forEach(([key, value]) => {
  if (value !== undefined) {
    accumulatedItemsByType[key] = (accumulatedItemsByType[key] || 0) + value;
  }
});
```

### Timeline Event Creation

Every progress update creates a timeline entry:

```typescript
const timelineEvent = {
  timestamp: payload.timestamp,
  event: 'progress_update',
  details: {
    status: payload.status,
    processedItems: newProcessedItems,
    totalItems: newTotalItems,
    currentDataType: payload.currentDataType,
    stage: payload.stage,
    operationType: payload.operationType
  }
};

// Append to existing timeline
const newTimeline = [...(currentProgress.timeline || []), timelineEvent];
```

### Special Case: Area Discovery

For `new_areas_discovered` status:

```typescript
// Process discovered areas
const { groupsCount, projectsCount } = await processDiscoveredAreas(areas, jobRecord);

// Create enhanced progress data
const discoveryProgress = {
  ...currentProgress,
  itemsByType: {
    ...currentProgress.itemsByType,
    groups: (currentProgress.itemsByType?.groups || 0) + groupsCount,
    projects: (currentProgress.itemsByType?.projects || 0) + projectsCount
  },
  lastAreasDiscovery: {
    timestamp: payload.timestamp,
    groupsCount,
    projectsCount,
    totalDiscovered: groupsCount + projectsCount
  },
  timeline: [
    ...currentProgress.timeline,
    {
      timestamp: payload.timestamp,
      event: 'areas_discovered',
      details: { groupsCount, projectsCount }
    }
  ]
};
```

## Response Formats

### Success Responses

#### Standard Success (200 OK)

```json
{
  "status": "received",
  "message": "Progress update acknowledged for task job_12345"
}
```

#### Area Discovery Success (200 OK)

```json
{
  "status": "received", 
  "message": "Areas discovery processed for task discovery_job_789: 1 groups, 3 projects"
}
```

#### Credential Status Success (200 OK)

```json
{
  "status": "received",
  "message": "Credential status update processed for task job_12345: credential_renewal",
  "credentialGuidance": [
    "Check credential expiration in admin panel",
    "Renew GitLab access token if needed"
  ]
}
```

### Error Responses

#### Missing Authentication (401 Unauthorized)

```json
{
  "error": "Unauthorized"
}
```

#### Invalid Request Body (400 Bad Request)

```json
{
  "error": "Invalid request body"
}
```

#### Missing Required Fields (400 Bad Request)

```json
{
  "error": "Missing required fields: taskId, status, timestamp"
}
```

#### Job Not Found (404 Not Found)

```json
{
  "error": "Job not found"
}
```

#### Invalid Status (400 Bad Request)

```json
{
  "error": "Invalid status: invalid_status_name"
}
```

#### Service Unavailable (503 Service Unavailable)

```json
{
  "error": "Endpoint disabled due to missing configuration"
}
```

#### Internal Server Error (500 Internal Server Error)

```json
{
  "error": "Internal server error during progress update"
}
```

## Error Handling

### Client-Side Error Handling

```typescript
async function sendProgressUpdate(payload: ProgressUpdatePayload) {
  try {
    const response = await fetch('/api/internal/jobs/progress', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CRAWLER_API_TOKEN}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Progress update failed (${response.status}): ${errorData.error}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Progress update error:', error);
    throw error;
  }
}
```

### Retry Logic

```typescript
async function sendProgressWithRetry(
  payload: ProgressUpdatePayload,
  maxRetries = 3
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await sendProgressUpdate(payload);
    } catch (error) {
      if (attempt === maxRetries) throw error;
      
      // Exponential backoff
      const delay = Math.pow(2, attempt - 1) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
      
      console.warn(`Progress update attempt ${attempt} failed, retrying in ${delay}ms`);
    }
  }
}
```

### Error Recovery Strategies

| Error Type | Recovery Strategy |
|------------|-------------------|
| Network timeout | Retry with exponential backoff |
| 401 Unauthorized | Check token configuration, fail fast |
| 404 Job not found | Log error, create new job if needed |
| 400 Bad request | Validate payload, fix and retry |
| 429 Rate limit | Implement backoff based on Retry-After header |
| 500 Server error | Retry with backoff, escalate if persistent |

## Integration Testing

### cURL Examples

#### Basic Progress Update

```bash
curl -X POST http://localhost:5173/api/internal/jobs/progress \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_token_here" \
  -d '{
    "taskId": "test_job_123",
    "status": "processing",
    "timestamp": "2025-01-06T19:15:30.000Z",
    "processedItems": 50,
    "totalItems": 100,
    "currentDataType": "issues"
  }'
```

#### Area Discovery

```bash
curl -X POST http://localhost:5173/api/internal/jobs/progress \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_token_here" \
  -d '{
    "taskId": "discovery_job_456",
    "status": "new_areas_discovered",
    "timestamp": "2025-01-06T19:00:00.000Z",
    "areas": [{
      "type": "group",
      "name": "Test Group",
      "gitlabId": "123",
      "fullPath": "test-group",
      "discoveredBy": "test_token"
    }]
  }'
```

### JavaScript Fetch Examples

#### Complete Job Lifecycle

```javascript
const API_BASE = 'http://localhost:5173';
const TOKEN = 'your_token_here';

// Start job
await fetch(`${API_BASE}/api/internal/jobs/progress`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${TOKEN}`
  },
  body: JSON.stringify({
    taskId: 'test_job_789',
    status: 'started',
    timestamp: new Date().toISOString(),
    stage: 'initialization',
    operationType: 'discovery'
  })
});

// Update progress
await fetch(`${API_BASE}/api/internal/jobs/progress`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${TOKEN}`
  },
  body: JSON.stringify({
    taskId: 'test_job_789',
    status: 'processing',
    timestamp: new Date().toISOString(),
    processedItems: 25,
    totalItems: 100,
    itemsByType: { issues: 25 },
    lastProcessedId: 'issue_25',
    stage: 'data_collection',
    operationType: 'data_collection'
  })
});

// Complete job
await fetch(`${API_BASE}/api/internal/jobs/progress`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${TOKEN}`
  },
  body: JSON.stringify({
    taskId: 'test_job_789',
    status: 'completed',
    timestamp: new Date().toISOString(),
    processedItems: 100,
    totalItems: 100,
    itemsByType: { issues: 100 },
    stage: 'finalization'
  })
});
```

### Expected Responses

For successful requests, expect:

```json
{
  "status": "received",
  "message": "Progress update acknowledged for task test_job_789"
}
```

### Debugging Common Issues

#### Issue: 401 Unauthorized
- **Check**: Authorization header format
- **Check**: Token value matches server configuration
- **Check**: Token is not expired or revoked

#### Issue: 404 Job Not Found
- **Check**: `taskId` matches existing job in database
- **Check**: Job hasn't been deleted
- **Check**: Database connectivity

#### Issue: 400 Bad Request
- **Check**: Required fields (taskId, status, timestamp) are present
- **Check**: JSON syntax is valid
- **Check**: Field types match expected interface
- **Check**: Status value is valid

#### Issue: 500 Internal Server Error
- **Check**: Server logs for detailed error information
- **Check**: Database connectivity and schema
- **Check**: Server configuration (CRAWLER_API_TOKEN)

### Performance Testing

#### Load Testing Example

```javascript
// Test concurrent progress updates
const concurrentUpdates = Array.from({ length: 10 }, (_, i) => 
  fetch('/api/internal/jobs/progress', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOKEN}`
    },
    body: JSON.stringify({
      taskId: `load_test_job_${i}`,
      status: 'processing',
      timestamp: new Date().toISOString(),
      processedItems: i * 10,
      totalItems: 100
    })
  })
);

const results = await Promise.allSettled(concurrentUpdates);
console.log('Successful updates:', results.filter(r => r.status === 'fulfilled').length);
```

This API reference provides complete documentation for integrating with the progress tracking endpoints. For implementation guidance, see the [Crawler Progress Integration Guide](./crawler-progress-integration-guide.md).