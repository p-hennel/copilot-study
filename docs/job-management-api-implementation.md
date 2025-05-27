# Job Management API Implementation

## Overview
This document describes the implemented API endpoints for job management based on the architectural plan.

## Implemented Endpoints

### 1. Enhanced `/api/admin/jobs/+server.ts`

#### GET Method (Existing - Enhanced with error handling)
- **Purpose**: Fetch all jobs with detailed information
- **Auth**: Admin role required
- **Response**: Array of jobs with provider information, child counts, and related data
- **Error Handling**: Proper try-catch with 500 status on database errors

#### DELETE Method (New)
- **Purpose**: Delete individual jobs by ID
- **Auth**: Admin role required
- **Input Options**:
  - URL parameter: `?id=<job_id>`
  - Request body: `{ "id": "<job_id>" }`
- **Response**: Success message with deleted job details
- **Error Handling**: 404 if job not found, 500 on database errors
- **Logging**: Admin actions logged with user email

#### POST Method (New)
- **Purpose**: Bulk job operations
- **Auth**: Admin role required
- **Supported Actions**:
  
  **bulk_delete**:
  ```json
  {
    "action": "bulk_delete",
    "jobIds": ["job1", "job2", "job3"]
  }
  ```
  
  **bulk_delete_filtered**:
  ```json
  {
    "action": "bulk_delete_filtered",
    "filters": {
      "status": "failed",
      "provider": "gitlab-cloud",
      "dateFrom": "2024-01-01"
    }
  }
  ```
- **Transaction Handling**: All bulk operations use database transactions
- **Response**: Count of deleted jobs and detailed results
- **Logging**: Admin actions logged with applied filters

### 2. New `/api/admin/jobs/bulk/+server.ts`

#### POST Method
- **Purpose**: Advanced bulk deletion with comprehensive filtering
- **Auth**: Admin role required
- **Safety**: Requires `confirm: true` in request body
- **Available Filters**:
  - `status`: JobStatus enum (queued, running, paused, failed, finished)
  - `provider`: TokenProvider enum (jira, jiraCloud, gitlab, gitlabCloud)
  - `dateFrom`: ISO date string (jobs created after this date)
  - `dateTo`: ISO date string (jobs created before this date)
  - `command`: CrawlCommand enum
  - `accountId`: Account ID string
- **Example Request**:
  ```json
  {
    "confirm": true,
    "filters": {
      "status": "failed",
      "provider": "gitlab-cloud",
      "dateFrom": "2024-01-01",
      "dateTo": "2024-12-31"
    }
  }
  ```
- **Transaction Handling**: Uses database transactions for atomicity
- **Response**: Detailed results with applied filters
- **Error Handling**: Requires at least one filter condition

#### DELETE Method
- **Purpose**: Delete ALL jobs (nuclear option)
- **Auth**: Admin role required
- **Safety Checks**:
  - Requires `confirm: true`
  - Requires `confirmPhrase: "DELETE ALL JOBS"`
- **Example Request**:
  ```json
  {
    "confirm": true,
    "confirmPhrase": "DELETE ALL JOBS"
  }
  ```
- **Transaction Handling**: Uses database transactions
- **Response**: Count of all deleted jobs with warning message
- **Logging**: Explicit logging of complete job deletion

## Implementation Features

### Authentication & Authorization
- All endpoints check for valid session
- All endpoints verify admin role (`locals.user.role !== "admin"`)
- Consistent 401 Unauthorized responses for invalid access

### Error Handling
- Comprehensive try-catch blocks
- Appropriate HTTP status codes (400, 401, 404, 500)
- Detailed error messages
- Database error logging

### Transaction Support
- All bulk operations use Drizzle ORM transactions
- Ensures atomicity for multi-row operations
- Rollback on any operation failure

### Logging
- Admin action logging with user email
- Operation details logged (filters, counts, etc.)
- Console logging for audit trail

### Type Safety
- Full TypeScript implementation
- Proper RequestEvent typing
- Type-safe database operations with Drizzle ORM
- Enum validation for status and provider filters

### Database Operations
- Uses existing Drizzle ORM patterns
- Leverages indexed columns for efficient filtering
- Cascade handling through existing foreign key constraints
- Returns detailed operation results

## API Usage Examples

### Delete Single Job
```bash
# Via URL parameter
DELETE /api/admin/jobs?id=job_12345

# Via request body
DELETE /api/admin/jobs
Content-Type: application/json
{
  "id": "job_12345"
}
```

### Bulk Delete Specific Jobs
```bash
POST /api/admin/jobs
Content-Type: application/json
{
  "action": "bulk_delete",
  "jobIds": ["job_1", "job_2", "job_3"]
}
```

### Bulk Delete with Filters
```bash
POST /api/admin/jobs
Content-Type: application/json
{
  "action": "bulk_delete_filtered",
  "filters": {
    "status": "failed",
    "provider": "gitlab-cloud"
  }
}
```

### Advanced Bulk Operations
```bash
POST /api/admin/jobs/bulk
Content-Type: application/json
{
  "confirm": true,
  "filters": {
    "status": "failed",
    "dateFrom": "2024-01-01",
    "dateTo": "2024-06-30"
  }
}
```

### Delete All Jobs (Nuclear Option)
```bash
DELETE /api/admin/jobs/bulk
Content-Type: application/json
{
  "confirm": true,
  "confirmPhrase": "DELETE ALL JOBS"
}
```

## Security Considerations

1. **Admin-Only Access**: All endpoints restricted to admin users
2. **Confirmation Requirements**: Bulk operations require explicit confirmation
3. **Audit Logging**: All admin actions logged with user identification
4. **Input Validation**: Type checking and enum validation
5. **Transaction Safety**: Database consistency through transactions
6. **Error Information**: Limited error details to prevent information disclosure

## Notes

- All endpoints maintain compatibility with existing auth patterns
- Database schema constraints handle cascade operations automatically
- Response formats follow existing API conventions
- Error handling patterns match other admin endpoints
- TypeScript implementation ensures compile-time safety