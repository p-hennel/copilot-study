# Crawler Dashboard Data Mapping Analysis

## Executive Summary

This document maps the static placeholders in the crawler dashboard to available real data sources from socket connections and database schema. It identifies which placeholders can be replaced with real data and which should be removed.

## Available Data Sources

### 1. WebSocket/SSE Message Types
Based on `handleWebSocketMessage` function (lines 250-331):

- **`client_status`**: Initial client status with cached data
  - `messageBusConnected`: boolean
  - `cachedStatus`: crawler status object
  - `lastHeartbeat`: timestamp
  - `jobFailureLogs`: array of failure logs

- **`statusUpdate`**: Real-time crawler status updates
  - Contains crawler status object with job counts and state

- **`jobUpdate`**: Job-specific status changes
  - Payload contains job-related status information

- **`jobFailure`**: Real-time job failure notifications
  - Contains failure log entries with context

- **`heartbeat`**: Periodic health check signals
  - `timestamp`: when heartbeat was sent

- **`connection`**: Connection status changes
  - `component`: which component (e.g., "messageBus")
  - `status`: connection state

- **`health_check`**: System health information
  - `messageBusConnected`: boolean
  - `lastHeartbeat`: timestamp

### 2. Database Schema (Job Table)
From `copilot-study/src/lib/server/db/base-schema.ts`:

**Job Fields:**
- `id`: string (ULID)
- `created_at`: timestamp
- `started_at`: timestamp (nullable)
- `finished_at`: timestamp (nullable)
- `status`: JobStatus enum (queued, running, paused, failed, finished, credential_expired, etc.)
- `command`: CrawlCommand enum (authorizationScope, users, issues, mergeRequests, etc.)
- `full_path`: string (area reference)
- `branch`: string
- `from`: timestamp (date range start)
- `to`: timestamp (date range end)
- `accountId`: string
- `spawned_from`: string (parent job reference)
- `resumeState`: JSON blob (resume cursors)
- **`progress`: JSON blob (detailed progress data)**
- `userId`: string
- `provider`: TokenProvider enum
- `gitlabGraphQLUrl`: string
- `updated_at`: timestamp

**Area Fields:**
- `full_path`: string (primary key)
- `gitlab_id`: string
- `name`: string
- `type`: AreaType enum (group, project)
- `created_at`: timestamp

### 3. Progress Data Structure
From `copilot-study/src/lib/types/progress.ts`:

**CrawlerProgressData Interface:**
- `processedItems`: number
- `totalItems`: number
- `currentDataType`: string
- `itemsByType`: object with counts by type (groups, projects, issues, mergeRequests, commits, etc.)
- `lastProcessedId`: string
- `stage`: string
- `operationType`: 'discovery' | 'branch_crawling' | 'data_collection' | 'finalization'
- `message`: string
- `lastUpdate`: ISO timestamp
- `timeline`: array of progress events
- `error`: string
- `credentialStatus`: credential-related status

### 4. Available API Endpoints

**Statistics API** (`/api/admin/statistics`):
- `areas.total`: total area count
- `areas.groups`: group count
- `areas.projects`: project count
- `jobs.total`: total job count
- `jobs.completed`: completed jobs
- `jobs.active`: active jobs (running + paused)
- `jobs.running`: currently running jobs
- `jobs.paused`: paused jobs
- `jobs.queued`: queued jobs
- `jobs.failed`: failed jobs
- `jobs.groupProjectDiscovery`: discovery job count

**Jobs API** (`/api/admin/jobs`):
- Paginated job listings with filtering
- Job relationships (parent/child jobs)
- Progress data for each job

## Static Placeholder Analysis

### ✅ Can Be Replaced with Real Data

#### 1. Job Status Counts (Lines 556-584)
**Current Static Values:**
```svelte
<div class="text-2xl font-bold">{crawlerStatus.queued || 0}</div>
<div class="text-2xl font-bold">{crawlerStatus.processing || 0}</div>
<div class="text-2xl font-bold text-green-600">{crawlerStatus.completed || 0}</div>
```

**Real Data Source:** 
- Socket `statusUpdate` messages
- Statistics API endpoint
- Database queries on job table by status

**Replacement Strategy:**
```javascript
// Real-time via socket
crawlerStatus.queued    // from statusUpdate payload
crawlerStatus.processing // from statusUpdate payload  
crawlerStatus.completed  // from statusUpdate payload
crawlerStatus.failed     // from statusUpdate payload

// Fallback via API
statistics.jobs.queued
statistics.jobs.running
statistics.jobs.completed
statistics.jobs.failed
```

#### 2. Progress Indicators (Lines 948-1074)
**Current Static Values:**
```svelte
<Progress value={65} class="h-2" />
<span>Processing groups and projects from discovered areas</span>
<div class="text-sm font-semibold">1,245 / 3,500</div>
```

**Real Data Source:**
- Job `progress` field (JSON blob)
- Socket `jobUpdate` messages
- Progress data structure

**Replacement Strategy:**
```javascript
// Extract from job progress data
const progressData = extractProgressData(job.progress);
const percentage = calculateProgressPercentage(progressData);
const summary = getProgressSummary(progressData);

// Real values
progressData.processedItems / progressData.totalItems
progressData.currentDataType
progressData.stage
progressData.message
```

#### 3. Data Type Counts (Lines 1015-1059)
**Current Static Values:**
```svelte
<div class="text-sm font-semibold">245</div> <!-- Groups -->
<div class="text-sm font-semibold">1,423</div> <!-- Projects -->
<div class="text-sm font-semibold">8,765</div> <!-- Issues -->
<div class="text-sm font-semibold">45,231</div> <!-- Commits -->
```

**Real Data Source:**
- Statistics API for areas
- Progress data `itemsByType` field
- Aggregated job progress data

**Replacement Strategy:**
```javascript
// From statistics API
statistics.areas.groups
statistics.areas.projects

// From progress data aggregation
progressData.itemsByType.groups
progressData.itemsByType.projects  
progressData.itemsByType.issues
progressData.itemsByType.mergeRequests
progressData.itemsByType.commits
```

#### 4. Processing Rate (Lines 1062-1073)
**Current Static Values:**
```svelte
<div class="text-sm font-semibold">~125/min</div>
<div class="text-xs text-muted-foreground">Estimated completion: 2-3 hours remaining</div>
```

**Real Data Source:**
- Progress timeline data
- Job timestamps and processed counts
- Real-time calculation from socket updates

**Replacement Strategy:**
```javascript
// Calculate from progress timeline
const recentEvents = progressData.timeline?.slice(-10) || [];
const timeSpan = // calculate from timestamps
const itemsProcessed = // calculate from progress updates
const rate = itemsProcessed / timeSpan;

// Estimate completion
const remaining = progressData.totalItems - progressData.processedItems;
const estimatedTime = remaining / rate;
```

#### 5. Current Job Information (Lines 706-714)
**Current Static Values:**
```svelte
<div class="text-sm font-mono bg-muted rounded p-2">
  {crawlerStatus.currentJobId || "[none]"}
</div>
```

**Real Data Source:**
- Currently running jobs from database
- Socket `statusUpdate` with current job info

**Replacement Strategy:**
```javascript
// Query for currently running jobs
const runningJobs = await db.select().from(job)
  .where(eq(job.status, JobStatus.running))
  .limit(1);

const currentJobId = runningJobs[0]?.id;
const currentJobProgress = extractProgressData(runningJobs[0]?.progress);
```

### ❌ Remove - No Real Data Available

#### 1. Real-time Activity Feed (Lines 1114-1133)
**Static Content:**
```svelte
<div class="flex items-center gap-2 text-xs p-2 bg-green-50 rounded">
  <CheckCircle class="h-3 w-3 text-green-600" />
  <span class="flex-1">Completed processing project "frontend-app"</span>
  <span class="text-muted-foreground">2s ago</span>
</div>
```

**Issue:** No real-time activity stream available in current data sources. Would require:
- Enhanced socket messages with detailed activity events
- Activity logging in crawler with event streaming

**Recommendation:** Remove this section entirely or replace with job failure logs (which are available).

#### 2. Specific Project Names (Lines 1120, 1125, 1130)
**Static Content:**
```svelte
<span class="flex-1">Completed processing project "frontend-app"</span>
<span class="flex-1">Collecting issues from "backend-api"</span>
<span class="flex-1">Discovered 45 new projects in group "development"</span>
```

**Issue:** No specific project names are available in real-time socket messages.

**Recommendation:** Replace with generic messages or remove activity feed.

#### 3. Detailed Processing Stages (Lines 982-998)
**Static Content:**
```svelte
<div class="flex items-center gap-2 p-2 rounded border">
  <GitBranch class="h-4 w-4 text-blue-600" />
  <div class="text-xs">
    <div class="font-medium">Discovery</div>
    <div class="text-muted-foreground">Groups & Projects</div>
  </div>
</div>
```

**Issue:** While `operationType` is available in progress data, the specific stage breakdown shown is static.

**Recommendation:** Simplify to show only current `operationType` and `stage` from progress data.

### 🔄 Partially Available - Requires Enhancement

#### 1. Processing Rate Display (Lines 1137-1147)
**Current Static Values:**
```svelte
<span class="font-semibold">~85 items/min</span>
<div class="text-muted-foreground">Average over last 5 minutes</div>
```

**Available Data:** Progress data with timestamps
**Missing:** Windowed rate calculation

**Enhancement Needed:** Implement rate calculation from progress timeline events.

## Implementation Recommendations

### Phase 1: Replace Basic Metrics
1. Connect job status counts to real database/socket data
2. Replace static progress percentages with calculated values
3. Show real current job ID and basic progress

### Phase 2: Enhanced Progress Tracking
1. Implement progress data aggregation across all active jobs
2. Add real-time rate calculations
3. Show accurate data type counts from progress data

### Phase 3: Remove Static Content
1. Remove fake activity feed
2. Remove static project names
3. Simplify processing stages to show only available data

### Phase 4: Real-time Enhancements
1. Enhance socket messages to include more detailed progress events
2. Add activity logging to crawler for real activity feed
3. Implement windowed performance metrics

## Data Binding Strategy

### Socket-First Approach
```javascript
// Primary: Real-time socket data
crawlerStatus = message.payload; // from statusUpdate

// Secondary: Database fallback
if (!crawlerStatus) {
  crawlerStatus = await fetchCrawlerStatus();
}

// Tertiary: Statistics API
const stats = await fetchStatistics();
```

### Progress Data Integration
```javascript
// Aggregate progress from all active jobs
const activeJobs = await db.select().from(job)
  .where(inArray(job.status, [JobStatus.running, JobStatus.paused]));

const aggregatedProgress = activeJobs.reduce((acc, job) => {
  const progress = extractProgressData(job.progress);
  return mergeProgressData(acc, progress);
}, {});
```

### Cache Strategy
```javascript
// Use existing crawler cache for immediate display
const cache = getCachedStatus();
// Update cache with new socket data
updateCrawlerStatus(newStatus);
```

## Conclusion

**Can Replace:** ~70% of static placeholders have real data sources available
**Should Remove:** ~20% of static content has no corresponding real data
**Needs Enhancement:** ~10% requires additional implementation

The crawler dashboard can be significantly improved by connecting to available real data sources, with the main limitations being the lack of detailed real-time activity feeds and specific project-level information in socket messages.