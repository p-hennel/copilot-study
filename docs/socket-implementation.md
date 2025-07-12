# Socket Communication System – Implementation Summary

This document provides an overview of the socket communication system implementation for the GitLab crawler web application, enabling real-time bidirectional communication between the web application and crawler instances.

---

## Architecture Overview

```
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│   Web App     │    │ Socket Server │    │   Crawler     │
│               │    │               │    │               │
│ ┌───────────┐ │    │ ┌───────────┐ │    │ ┌───────────┐ │
│ │JobManager │◄├────┤►│MsgRouter  │◄├────┤►│JobExecutor│ │
│ └───────────┘ │    │ └───────────┘ │    │ └───────────┘ │
│ ┌───────────┐ │    │ ┌───────────┐ │    │ ┌───────────┐ │
│ │ProgressUI │◄├────┤►│ProgressTrk│◄├────┤►│ProgressRep│ │
│ └───────────┘ │    │ └───────────┘ │    │ └───────────┘ │
│ ┌───────────┐ │    │ ┌───────────┐ │    │ ┌───────────┐ │
│ │Database   │◄├────┤►│DBAdapter  │ │    │ │ Monitor   │ │
│ └───────────┘ │    │ └───────────┘ │    │ └───────────┘ │
└───────────────┘    └───────────────┘    └───────────────┘
```

---

## Project Structure

See [`src/lib/server/socket/`](../src/lib/server/socket/):

- `socket-server.ts`: Main server implementation
- `message-router.ts`: Message routing and middleware
- `config.ts`: Configuration management
- `types/`: TypeScript type definitions ([messages.ts](../src/lib/server/socket/types/messages.ts), [database.ts](../src/lib/server/socket/types/database.ts), etc.)
- `protocol/`: Protocol implementation
- `handlers/`: Message handlers
- `persistence/`: Database integration
- `progress/`: Progress tracking
- `utils/`: Utilities

---

## Core Components

### SocketServer

Manages connections, message routing, and server lifecycle.
See [`socket-server.ts`](../src/lib/server/socket/socket-server.ts).

**Note:** Progress aggregation is partially implemented. Some advanced aggregation features are experimental or stubbed.

### MessageRouter

Handles message routing, middleware, and handler registration.
See [`message-router.ts`](../src/lib/server/socket/message-router.ts).

### Configuration Management

Environment-specific, runtime-updatable configuration.
See [`types/config.ts`](../src/lib/server/socket/types/config.ts:2).

---

## Message Protocol

Message schemas are defined in [`types/messages.ts`](../src/lib/server/socket/types/messages.ts):

- Crawler → Web App: `HeartbeatMessage`, `JobProgressMessage`, `JobsDiscoveredMessage`, etc.
- Web App → Crawler: `JobAssignmentMessage`, `ShutdownMessage`, etc.

---

## Database Integration

Database adapters and job/progress tracking are defined in [`types/database.ts`](../src/lib/server/socket/types/database.ts:78).

- Job lifecycle management
- Progress state persistence
- Assignment mapping

---

## Security Features

- Unix domain socket for local communication
- Connection authentication and validation
- Rate limiting and message validation
- Sensitive data masking in logs

---

## Monitoring and Metrics

- Built-in metrics: connection counts, message rates, error rates, job stats
- Health check endpoints (see [socket-deployment.md](./socket-deployment.md))
- Error tracking and notification

---

## Testing Strategy

- Unit tests for core logic
- Integration tests for message exchange and database updates
- Load testing with multiple concurrent connections

> Explicit test coverage for all protocol handlers and progress aggregation is not yet complete. Some areas are covered by integration tests, but additional tests may be needed for full coverage.

---

## Deployment Options

- Development: `npm run dev`
- Production: PM2/systemd/Docker/Kubernetes
- See [socket-deployment.md](./socket-deployment.md) for details

---

## Configuration

- Use `.env` files and environment variables
- See [`types/config.ts`](../src/lib/server/socket/types/config.ts:2) for all options

---

## Troubleshooting

- Socket connection and permission issues
- Database connectivity and pool exhaustion
- Memory and resource monitoring
- Debugging and log analysis

---

## Performance Optimization

- Tune connection pool, buffer sizes, and heartbeat intervals
- Optimize database indexes and queries

---

## Contribution Guidelines

- TypeScript strict mode
- ESLint with recommended rules
- Comprehensive error handling
- Unit and integration tests
- Documentation for public APIs

---

## Connection Management Details

This section summarizes the technical implementation of socket connection management and protocol handling, as implemented in [`connection/`](../src/lib/server/socket/connection/) and [`protocol/`](../src/lib/server/socket/protocol/):

- **SocketManager**: Manages Unix socket server lifecycle, client connection pooling, health monitoring, graceful shutdown, and event emission for connection events.
- **ConnectionPool**: Handles multiple active connections, lifecycle management, metadata/statistics tracking, broadcasting, cleanup of unhealthy connections, and pool monitoring.
- **SocketConnection**: Wraps individual connections, manages state, message sending with timeouts, heartbeat monitoring, event emission, and statistics.
- **HealthMonitor**: Tracks heartbeats, detects timeouts, collects metrics, reports health status, and emits health events.
- **MessageBuffer**: Buffers and parses messages, handles partial messages, enforces buffer size limits, and monitors buffer usage.
- **Protocol Implementation**: Includes message validation (using Zod schemas), parsing, error handling, protocol versioning, and event emission for message lifecycle.

**Key Features:**
- Comprehensive error handling and resource management
- Performance optimization via efficient buffer and connection pooling
- Type-safe, modular, and testable architecture

## Database Persistence and Refactoring

This section summarizes the refactoring and integration of the socket database manager with Drizzle ORM, as described in [`persistence/README.md`](../src/lib/server/socket/persistence/README.md):

- **Socket Schema**: All socket-specific tables (e.g., `socketConnection`, `jobQueue`, `jobAssignmentMapping`, `jobErrorLog`) are defined in [`schema/socket-schema.ts`](../schema/socket-schema.ts), with proper type inference, foreign keys, and indexing.
- **Database Manager Refactoring**: The database manager now uses the shared Drizzle ORM connection, type-safe query builders, integrated transaction handling, and follows established codebase patterns.
- **Operations**: Core CRUD operations, connection state tracking, and job queue management are implemented using Drizzle patterns, ensuring type safety and reliability.
- **Migration and Compatibility**: Socket tables are created automatically, maintain backward compatibility, and integrate with the main migration system.
- **Benefits**: Improved performance, maintainability, error handling, and unified database access patterns.

**Integration Points:**
- Unified with job and area management, authentication, logging, monitoring, and error reporting systems.

---
For detailed API and deployment instructions, see [API Reference](./socket-api.md) and [Deployment Guide](./socket-deployment.md).