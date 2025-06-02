# Development Dual-Server

This development dual-server provides the same dual-access functionality as the production `dual-server.js` but works with Vite's development server instead of built files.

## Features

- **HTTP Server**: Accessible via standard HTTP on port 3000 (configurable)
- **Unix Socket Server**: Accessible via Unix domain socket at `./data.private/config/api.sock`
- **Request Source Headers**: Automatically sets `x-request-source` header:
  - `x-request-source: http` for direct HTTP requests
  - `x-request-source: unix` for requests via Unix socket
- **Development Mode**: Works with Vite hot reload and all development features
- **Environment Integration**: Uses the same environment variables as the regular dev setup

## Usage

### Start the development dual-server:
```bash
bun run dev:dual
```

This is equivalent to the regular `bun run dev` command but with dual-server capabilities.

### Manual start:
```bash
bun --bun ./dev-dual-server.js
```

## Environment Variables

The server respects these environment variables:

- `PORT`: HTTP server port (default: 3000)
- `VITE_PORT`: Internal Vite dev server port (default: same as PORT)
- `SOCKET_PATH`: Unix socket path (default: `./data.private/config/api.sock`)
- `DATABASE_URL`: Database connection string
- `DATA_ROOT`: Data directory root
- `SETTINGS_FILE`: Settings file path

## How It Works

1. **Vite Process**: Starts a Vite development server on the configured port
2. **HTTP Proxy**: Creates an HTTP server that forwards requests to Vite with `x-request-source: http`
3. **Unix Socket Proxy**: Creates a Unix socket server that forwards requests to Vite with `x-request-source: unix`
4. **Header Injection**: Both proxy servers add the appropriate source header before forwarding

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   HTTP Client   │───▶│   HTTP Proxy     │───▶│                 │
│   (Port 3000)   │    │ (adds x-request- │    │  Vite Dev       │
└─────────────────┘    │  source: http)   │    │  Server         │
                       └──────────────────┘    │ (SvelteKit App) │
┌─────────────────┐    ┌──────────────────┐    │                 │
│ Unix Socket     │───▶│ Unix Socket Proxy│───▶│                 │
│ Client          │    │ (adds x-request- │    └─────────────────┘
│ (api.sock)      │    │  source: unix)   │
└─────────────────┘    └──────────────────┘
```

## Development Benefits

- **Hot Reload**: Full Vite hot reload functionality
- **Source Maps**: Development source maps work correctly
- **Fast Refresh**: SvelteKit fast refresh works as expected
- **Dual Access**: Test both HTTP and Unix socket access patterns
- **Header Testing**: Verify `x-request-source` header handling in your application

## Cleanup

The server automatically cleans up the Unix socket file on exit. If the process is killed ungracefully, you may need to manually remove the socket file:

```bash
rm ./data.private/config/api.sock
```

## Troubleshooting

### Port Conflicts
If port 3000 is already in use, set a different port:
```bash
PORT=3001 bun run dev:dual
```

### Socket Permission Issues
If you encounter socket permission issues, ensure the data directory exists and is writable:
```bash
mkdir -p ./data.private/config
```

### Vite Startup Issues
If Vite fails to start, check that all dependencies are installed:
```bash
bun install