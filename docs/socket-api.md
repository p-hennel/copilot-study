# Socket Communication System – API Reference

This document provides a comprehensive API reference for the socket communication system, including public classes, configuration, message types, error handling, events, database integration, and usage examples.

---

## Table of Contents

- [Core Classes](#core-classes)
- [Configuration](#configuration)
- [Message Types](#message-types)
- [Error Handling](#error-handling)
- [Event System](#event-system)
- [Database Integration](#database-integration)
- [Performance Tuning](#performance-tuning)
- [Code Examples](#code-examples)

---

## Core Classes

### SocketServer

Main class for managing socket connections and message routing.

**Constructor:**
```typescript
import { SocketServer } from '$lib/server/socket';
const server = new SocketServer(config?: Partial<SocketServerConfig>);
```

- `config`: Partial configuration object (see [SocketServerConfig](../src/lib/server/socket/types/config.ts:2))

**Key Methods:**
- `start(): Promise<void>` – Starts the server.
- `stop(): Promise<void>` – Stops the server.
- `getStatus(): ServerStatus` – Returns server status ([ServerStatus](../src/lib/server/socket/API_REFERENCE.md#serverstatus)).
- `sendToCrawler(crawlerId: string, message: WebAppMessage): Promise<void>` – Sends a message to a specific crawler.
- `broadcast(message: WebAppMessage): Promise<void>` – Broadcasts to all crawlers.
- `getConnectionStats(): ConnectionStats` – Returns connection stats ([ConnectionStats](../src/lib/server/socket/types/connection.ts:33)).
- `getAggregateProgress(): AggregateProgress | null` – Aggregated job progress ([AggregateProgress](../src/lib/server/socket/types/progress.ts:215)).

### MessageRouter

Handles message routing and processing with middleware support.

**Constructor:**
```typescript
import { MessageRouter } from '$lib/server/socket/message-router';
const router = new MessageRouter();
```

**Key Methods:**
- `registerHandler(messageType: string, handler: MessageHandler): void`
- `addMiddleware(middleware: MessageMiddleware): void`
- `processMessage(message: CrawlerMessage, connection: SocketConnection): Promise<MessageProcessingResult>`

See [MessageHandler](../src/lib/server/socket/message-router.ts), [MessageMiddleware](../src/lib/server/socket/message-router.ts).

---

## Configuration

### SocketServerConfig

All configuration options are defined in [`types/config.ts`](../src/lib/server/socket/types/config.ts:2):

- `socketPath`, `host`, `port`, `maxConnections`, `heartbeatInterval`, `logLevel`, etc.
- See [DEFAULT_SOCKET_CONFIG](../src/lib/server/socket/types/config.ts:50) for defaults.
- Environment-specific configs: [ENVIRONMENT_CONFIGS](../src/lib/server/socket/types/config.ts:104)
- Validation: [validateConfig()](../src/lib/server/socket/types/config.ts:134)

**Environment Variables:**  
Override config via environment variables (e.g., `SOCKET_PATH`, `SOCKET_MAX_CONNECTIONS`, etc.).

---

## Message Types

All message schemas are defined in [`types/messages.ts`](../src/lib/server/socket/types/messages.ts):

### Crawler → Web App

- [`HeartbeatMessage`](../src/lib/server/socket/types/messages.ts:103)
- [`JobProgressMessage`](../src/lib/server/socket/types/messages.ts:122)
- [`JobsDiscoveredMessage`](../src/lib/server/socket/types/messages.ts:167)
- [`JobStartedMessage`](../src/lib/server/socket/types/messages.ts:114)
- [`JobCompletedMessage`](../src/lib/server/socket/types/messages.ts:140)
- [`JobFailedMessage`](../src/lib/server/socket/types/messages.ts:152)
- [`DiscoveryMessage`](../src/lib/server/socket/types/messages.ts:192)

### Web App → Crawler

- [`JobAssignmentMessage`](../src/lib/server/socket/types/messages.ts:198)
- [`TokenRefreshResponseMessage`](../src/lib/server/socket/types/messages.ts:211)
- [`ShutdownMessage`](../src/lib/server/socket/types/messages.ts:220)
- [`JobResponseMessage`](../src/lib/server/socket/types/messages.ts:204)

**See also:**  
- [ProgressDataSchema](../src/lib/server/socket/types/messages.ts:18)
- [JobAssignmentSchema](../src/lib/server/socket/types/messages.ts:33)
- [DiscoveredJobSchema](../src/lib/server/socket/types/messages.ts:60)

---

## Error Handling

Error types and handling logic are defined in [`types/errors.ts`](../src/lib/server/socket/types/errors.ts):

- [`ErrorSeverity`](../src/lib/server/socket/types/errors.ts:2)
- [`ErrorCategory`](../src/lib/server/socket/types/errors.ts:10)
- [`SocketError`](../src/lib/server/socket/types/errors.ts:109)
- [`ErrorHandler`](../src/lib/server/socket/types/errors.ts:156)
- [`ErrorManager`](../src/lib/server/socket/types/errors.ts:242)
- Factory functions:  
  - [`createConnectionError()`](../src/lib/server/socket/types/errors.ts:276)
  - [`createMessageError()`](../src/lib/server/socket/types/errors.ts:291)
  - [`createJobProcessingError()`](../src/lib/server/socket/types/errors.ts:306)

---

## Event System

Connection and progress events are defined in:

- [`ConnectionEvent`](../src/lib/server/socket/types/connection.ts:99)
- [`ProgressEvent`](../src/lib/server/socket/types/progress.ts:195)

Listen to events using `.on(event, handler)` on connections and progress trackers.

---

## Database Integration

Database interfaces and adapters are defined in [`types/database.ts`](../src/lib/server/socket/types/database.ts):

- [`JobDatabaseAdapter`](../src/lib/server/socket/types/database.ts:78)
- [`SocketDatabaseOperations`](../src/lib/server/socket/types/database.ts:193)
- [`Job`](../src/lib/server/socket/types/database.ts:12)
- [`Area`](../src/lib/server/socket/types/database.ts:54)
- [`SocketJobProgress`](../src/lib/server/socket/types/database.ts:134)
- [`JobAssignmentMapping`](../src/lib/server/socket/types/database.ts:180)

---

## Performance Tuning

- Adjust connection pool, buffer sizes, and heartbeat intervals in [`SocketServerConfig`](../src/lib/server/socket/types/config.ts:2).
- Monitor metrics via built-in metrics and health endpoints.

---

## Code Examples

### Complete Server Setup

```typescript
import { SocketServer } from '$lib/server/socket';
import { createDefaultRouter } from '$lib/server/socket/message-router';
import { DatabaseManager } from '$lib/server/database';

async function setupSocketServer() {
  const dbManager = new DatabaseManager({ connectionString: process.env.DATABASE_URL });
  await dbManager.connect();

  const socketServer = new SocketServer({
    socketPath: process.env.SOCKET_PATH || '/tmp/crawler.sock',
    maxConnections: parseInt(process.env.MAX_CONNECTIONS || '10'),
    logLevel: (process.env.LOG_LEVEL as any) || 'info',
    heartbeatInterval: 60000,
    enableMetrics: true,
  });

  const router = createDefaultRouter();
  // Register handlers and middleware...
  await socketServer.start();
}
```

### Custom Message Handler

```typescript
import { MessageHandler } from '$lib/server/socket/message-router';

class CustomJobHandler implements MessageHandler {
  canHandle(message) { return message.type === 'custom_job_event'; }
  async handle(message, connection) { /* ... */ }
  getPriority() { return 50; }
}
```

---

## References

- [Type Definitions](../src/lib/server/socket/types/)
- [Implementation Summary](./socket-implementation.md)
- [Deployment Guide](./socket-deployment.md)
