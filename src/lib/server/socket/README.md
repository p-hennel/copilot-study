# Socket Communication System

This directory contains a comprehensive socket communication system for integrating with the crawler system. The architecture is designed to be production-ready, scalable, and maintainable.

## Directory Structure

```
socket/
├── types/                  # TypeScript type definitions
│   ├── messages.ts         # Message protocol types (mirrors crawler)
│   ├── database.ts         # Database integration types
│   ├── config.ts           # Configuration types
│   ├── connection.ts       # Connection management types
│   ├── progress.ts         # Progress tracking types
│   ├── errors.ts           # Error handling types
│   └── index.ts            # Type exports
├── connection/             # Socket connection management
├── protocol/               # Message protocol handling
├── handlers/               # Message type-specific handlers
├── persistence/            # Database integration layers
├── progress/               # Progress tracking implementation
├── utils/                  # Utility functions
├── config.ts               # Configuration management
├── socket-server.ts        # Core socket server class
├── message-router.ts       # Message routing infrastructure
└── index.ts                # Main exports
```

## Key Features

### 1. Type Safety
- Complete TypeScript type definitions that mirror the crawler's message protocol
- Compatible with existing database schema (Job, Area, Account tables)
- Extensible type system for web application specific needs

### 2. Connection Management
- Unix domain socket server for crawler communication
- Connection pooling and lifecycle management
- Heartbeat monitoring and automatic reconnection
- Connection authentication and authorization

### 3. Message Protocol
- Full compatibility with crawler message protocol
- Message validation and transformation
- Routing infrastructure with middleware support
- Error handling and retry mechanisms

### 4. Progress Tracking
- Real-time progress monitoring across multiple jobs
- Progress aggregation and reporting
- Performance metrics and throughput tracking
- Progress persistence and resume capabilities

### 5. Database Integration
- Job lifecycle management
- Progress state persistence
- Error logging and recovery
- Connection state tracking

### 6. Error Handling
- Comprehensive error categorization and severity levels
- Error recovery strategies
- Notification system for critical errors
- Error aggregation and reporting

## Configuration

The system supports environment-specific configuration:

```typescript
import { SocketServer, createDefaultRouter } from '$lib/server/socket';

const server = new SocketServer({
  socketPath: '/tmp/crawler.sock',
  maxConnections: 5,
  heartbeatInterval: 30000,
  logLevel: 'info'
});

await server.start();
```

Environment variables:
- `SOCKET_PATH`: Unix socket path
- `SOCKET_MAX_CONNECTIONS`: Maximum concurrent connections
- `SOCKET_LOG_LEVEL`: Logging level (debug, info, warn, error)
- `SOCKET_HEARTBEAT_INTERVAL`: Heartbeat interval in milliseconds

## Usage Examples

### Basic Server Setup
```typescript
import { createSocketServer, createDefaultRouter } from '$lib/server/socket';

const server = createSocketServer({
  socketPath: process.env.SOCKET_PATH || '/tmp/crawler.sock'
});

await server.start();
console.log('Socket server started');
```

### Custom Message Handler
```typescript
import { MessageRouter, type MessageHandler } from '$lib/server/socket';

class CustomJobHandler implements MessageHandler {
  canHandle(message) {
    return message.type === 'custom_job_event';
  }
  
  async handle(message, connection) {
    // Handle custom job logic
    return { success: true };
  }
  
  getPriority() {
    return 50;
  }
}

const router = createDefaultRouter();
router.registerHandler('custom_job_event', new CustomJobHandler());
```

### Progress Monitoring
```typescript
const server = createSocketServer();
await server.start();

// Get aggregate progress across all jobs
const progress = server.getAggregateProgress();
console.log(`Overall completion: ${progress?.overall_completion * 100}%`);
```

## Integration with Crawler

The socket system is designed to work seamlessly with the crawler's existing communication protocol:

1. **Message Compatibility**: All message types from `crawlz/src/communication/message-protocol.ts` are supported
2. **Socket Path**: Uses the same Unix domain socket approach as the test server
3. **Protocol**: Newline-delimited JSON message format
4. **Heartbeat**: Compatible heartbeat mechanism for connection monitoring

## Development

### Adding Custom Handlers
1. Implement the `MessageHandler` interface
2. Register with the message router
3. Handle the specific message type logic

### Adding Middleware
1. Implement the `MessageMiddleware` interface
2. Add to the router with appropriate priority
3. Handle pre/post processing logic

### Database Integration
1. Extend the database operations interfaces
2. Implement persistence layers for new data types
3. Add appropriate cleanup and maintenance routines

## Testing

The system includes comprehensive type definitions and interfaces to support testing:

```typescript
// Test configuration
const testConfig = {
  socketPath: '/tmp/test-crawler.sock',
  maxConnections: 1,
  logLevel: 'warn' as const
};

const server = createSocketServer(testConfig);
```

## Production Deployment

For production deployment:

1. Configure appropriate socket paths and permissions
2. Set up monitoring and alerting for connection health
3. Configure database connection pooling
4. Set up log aggregation and error reporting
5. Monitor resource usage and performance metrics

## Future Enhancements

The architecture supports future enhancements:

- WebSocket support for real-time web client updates
- Load balancing across multiple crawler instances
- Advanced retry and circuit breaker patterns
- Metrics collection and monitoring integration
- Distributed job queue management