# GitLab Crawler API v2 (`/api/internal2/`)

This document describes the new GitLab Crawler API system that provides enhanced communication between the GitLab crawler and the main application server.

## Overview

The `/api/internal2/` API system is designed to:

- Support both HTTP and WebSocket communication protocols
- Provide real-time task progress updates and status monitoring
- Handle GitLab crawler task management with enhanced error handling
- Maintain compatibility with existing job management systems
- Support message queuing and reliable delivery
- Implement comprehensive authentication and rate limiting

## Architecture

### Core Components

1. **Connection Management** (`/connect`) - WebSocket connection establishment
2. **Task Management** (`/tasks`) - HTTP-based task operations 
3. **Individual Task Operations** (`/tasks/[taskId]`) - CRUD operations for specific tasks
4. **Progress Updates** (`/tasks/[taskId]/progress`) - Real-time progress reporting
5. **WebSocket Streams** (`/tasks/[taskId]/websocket`) - Task-specific WebSocket connections
6. **Health Monitoring** (`/health`) - System health and status checks

### Authentication

The API supports multiple authentication methods:

- **Bearer Token**: Using `CRAWLER_API_TOKEN` in `Authorization: Bearer <token>` header
- **Socket Request Bypass**: Internal communication via `locals.isSocketRequest`
- **Admin Bypass**: Administrative access via `isAdmin(locals)`
- **Query Parameter**: Token in URL query string for WebSocket connections

## API Endpoints

### 1. Connection Management

#### `GET /api/internal2/connect`
WebSocket upgrade endpoint for establishing persistent connections.

**Query Parameters:**
- `token` - Authentication token (for WebSocket auth)
- `connectionId` - Optional client-provided connection identifier

**Response:**
```json
{
  "status": "connection_ready",
  "connectionId": "conn-12345",
  "message": "WebSocket connection established",
  "serverCapabilities": {
    "messageQueuing": true,
    "heartbeat": true,
    "reconnection": true,
    "protocolVersion": "1.0"
  }
}
```

#### `POST /api/internal2/connect`
Get connection information and server capabilities.

**Request Body:**
```json
{
  "connectionId": "optional-client-id",
  "clientType": "gitlab-crawler",
  "version": "1.0.0"
}
```

**Response:**
```json
{
  "status": "ready",
  "connectionInfo": {
    "connectionId": "conn-12345",
    "serverTime": "2025-01-29T23:00:00.000Z",
    "activeConnections": 5,
    "maxConnections": 100,
    "supportedProtocols": ["gitlab-crawler-v1"],
    "heartbeatInterval": 30000
  },
  "endpoints": {
    "websocket": "/api/internal2/connect",
    "tasks": "/api/internal2/tasks",
    "health": "/api/internal2/health"
  }
}
```

### 2. Task Management

#### `GET /api/internal2/tasks`
Retrieve list of tasks with filtering and pagination.

**Query Parameters:**
- `status` - Filter by task status (`queued`, `running`, `completed`, `failed`, `paused`)
- `type` - Filter by GitLab task type
- `limit` - Maximum number of results (default: 10, max: 100)
- `offset` - Pagination offset (default: 0)

**Response:**
```json
{
  "data": [
    {
      "id": "task-12345",
      "type": "FETCH_PROJECT_DETAILS",
      "status": "running",
      "createdAt": "2025-01-29T22:00:00.000Z",
      "startedAt": "2025-01-29T22:01:00.000Z",
      "progress": {
        "processed": 45,
        "total": 100,
        "currentStep": "Fetching project members"
      }
    }
  ],
  "meta": {
    "total": 1,
    "limit": 10,
    "offset": 0,
    "hasMore": false
  }
}
```

#### `POST /api/internal2/tasks`
Create a new task.

**Request Body:**
```json
{
  "type": "task",
  "data": {
    "id": "task-12345",
    "type": "FETCH_PROJECT_DETAILS",
    "credentials": {
      "accessToken": "glpat-xxxxxxxxxxxxxxxxxxxx",
      "refreshToken": "optional-refresh-token"
    },
    "apiEndpoint": "https://gitlab.example.com/api/v4",
    "options": {
      "resourceId": "project-123",
      "resourceType": "project",
      "pagination": {
        "pageSize": 100
      }
    }
  }
}
```

### 3. Individual Task Operations

#### `GET /api/internal2/tasks/[taskId]`
Get detailed information about a specific task.

#### `PUT /api/internal2/tasks/[taskId]`
Update task status or progress.

**Request Body:**
```json
{
  "status": "completed",
  "progress": {
    "processed": 100,
    "total": 100,
    "currentStep": "Task completed successfully"
  }
}
```

#### `DELETE /api/internal2/tasks/[taskId]`
Cancel or delete a task.

### 4. Progress Updates

#### `POST /api/internal2/tasks/[taskId]/progress`
Submit progress update for a specific task.

**Request Body:**
```json
{
  "type": "progress",
  "processed": 75,
  "total": 100,
  "currentStep": "Processing merge requests",
  "percentage": 75,
  "message": "75% complete - processing merge requests",
  "timestamp": "2025-01-29T23:00:00.000Z"
}
```

#### `GET /api/internal2/tasks/[taskId]/progress`
Retrieve current progress information for a task.

### 5. Task WebSocket Connections

#### `GET /api/internal2/tasks/[taskId]/websocket`
Establish WebSocket connection for real-time task updates.

#### `POST /api/internal2/tasks/[taskId]/websocket`
Send message to all WebSocket connections for a specific task.

### 6. Health Monitoring

#### `GET /api/internal2/health`
Get system health status.

**Query Parameters:**
- `details=true` - Include detailed health information (requires authentication)

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-29T23:00:00.000Z",
  "version": "1.0.0",
  "uptime": 86400,
  "services": {
    "database": {
      "status": "up",
      "responseTime": 15
    },
    "authentication": {
      "status": "up",
      "configured": true
    },
    "jobProcessor": {
      "status": "up",
      "activeJobs": 5,
      "queuedJobs": 12,
      "failedJobs": 2,
      "recentCompletions": 15
    },
    "websockets": {
      "status": "up",
      "activeConnections": 3,
      "supportEnabled": true
    }
  }
}
```

#### `POST /api/internal2/health`
Trigger health check operations.

**Request Body:**
```json
{
  "operation": "deep_check"
}
```

## Message Protocol

### GitLab Task Types

The API supports the following GitLab task types:

- `DISCOVER_AREAS` - Discover all groups and projects
- `FETCH_PROJECTS` - Fetch project listings
- `FETCH_GROUPS` - Fetch group listings  
- `FETCH_PROJECT_DETAILS` - Fetch detailed project information
- `FETCH_GROUP_DETAILS` - Fetch detailed group information
- `FETCH_PROJECT_MEMBERS` - Fetch project members
- `FETCH_GROUP_MEMBERS` - Fetch group members
- `FETCH_ISSUES` - Fetch project issues
- `FETCH_MERGE_REQUESTS` - Fetch merge requests
- `FETCH_COMMITS` - Fetch commit history
- `FETCH_BRANCHES` - Fetch branch information
- `FETCH_TAGS` - Fetch tag information
- `FETCH_PIPELINES` - Fetch CI/CD pipelines
- `FETCH_JOBS` - Fetch CI/CD jobs
- `FETCH_DEPLOYMENTS` - Fetch deployment information
- `FETCH_ENVIRONMENTS` - Fetch environment information
- `FETCH_VULNERABILITIES` - Fetch security vulnerabilities

### Update Types

Progress and status updates support these types:

- `progress` - Incremental progress update
- `status` - Status change notification
- `error` - Error reporting
- `completed` - Task completion
- `failed` - Task failure
- `started` - Task initiation
- `paused` - Task paused
- `resumed` - Task resumed

## Error Handling

The API implements comprehensive error handling:

### HTTP Status Codes

- `200` - Success
- `201` - Created (for new tasks)
- `400` - Bad Request (invalid payload)
- `401` - Unauthorized (invalid/missing authentication)
- `404` - Not Found (task not found)
- `409` - Conflict (task already exists)
- `500` - Internal Server Error
- `503` - Service Unavailable (missing configuration)

### Error Response Format

```json
{
  "error": "Task not found",
  "status": 404,
  "timestamp": "2025-01-29T23:00:00.000Z",
  "details": {
    "taskId": "task-12345",
    "requestId": "req-67890"
  }
}
```

## Integration with Existing Systems

The API maintains compatibility with the existing job management system:

- **Job Manager Integration**: Uses existing `handleNewArea()` and job creation functions
- **Database Schema**: Compatible with current `job`, `area`, and `account` tables
- **Authentication**: Integrates with existing `CRAWLER_API_TOKEN` and admin system
- **Logging**: Uses existing logging infrastructure
- **Error Handling**: Follows existing error handling patterns

## Security Considerations

1. **Authentication Required**: All endpoints require valid authentication
2. **Rate Limiting**: Built-in rate limiting and request validation
3. **Input Validation**: Comprehensive input sanitization and validation
4. **Socket Request Bypass**: Secure internal communication mechanism
5. **Admin Access Controls**: Proper admin privilege checks

## Usage Examples

### Python GitLab Crawler Integration

```python
import requests
import websocket
import json

class GitLabCrawlerAPI:
    def __init__(self, base_url, api_token):
        self.base_url = base_url
        self.headers = {
            'Authorization': f'Bearer {api_token}',
            'Content-Type': 'application/json'
        }
    
    def create_task(self, task_data):
        response = requests.post(
            f'{self.base_url}/api/internal2/tasks',
            headers=self.headers,
            json=task_data
        )
        return response.json()
    
    def update_progress(self, task_id, progress_data):
        response = requests.post(
            f'{self.base_url}/api/internal2/tasks/{task_id}/progress',
            headers=self.headers,
            json=progress_data
        )
        return response.json()
    
    def get_health(self):
        response = requests.get(
            f'{self.base_url}/api/internal2/health',
            headers=self.headers
        )
        return response.json()
```

### WebSocket Connection

```javascript
const ws = new WebSocket('ws://localhost:5173/api/internal2/connect?token=your-api-token');

ws.onopen = function() {
    console.log('Connected to GitLab Crawler API');
};

ws.onmessage = function(event) {
    const message = JSON.parse(event.data);
    console.log('Received:', message);
};

ws.onerror = function(error) {
    console.error('WebSocket error:', error);
};
```

## Migration from `/api/internal/`

The new API system is designed to complement and eventually replace the existing `/api/internal/` endpoints:

### Key Improvements

1. **Enhanced Message Protocol**: Support for 17 GitLab task types vs limited command set
2. **Real-time Communication**: WebSocket support for live updates
3. **Better Error Handling**: Comprehensive error reporting and recovery
4. **Health Monitoring**: Built-in system health and performance monitoring
5. **Type Safety**: Full TypeScript definitions for all message formats
6. **Scalability**: Support for message queuing and connection management

### Migration Strategy

1. **Phase 1**: Deploy new API alongside existing system
2. **Phase 2**: Update GitLab crawler to use new endpoints
3. **Phase 3**: Migrate existing functionality to new protocol
4. **Phase 4**: Deprecate old `/api/internal/` endpoints

The new system maintains backward compatibility during the transition period.