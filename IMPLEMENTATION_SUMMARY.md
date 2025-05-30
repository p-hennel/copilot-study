# Connection Loss and Job Reset Implementation

## Overview
This implementation addresses two key requirements:
1. **Job Reset on Connection Loss**: When the connection to a crawler is lost, all jobs currently set to "running" are automatically reset to "queued" status to prevent them from being stuck.
2. **Immediate Socket Listening**: The web application/backend starts listening on the socket immediately when it starts, without depending on user webpage access.

## Implementation Details

### 1. Job Reset on Connection Loss

#### MessageBusClient Changes (`src/lib/messaging/MessageBusClient.ts`)
- Added `resetRunningJobsToQueued()` method that updates all running jobs to queued status
- Integrated job reset into connection loss handlers:
  - `close` event handler: Resets jobs when socket closes
  - `error` event handler: Resets jobs when socket errors occur
- Imports database functionality for direct job management

#### Supervisor Changes (`src/lib/server/supervisor.ts`)
- Added `resetRunningJobsOnDisconnect()` function for job reset functionality
- Enhanced disconnection handler to reset jobs when IPC connection is lost
- Added heartbeat monitoring with extended timeout detection:
  - Monitors heartbeat every 30 seconds (HEARTBEAT_TIMEOUT / 2)
  - Resets jobs if no heartbeat for 120 seconds (2x HEARTBEAT_TIMEOUT)

#### Key Features
- **Duplicate Protection**: Both MessageBusClient and Supervisor can reset jobs, ensuring coverage in different failure scenarios
- **Proper Status Management**: Jobs are reset to `queued` status with `started_at` cleared
- **Comprehensive Logging**: All reset operations are logged for monitoring and debugging
- **Error Handling**: Graceful handling of database errors during reset operations

### 2. Immediate Socket Listening

#### Startup Initialization (`src/lib/startup/initialize.ts`)
- New initialization module that:
  - Imports MessageBusClient to trigger immediate connection attempt
  - Imports supervisor module to set up event listeners
  - Adds connection event logging for monitoring
  - Auto-initializes when the module is imported

#### Server Hooks Integration (`src/hooks.server.ts`)
- Added import of initialization module at the top level
- Ensures initialization runs as soon as the server starts
- No dependency on user webpage access

#### Connection Behavior
- **Immediate Connection**: Socket connection attempts start immediately on server startup
- **Graceful Degradation**: Server continues to run even if crawler connection fails
- **Auto-Reconnection**: Exponential backoff reconnection with jitter
- **Connection Monitoring**: Real-time logging of connection status changes

## Job Status Flow

```
Running Job + Connection Loss → Queued Job
├── Socket Close Event → resetRunningJobsToQueued()
├── Socket Error Event → resetRunningJobsToQueued()
├── IPC Disconnection → resetRunningJobsOnDisconnect()
└── Heartbeat Timeout → resetRunningJobsOnDisconnect()
```

## Benefits

### Reliability
- **No Stuck Jobs**: Jobs automatically return to queue when connection is lost
- **Multiple Safeguards**: Different layers of protection against connection failures
- **Consistent State**: Database always reflects actual job processing status

### Performance
- **Immediate Availability**: Socket listening starts with server, not on first user access
- **Efficient Recovery**: Quick job reset operations with minimal database impact
- **Resource Management**: Proper cleanup of connection resources

### Monitoring
- **Comprehensive Logging**: All connection events and job resets are logged
- **Status Visibility**: Clear indicators of connection status and job state changes
- **Debug Support**: Detailed console output for troubleshooting

## Files Modified

1. **`src/lib/messaging/MessageBusClient.ts`**
   - Added job reset functionality
   - Enhanced error handling

2. **`src/lib/server/supervisor.ts`**
   - Added connection loss detection
   - Implemented heartbeat monitoring

3. **`src/lib/startup/initialize.ts`** (New)
   - Application initialization module

4. **`src/hooks.server.ts`**
   - Added initialization import

5. **`src/test-connection-handling.ts`** (New)
   - Test script for verifying functionality

## Testing

The implementation includes a test script (`src/test-connection-handling.ts`) that can be run to verify:
- Current job status distribution
- Job reset functionality
- Database state after reset operations

Run with: `bun run src/test-connection-handling.ts`

## Configuration

The implementation respects existing environment variables:
- `SUPERVISOR_SOCKET_PATH`: Primary socket path
- `SOCKET_PATH`: Fallback socket path
- `SUPERVISED`: Controls supervised mode behavior

## Error Handling

- **Database Errors**: Gracefully handled with logging, don't crash the application
- **Connection Errors**: Logged and trigger reconnection attempts
- **Missing Dependencies**: Safe fallbacks when components aren't available

This implementation ensures robust job management and reliable crawler communication while maintaining backward compatibility with existing functionality.