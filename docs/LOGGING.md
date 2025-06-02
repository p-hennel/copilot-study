# Logging Configuration and Usage

This document explains how to use the logging system in the application after converting from `console.log` statements to proper logtape logging.

## Quick Start

### Environment Variables

Set these environment variables to control logging behavior:

```bash
# Set log level (debug, info, warning, error, fatal)
export LOG_LEVEL=debug

# Or use DEBUG flag for debug mode
export DEBUG=true
```

### Development Commands

```bash
# Run with debug logging
LOG_LEVEL=debug bun run dev

# Run with info logging (default)
LOG_LEVEL=info bun run dev

# Run with minimal logging
LOG_LEVEL=warning bun run dev
```

## Log Output Locations

### Console Output
- **Debug mode**: Shows all log levels (debug, info, warn, error)
- **Info mode**: Shows info, warn, error
- **Warning mode**: Shows warn, error only

### File Output
Logs are written to files in the `logs/` directory:

- `backend.log` - General application logs (info level and above)
- `backend.error.log` - Error logs only
- `backend.meta.log` - Logtape internal logs

## Logger Categories

The application uses structured logger categories:

```typescript
// Core application
const logger = getLogger(["backend", "supervisor"]);
const dbLogger = getLogger(["server", "db"]);

// API endpoints
const apiLogger = getLogger(["api", "admin", "jobs"]);
const authLogger = getLogger(["auth", "client"]);

// Messaging system
const messagingLogger = getLogger(["messaging", "client"]);

// Settings
const settingsLogger = getLogger(["server", "settings"]);
```

## Usage Examples

### Basic Logging

```typescript
import { getLogger } from "$lib/logging";

const logger = getLogger(["my", "component"]);

// Different log levels
logger.debug("Detailed debugging information");
logger.info("General information");
logger.warn("Warning about something");
logger.error("An error occurred");
```

### Structured Logging

```typescript
// Instead of string concatenation
// OLD: console.log(`User ${userId} performed action ${action}`)

// NEW: Structured logging
logger.info("User performed action", {
  userId,
  action,
  timestamp: new Date().toISOString(),
  metadata: { /* additional context */ }
});
```

### Error Logging

```typescript
// Log errors with context
try {
  // some operation
} catch (error) {
  logger.error("Operation failed", {
    error,
    context: "database_connection",
    retryAttempt: 3
  });
}
```

## Testing Logging Configuration

### Run the Test Scripts

```bash
# Test basic logging setup
bun run test-logging.ts

# Test application-specific logging
bun run test-app-logging.ts
```

### Expected Output

You should see:
1. **Console output** with colored, formatted log messages
2. **Log files** created in the `logs/` directory
3. **Structured data** properly formatted

## Troubleshooting

### No Log Output

1. **Check environment variables**:
   ```bash
   echo $LOG_LEVEL
   echo $DEBUG
   ```

2. **Verify logs directory exists**:
   ```bash
   ls -la logs/
   ```

3. **Check file permissions**:
   ```bash
   ls -la logs/backend*.log
   ```

### Console Output Not Visible

The logging configuration has been updated to show `info` level logs by default. If you're not seeing logs:

1. **Set explicit log level**:
   ```bash
   LOG_LEVEL=debug bun run dev
   ```

2. **Check the logger category**: Make sure your logger category is configured in the logging setup.

### Common Issues

1. **Logger not configured**: Ensure `configureLogging()` is called before using `getLogger()`
2. **Wrong category**: The catch-all logger should handle any category, but verify your logger category
3. **Log level too high**: Lower the log level to see more messages

## Migration from console.log

All `console.log`, `console.error`, and `console.warn` statements have been replaced with:

- `console.log()` → `logger.info()` or `logger.debug()`
- `console.error()` → `logger.error()`
- `console.warn()` → `logger.warn()`

### Benefits of the New System

1. **Structured data**: Log objects instead of strings
2. **Categorized logging**: Organize logs by component/feature
3. **Configurable output**: Control what gets logged where
4. **File rotation**: Automatic log file management
5. **Better filtering**: Easy to search and filter logs
6. **Production ready**: Proper logging levels for different environments

## Configuration Details

The logging is configured in `src/lib/logging.ts` with:

- **Console sink**: Colored output to terminal
- **File sinks**: Rotating log files
- **OpenTelemetry sink**: For advanced monitoring (when not in debug mode)
- **Catch-all logger**: Handles any logger category not explicitly configured

## Log File Rotation

Log files automatically rotate when they reach 1MB:
- Maximum 3 files per log type
- Oldest files are automatically deleted
- Files are named: `backend.log`, `backend.log.1`, `backend.log.2`