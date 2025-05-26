import { unlinkSync, existsSync } from 'fs';

const BUN_PROXY_SOCKET_PATH = process.env.SOCKET_PATH || './bun-proxy.sock';
const VITE_DEV_SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

function cleanupSocket() {
  try {
    if (existsSync(BUN_PROXY_SOCKET_PATH)) {
      unlinkSync(BUN_PROXY_SOCKET_PATH);
      console.log(`Cleaned up socket file: ${BUN_PROXY_SOCKET_PATH}`);
    }
  } catch (error) {
    console.error(`Error cleaning up socket file: ${BUN_PROXY_SOCKET_PATH}`, error);
  }
}

// Cleanup on startup
cleanupSocket();

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('Received SIGINT. Shutting down...');
  cleanupSocket();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM. Shutting down...');
  cleanupSocket();
  process.exit(0);
});

console.log(`Attempting to listen on UNIX socket: ${BUN_PROXY_SOCKET_PATH}`);
console.log(`Proxying requests to Vite dev server: ${VITE_DEV_SERVER_URL}`);

try {
  Bun.serve({
    unix: BUN_PROXY_SOCKET_PATH,
    async fetch(req) {
      const url = new URL(req.url);
      const viteUrl = new URL(url.pathname + url.search, VITE_DEV_SERVER_URL);

      const headers = new Headers(req.headers);
      headers.set('x-request-source', 'unix');
      // Bun's fetch automatically sets host, but if Vite needs it explicitly:
      // headers.set('Host', new URL(VITE_DEV_SERVER_URL).host);


      try {
        console.log(`Proxying request: ${req.method} ${viteUrl.toString()}`);
        const response = await fetch(viteUrl.toString(), {
          method: req.method,
          headers: headers,
          body: req.body,
          // @ts-expect-error - allowForbiddenHeaders is a Bun-specific option
          allowForbiddenHeaders: true, // Necessary for headers like Host
        });
        return response;
      } catch (error) {
        console.error(`Error proxying request to ${viteUrl.toString()}:`, error);
        return new Response('Proxy error', { status: 502 });
      }
    },
    error(error) {
      console.error('Bun server error:', error);
      // Check if it's an address in use error
      if (error.code === 'EADDRINUSE') {
        console.error(`Socket path ${BUN_PROXY_SOCKET_PATH} is already in use. Ensure no other process is using it or try deleting the socket file manually.`);
        cleanupSocket(); // Attempt cleanup again
        process.exit(1);
      }
      return new Response('Internal server error', { status: 500 });
    },
  });

  console.log(`Successfully listening on UNIX socket: ${BUN_PROXY_SOCKET_PATH}`);
} catch (e) {
    console.error(`Failed to start Bun server on socket ${BUN_PROXY_SOCKET_PATH}:`, e);
    if (e.code === 'EADDRINUSE') {
        console.error(`Socket path ${BUN_PROXY_SOCKET_PATH} is already in use. Ensure no other process is using it or try deleting the socket file manually.`);
    }
    cleanupSocket(); // Attempt cleanup if server fails to start
    process.exit(1);
}
