# Socket Communication System – Overview

This overview summarizes the architecture, features, and integration points of the socket communication system for the GitLab crawler project.

---

## Directory Structure

```
socket/
├── types/                  # TypeScript type definitions
│   ├── messages.ts         # Message protocol types
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

---

## Key Features

- **Type Safety:** Complete TypeScript type definitions, mirroring the crawler protocol and database schema.
- **Connection Management:** Unix domain socket server, connection pooling, heartbeat monitoring, authentication, and authorization.
- **Message Protocol:** Full compatibility with crawler protocol, validation, transformation, middleware, and error handling.
- **Progress Tracking:** Real-time monitoring, aggregation, reporting, and persistence.
- **Database Integration:** Job lifecycle management, progress state persistence, error logging, and connection state tracking.
- **Error Handling:** Categorization, severity levels, recovery strategies, and notification system.
- **Configuration:** Environment-specific, runtime-updatable, and supports environment variables.
- **Testing:** Comprehensive type definitions and interfaces for robust testing.
- **Production-Ready:** Monitoring, log aggregation, resource usage tracking, and future extensibility (WebSocket, load balancing, distributed queue).

---

## Integration with Crawler

- Supports all message types from the crawler protocol.
- Uses newline-delimited JSON messages over Unix domain sockets.
- Heartbeat and progress mechanisms are compatible with crawler expectations.

---

## Development and Extension

- Add custom handlers by implementing the `MessageHandler` interface and registering with the router.
- Add middleware for preprocessing, validation, or transformation.
- Extend database adapters for new data types or persistence needs.

---

## References

- [API Reference](./socket-api.md)
- [Deployment Guide](./socket-deployment.md)
- [Implementation Summary](./socket-implementation.md)
