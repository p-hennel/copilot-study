# Progress Tracking Validation Guide

This guide provides comprehensive validation procedures to ensure the enhanced progress tracking system is working correctly after implementation. Use these tests to verify functionality, performance, and reliability.

## Table of Contents

1. [Validation Overview](#validation-overview)
2. [Pre-Validation Checklist](#pre-validation-checklist)
3. [Validation Steps](#validation-steps)
4. [Sample Test Data](#sample-test-data)
5. [Performance Validation](#performance-validation)
6. [Troubleshooting Guide](#troubleshooting-guide)
7. [Automated Testing Scripts](#automated-testing-scripts)

## Validation Overview

### Validation Scope

The validation process covers:
- **API Endpoint Functionality**: Enhanced progress tracking endpoints
- **Data Accumulation Logic**: Intelligent progress merging and accumulation
- **Dashboard Integration**: Real-time updates and visualization
- **Timeline Events**: Audit trail creation and display
- **Error Handling**: Enhanced error reporting and context
- **Performance**: System responsiveness and resource usage
- **Backward Compatibility**: Legacy field support and migration

### Validation Phases

1. **Phase 1**: Basic API functionality and data flow
2. **Phase 2**: Enhanced features and accumulation logic
3. **Phase 3**: Dashboard integration and real-time updates
4. **Phase 4**: Performance and stress testing
5. **Phase 5**: End-to-end integration testing

## Pre-Validation Checklist

### Environment Setup
- [ ] Enhanced progress tracking API endpoints deployed
- [ ] Admin dashboard updated with progress visualization
- [ ] Test database with sample job records
- [ ] Valid API tokens configured for testing
- [ ] Test crawler or simulation tools prepared

### Configuration Verification
- [ ] API endpoint URLs accessible
- [ ] Authentication tokens valid and properly configured
- [ ] Database connections established
- [ ] SSE/WebSocket connections for real-time updates
- [ ] Logging configured for debugging

### Documentation Review
- [ ] [Progress Types Reference](./progress-types-reference.md) reviewed
- [ ] [Integration Checklist](./CRAWLER_INTEGRATION_CHECKLIST.md) completed
- [ ] [Implementation Examples](./crawler-implementation-examples.md) understood
- [ ] Test scenarios and expected outcomes documented

## Validation Steps

### Step 1: Basic API Functionality

#### 1.1 Verify Enhanced Progress Update Endpoint

**Test**: Send enhanced progress update to API
```bash
curl -X POST "https://your-app.com/api/internal2/tasks/test_job_001/progress" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "progress",
    "processedItems": 50,
    "totalItems": 200,
    "currentDataType": "issues",
    "itemsByType": {
      "issues": 25,
      "mergeRequests": 15,
      "commits": 10
    },
    "lastProcessedId": "issue_50",
    "stage": "data_collection",
    "operationType": "data_collection",
    "message": "Processing GitLab issues...",
    "timestamp": "2025-01-06T19:15:30.000Z"
  }'
```

**Expected Result**:
```json
{
  "data": {
    "taskId": "test_job_001",
    "status": "acknowledged",
    "message": "Progress update processed for task test_job_001",
    "timestamp": "2025-01-06T19:15:30.000Z",
    "currentStatus": "running"
  }
}
```

**Validation Criteria**:
- [ ] HTTP 200 response received
- [ ] Response contains expected structure
- [ ] Task status updated in database
- [ ] Progress data stored correctly

#### 1.2 Verify Legacy Compatibility

**Test**: Send legacy progress update
```bash
curl -X POST "https://your-app.com/api/internal2/tasks/test_job_002/progress" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "progress",
    "processed": 75,
    "total": 300,
    "groupCount": 5,
    "projectCount": 15,
    "message": "Legacy format test",
    "timestamp": "2025-01-06T19:16:00.000Z"
  }'
```

**Validation Criteria**:
- [ ] Legacy fields accepted without error
- [ ] Automatic mapping to enhanced fields works
- [ ] `processed` mapped to `processedItems`
- [ ] `total` mapped to `totalItems`
- [ ] Legacy counts preserved

#### 1.3 Verify Error Handling

**Test**: Send invalid progress update
```bash
curl -X POST "https://your-app.com/api/internal2/tasks/invalid_job/progress" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "progress"
  }'
```

**Validation Criteria**:
- [ ] Appropriate error response (400/404)
- [ ] Error message is descriptive
- [ ] No server crash or data corruption

### Step 2: Data Accumulation Verification

#### 2.1 Test Progress Accumulation Logic

**Test Sequence**: Send multiple progress updates to same job

**Update 1**:
```json
{
  "type": "progress",
  "processedItems": 25,
  "itemsByType": { "issues": 25 },
  "timestamp": "2025-01-06T19:20:00.000Z"
}
```

**Update 2**:
```json
{
  "type": "progress", 
  "processedItems": 50,
  "itemsByType": { "issues": 15, "mergeRequests": 10 },
  "timestamp": "2025-01-06T19:21:00.000Z"
}
```

**Expected Database State**:
```json
{
  "processedItems": 50,
  "itemsByType": {
    "issues": 40,
    "mergeRequests": 10
  }
}
```

**Validation Criteria**:
- [ ] `processedItems` uses latest value (50)
- [ ] `itemsByType.issues` accumulated (25 + 15 = 40)
- [ ] `itemsByType.mergeRequests` added correctly (10)
- [ ] No data loss or overwrites

#### 2.2 Test Timeline Event Creation

**Test**: Verify timeline events are created and accumulated
```bash
# Get job progress to check timeline
curl -X GET "https://your-app.com/api/internal2/tasks/test_job_001/progress" \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

**Validation Criteria**:
- [ ] Timeline events present in response
- [ ] Events in chronological order
- [ ] Event details contain relevant information
- [ ] Timeline doesn't exceed reasonable size (< 1000 events)

### Step 3: Dashboard Integration Testing

#### 3.1 Real-time Updates Verification

**Test Process**:
1. Open admin dashboard (`/admin/crawler`)
2. Start sending progress updates via API
3. Monitor dashboard for real-time changes

**Test Script**: Use automated progress updates
```javascript
// Send updates every 2 seconds
const sendProgressUpdates = async () => {
  for (let i = 1; i <= 100; i++) {
    await fetch('/api/internal2/tasks/dashboard_test/progress', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'progress',
        processedItems: i * 10,
        totalItems: 1000,
        itemsByType: { issues: 5, mergeRequests: 3, commits: 2 },
        stage: i < 50 ? 'data_collection' : 'finalization',
        message: `Processing batch ${i}/100`
      })
    });
    
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
};
```

**Validation Criteria**:
- [ ] Dashboard updates within 5 seconds of API call
- [ ] Progress bars update correctly
- [ ] Item type breakdowns display accurately
- [ ] Stage transitions are visible
- [ ] No UI freezing or performance issues

#### 3.2 Timeline Event Display

**Validation Criteria**:
- [ ] Timeline events appear in dashboard
- [ ] Events display in correct chronological order
- [ ] Event details are properly formatted
- [ ] Critical events (errors, stage changes) are highlighted
- [ ] Timeline scrolling works smoothly

#### 3.3 Progress Visualization

**Validation Criteria**:
- [ ] Progress percentages calculate correctly
- [ ] Visual progress bars match numerical values
- [ ] Item type charts display proportional data
- [ ] Color coding is consistent and meaningful
- [ ] Loading states display appropriately

### Step 4: Performance Validation

#### 4.1 API Performance Testing

**Test**: High-frequency progress updates
```bash
# Use Apache Bench or similar tool
ab -n 100 -c 10 -p progress_payload.json -T application/json \
   -H "Authorization: Bearer YOUR_API_TOKEN" \
   "https://your-app.com/api/internal2/tasks/perf_test/progress"
```

**Performance Targets**:
- [ ] API response time < 100ms (p95)
- [ ] Throughput > 50 requests/second
- [ ] 0% error rate under normal load
- [ ] Memory usage remains stable

#### 4.2 Dashboard Performance

**Test**: Monitor dashboard with high-frequency updates

**Performance Targets**:
- [ ] UI remains responsive during rapid updates
- [ ] Memory usage < 100MB in browser
- [ ] No visible lag in animations or transitions
- [ ] Updates processed without backlog

#### 4.3 Database Performance

**Test**: Monitor database during progress update stress test

**Performance Targets**:
- [ ] Query response time < 50ms
- [ ] No connection pool exhaustion
- [ ] Efficient index usage
- [ ] No deadlocks or timeouts

### Step 5: End-to-End Integration Testing

#### 5.1 Complete Crawler Simulation

**Test**: Run complete crawler simulation with enhanced tracking

```typescript
// Simulated crawler operation
class CrawlerSimulation {
  async runCompleteOperation() {
    const tracker = new EnhancedProgressTracker({
      apiEndpoint: 'https://your-app.com/api/internal2/tasks',
      apiToken: process.env.API_TOKEN,
      taskId: 'e2e_test_job'
    });
    
    // Discovery phase
    await tracker.changeStage('discovery', 'discovery');
    await this.simulateDiscovery(tracker);
    
    // Data collection phase
    await tracker.changeStage('data_collection', 'data_collection');
    await this.simulateDataCollection(tracker);
    
    // Finalization phase
    await tracker.changeStage('finalization', 'finalization');
    await tracker.markCompleted({
      total_processed: 500,
      summary: 'E2E test completed successfully'
    });
  }
  
  async simulateDiscovery(tracker: EnhancedProgressTracker) {
    for (let i = 1; i <= 50; i++) {
      await tracker.updateProgress({
        processedItems: i,
        totalItems: 50,
        currentDataType: 'areas',
        itemsByType: { 
          groups: Math.floor(i * 0.2), 
          projects: Math.floor(i * 0.8) 
        },
        lastProcessedId: `area_${i}`,
        message: `Discovered ${i}/50 areas`
      });
      
      await this.delay(200); // 200ms between updates
    }
  }
  
  async simulateDataCollection(tracker: EnhancedProgressTracker) {
    const dataTypes = ['issues', 'mergeRequests', 'commits'];
    
    for (let i = 1; i <= 450; i++) {
      const dataType = dataTypes[i % 3];
      
      await tracker.updateProgress({
        processedItems: i + 50, // Add discovery items
        totalItems: 500,
        currentDataType: dataType,
        itemsByType: { [dataType]: 1 },
        lastProcessedId: `${dataType}_${i}`,
        message: `Processing ${dataType}: ${i}/450`
      });
      
      await this.delay(100); // 100ms between updates
    }
  }
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

**Validation Criteria**:
- [ ] All stages complete successfully
- [ ] Progress accumulates correctly throughout operation
- [ ] Dashboard shows complete operation flow
- [ ] Timeline events capture all major milestones
- [ ] Final completion status is accurate

#### 5.2 Error Recovery Testing

**Test**: Simulate errors and recovery scenarios

```typescript
class ErrorRecoveryTest {
  async testRecoveryScenarios() {
    const tracker = new EnhancedProgressTracker({
      apiEndpoint: 'https://your-app.com/api/internal2/tasks',
      apiToken: process.env.API_TOKEN,
      taskId: 'error_recovery_test'
    });
    
    try {
      // Normal processing
      await this.processItems(tracker, 100);
      
      // Simulate error
      throw new Error('Simulated processing error');
      
    } catch (error) {
      // Report error with context
      await tracker.reportError(error as Error, {
        stage: 'data_collection',
        lastProcessedId: 'item_100',
        operationType: 'data_collection',
        additionalContext: {
          errorType: 'simulation',
          recoveryPossible: true
        }
      });
      
      // Simulate recovery
      await this.processItems(tracker, 200, 'item_100');
      
      // Mark as completed despite error
      await tracker.markCompleted({
        total_processed: 200,
        summary: 'Completed with error recovery'
      });
    }
  }
}
```

**Validation Criteria**:
- [ ] Error is properly recorded in timeline
- [ ] Recovery operation continues from correct point
- [ ] Error context provides useful debugging information
- [ ] Final status reflects successful recovery

## Sample Test Data

### Test Job Records

```sql
-- Insert test job records for validation
INSERT INTO jobs (id, status, created_at, progress) VALUES
('test_job_001', 'running', NOW(), '{}'),
('test_job_002', 'running', NOW(), '{}'),
('dashboard_test', 'running', NOW(), '{}'),
('perf_test', 'running', NOW(), '{}'),
('e2e_test_job', 'running', NOW(), '{}'),
('error_recovery_test', 'running', NOW(), '{}');
```

### Progress Update Payloads

#### Basic Enhanced Update
```json
{
  "type": "progress",
  "processedItems": 150,
  "totalItems": 500,
  "currentDataType": "issues",
  "itemsByType": {
    "issues": 25,
    "mergeRequests": 10,
    "commits": 15
  },
  "lastProcessedId": "issue_150",
  "stage": "data_collection", 
  "operationType": "data_collection",
  "message": "Processing GitLab issues...",
  "timestamp": "2025-01-06T19:15:30.000Z"
}
```

#### Discovery Update
```json
{
  "type": "progress",
  "processedItems": 25,
  "totalItems": 100,
  "currentDataType": "areas",
  "itemsByType": {
    "groups": 5,
    "projects": 20
  },
  "stage": "discovery",
  "operationType": "discovery",
  "message": "Discovering GitLab areas...",
  "timestamp": "2025-01-06T19:10:00.000Z"
}
```

#### Error Update
```json
{
  "type": "error",
  "error": "GitLab API rate limit exceeded",
  "errorTimestamp": "2025-01-06T19:25:00.000Z",
  "lastProcessedId": "issue_175",
  "stage": "data_collection",
  "operationType": "data_collection",
  "timeline": [{
    "timestamp": "2025-01-06T19:25:00.000Z",
    "event": "error",
    "details": {
      "errorType": "RateLimitError",
      "errorMessage": "GitLab API rate limit exceeded",
      "retryAfter": 3600,
      "context": {
        "endpoint": "/api/v4/projects/123/issues",
        "lastProcessedId": "issue_175"
      }
    }
  }],
  "timestamp": "2025-01-06T19:25:00.000Z"
}
```

#### Completion Update
```json
{
  "type": "completed",
  "processedItems": 500,
  "totalItems": 500,
  "stage": "completed",
  "message": "Operation completed successfully",
  "timeline": [{
    "timestamp": "2025-01-06T19:30:00.000Z",
    "event": "completion",
    "details": {
      "finalCounts": {
        "issues": 300,
        "mergeRequests": 150,
        "commits": 50
      },
      "duration": 1800000,
      "summary": "Successfully processed 500 items in 30 minutes"
    }
  }],
  "timestamp": "2025-01-06T19:30:00.000Z"
}
```

### Expected Dashboard Behavior

#### Progress Display
- **Progress Bar**: Shows 30% completion (150/500)
- **Item Breakdown**: 
  - Issues: 25 (green)
  - Merge Requests: 10 (blue)
  - Commits: 15 (orange)
- **Current Stage**: "Data Collection"
- **Last Update**: "2 minutes ago"

#### Timeline Events
1. **Stage Change**: "Transitioned to data_collection"
2. **Progress Update**: "Processed 150/500 items"
3. **Error**: "GitLab API rate limit exceeded"
4. **Completion**: "Operation completed successfully"

## Performance Validation

### Performance Benchmarks

#### API Performance Targets
| Metric | Target | Measurement Method |
|--------|--------|--------------------|
| Response Time (p95) | < 100ms | Load testing with 100+ requests |
| Throughput | > 50 req/sec | Concurrent request testing |
| Error Rate | < 1% | Stress testing over 10 minutes |
| Memory Usage | Stable | Monitor during extended testing |

#### Dashboard Performance Targets
| Metric | Target | Measurement Method |
|--------|--------|--------------------|
| Update Latency | < 5 seconds | Time from API call to UI update |
| UI Responsiveness | No lag | Interaction testing during updates |
| Memory Usage | < 100MB | Browser DevTools monitoring |
| Rendering Performance | 60 FPS | Performance profiling |

### Performance Testing Scripts

#### API Load Test
```bash
#!/bin/bash
# api_load_test.sh

echo "Starting API load test..."

# Create test payload
cat > progress_payload.json << EOF
{
  "type": "progress",
  "processedItems": 100,
  "totalItems": 1000,
  "itemsByType": {"issues": 10},
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
}
EOF

# Run load test
ab -n 1000 -c 20 -p progress_payload.json -T application/json \
   -H "Authorization: Bearer $API_TOKEN" \
   "$API_ENDPOINT/perf_test_job/progress"

echo "Load test completed."
```

#### Dashboard Performance Test
```javascript
// dashboard_perf_test.js
class DashboardPerformanceTest {
  async runPerformanceTest() {
    console.log('Starting dashboard performance test...');
    
    const startTime = performance.now();
    let updateCount = 0;
    
    // Send updates every 100ms for 1 minute
    const interval = setInterval(async () => {
      updateCount++;
      
      await fetch('/api/internal2/tasks/perf_dashboard_test/progress', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: 'progress',
          processedItems: updateCount * 10,
          totalItems: 6000,
          itemsByType: { 
            issues: Math.floor(Math.random() * 10),
            mergeRequests: Math.floor(Math.random() * 5)
          },
          timestamp: new Date().toISOString()
        })
      });
      
      // Stop after 1 minute
      if (updateCount >= 600) {
        clearInterval(interval);
        
        const duration = performance.now() - startTime;
        console.log(`Performance test completed in ${duration}ms`);
        console.log(`Sent ${updateCount} updates`);
        console.log(`Average rate: ${updateCount / (duration / 1000)} updates/sec`);
      }
    }, 100);
  }
}
```

## Troubleshooting Guide

### Common Validation Issues

#### Issue: API Returns 401 Unauthorized
**Diagnosis**:
```bash
# Check token validity
curl -H "Authorization: Bearer $API_TOKEN" \
     "$API_ENDPOINT/test_job/progress" \
     -v
```

**Solutions**:
- Verify API token is correct and not expired
- Check token has proper permissions
- Ensure Authorization header format is correct

#### Issue: Progress Data Not Accumulating
**Diagnosis**:
```sql
-- Check database progress data
SELECT id, progress FROM jobs WHERE id = 'test_job_001';
```

**Solutions**:
- Verify using enhanced fields (`processedItems`, `itemsByType`)
- Check API endpoint is using enhanced merging logic
- Ensure incremental updates for `itemsByType`

#### Issue: Dashboard Not Updating
**Diagnosis**:
```javascript
// Check browser console for errors
console.log('SSE connection status:', eventSource.readyState);

// Check network tab for failed requests
// Verify SSE connection is established
```

**Solutions**:
- Check SSE/WebSocket connection status
- Verify real-time update endpoints are working
- Clear browser cache and refresh
- Check for JavaScript errors in console

#### Issue: Performance Degradation
**Diagnosis**:
```bash
# Monitor system resources
top -p $(pgrep -f "your-app")

# Check API response times
curl -w "%{time_total}" -s -o /dev/null \
     -H "Authorization: Bearer $API_TOKEN" \
     "$API_ENDPOINT/test_job/progress"
```

**Solutions**:
- Check database query performance
- Monitor memory usage for leaks
- Optimize update frequency
- Consider batch processing

### Validation Failure Recovery

#### Database State Recovery
```sql
-- Reset test job to clean state
UPDATE jobs 
SET progress = '{}', status = 'queued' 
WHERE id LIKE 'test_%';

-- Clear timeline events if stored separately
DELETE FROM timeline_events 
WHERE job_id LIKE 'test_%';
```

#### Cache Clearing
```bash
# Clear application cache
redis-cli FLUSHDB

# Restart application services
systemctl restart your-app-service
```

## Automated Testing Scripts

### Complete Validation Suite

```bash
#!/bin/bash
# run_validation_suite.sh

set -e

echo "🚀 Starting Progress Tracking Validation Suite"

# Configuration
API_ENDPOINT="${API_ENDPOINT:-https://localhost:3000/api/internal2/tasks}"
API_TOKEN="${API_TOKEN:-your_test_token}"

# Test job IDs
TEST_JOBS=("validation_basic" "validation_accumulation" "validation_dashboard" "validation_performance")

echo "📋 Phase 1: Basic API Functionality"
./validate_api_basic.sh

echo "📈 Phase 2: Data Accumulation"
./validate_accumulation.sh

echo "🖥️  Phase 3: Dashboard Integration"
./validate_dashboard.sh

echo "⚡ Phase 4: Performance Testing"
./validate_performance.sh

echo "🔄 Phase 5: End-to-End Testing"
./validate_e2e.sh

echo "✅ Validation Suite Completed Successfully"
echo "📊 Check validation_report.html for detailed results"
```

### Individual Test Scripts

#### Basic API Validation
```bash
#!/bin/bash
# validate_api_basic.sh

echo "Testing basic API functionality..."

# Test enhanced progress update
RESPONSE=$(curl -s -w "%{http_code}" -o response.json \
  -X POST "$API_ENDPOINT/validation_basic/progress" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "progress",
    "processedItems": 50,
    "totalItems": 200,
    "itemsByType": {"issues": 25, "mergeRequests": 15},
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'"
  }')

if [ "$RESPONSE" = "200" ]; then
  echo "✅ Enhanced progress update successful"
else
  echo "❌ Enhanced progress update failed (HTTP $RESPONSE)"
  cat response.json
  exit 1
fi

# Test legacy compatibility
RESPONSE=$(curl -s -w "%{http_code}" -o response.json \
  -X POST "$API_ENDPOINT/validation_basic/progress" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "progress",
    "processed": 75,
    "total": 200,
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'"
  }')

if [ "$RESPONSE" = "200" ]; then
  echo "✅ Legacy compatibility successful"
else
  echo "❌ Legacy compatibility failed (HTTP $RESPONSE)"
  exit 1
fi

echo "Phase 1 completed successfully"
```

#### Accumulation Validation
```bash
#!/bin/bash
# validate_accumulation.sh

echo "Testing data accumulation logic..."

JOB_ID="validation_accumulation"

# Send first update
curl -s -X POST "$API_ENDPOINT/$JOB_ID/progress" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "progress",
    "itemsByType": {"issues": 25, "projects": 5},
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'"
  }'

sleep 1

# Send second update
curl -s -X POST "$API_ENDPOINT/$JOB_ID/progress" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "progress", 
    "itemsByType": {"issues": 15, "mergeRequests": 10},
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'"
  }'

sleep 1

# Verify accumulation
PROGRESS=$(curl -s -H "Authorization: Bearer $API_TOKEN" \
               "$API_ENDPOINT/$JOB_ID/progress")

# Check if issues accumulated to 40 (25 + 15)
ISSUES_COUNT=$(echo "$PROGRESS" | jq -r '.data.progress.itemsByType.issues // 0')

if [ "$ISSUES_COUNT" = "40" ]; then
  echo "✅ Data accumulation working correctly"
else
  echo "❌ Data accumulation failed - expected 40 issues, got $ISSUES_COUNT"
  echo "$PROGRESS" | jq '.'
  exit 1
fi

echo "Phase 2 completed successfully"
```

This comprehensive validation guide ensures that all aspects of the enhanced progress tracking system are thoroughly tested and verified before production deployment.