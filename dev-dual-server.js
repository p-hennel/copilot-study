/* eslint-disable @typescript-eslint/no-unused-vars */

import { createServer } from 'vite';
import { createServer as createHttpServer } from 'http';
import { spawn } from 'child_process';

// Helper to get environment variables with defaults
const env = (key, defaultValue) => process.env[key] || defaultValue;

const defaultPort = 3000;
const SOURCE_HEADER = 'x-request-source';
const socketPath = env('SOCKET_PATH', './data.private/config/api.sock');
const vitePort = env('VITE_PORT', defaultPort);

let viteProcess = null;
let cleanupDone = false;

// Start Vite dev server as separate process
const startViteDevServer = async () => {
  return new Promise((resolve, reject) => {
    console.log('Starting Vite development server...');
    
    // Start Vite dev server with the same environment variables as the dev script
    const env_vars = {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL || `${process.cwd()}/data.private/config/main.db`,
      DATA_ROOT: process.env.DATA_ROOT || `${process.cwd()}/data.private`,
      SETTINGS_FILE: process.env.SETTINGS_FILE || `${process.cwd()}/data.private/config/settings.yaml`,
    };

    viteProcess = spawn('bun', ['--bun', 'x', 'vite', 'dev', '--host', '127.0.0.1', '--port', vitePort], {
      env: env_vars,
      stdio: 'pipe'
    });

    viteProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[Vite] ${output.trim()}`);
      
      // Look for the server ready message
      if (output.includes('Local:') || output.includes('ready in')) {
        resolve();
      }
    });

    viteProcess.stderr.on('data', (data) => {
      console.error(`[Vite Error] ${data.toString().trim()}`);
    });

    viteProcess.on('error', (error) => {
      console.error('Failed to start Vite process:', error);
      reject(error);
    });

    viteProcess.on('exit', (code) => {
      if (code !== 0 && !cleanupDone) {
        console.error(`Vite process exited with code ${code}`);
        reject(new Error(`Vite process failed with exit code ${code}`));
      }
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      if (viteProcess && !cleanupDone) {
        reject(new Error('Vite server startup timeout'));
      }
    }, 30000);
  });
};

// Forward request to Vite dev server
const forwardToVite = async (request, source) => {
  try {
    // Create new URL pointing to local Vite server
    const url = new URL(request.url);
    const viteUrl = `http://127.0.0.1:${vitePort}${url.pathname}${url.search}`;
    
    // Create new request with added source header
    const headers = new Headers(request.headers);
    headers.set(SOURCE_HEADER, source);
    
    const forwardedRequest = new Request(viteUrl, {
      method: request.method,
      headers: headers,
      body: request.body,
      duplex: 'half'
    });

    // Forward to Vite dev server
    const response = await fetch(forwardedRequest);
    
    // Return response with same headers but remove hop-by-hop headers
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete('connection');
    responseHeaders.delete('transfer-encoding');
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });
  } catch (error) {
    console.error('Error forwarding request to Vite:', error);
    return new Response('Error connecting to development server', { status: 502 });
  }
};

const doServe = async (opts) => {
  let listenOn = '';
  let source = '';
  
  if (Object.keys(opts).includes('hostname')) {
    opts = {
      ...opts,
      port: env('PORT', defaultPort),
    };
    listenOn = `${opts.hostname}:${opts.port}`;
    source = 'http';
  } else if (Object.keys(opts).includes('unix')) {
    listenOn = opts.unix;
    source = 'unix';
  }

  const serverOptions = {
    ...opts,
    development: true,
    fetch: async (req, srv) => {
      return await forwardToVite(req, source);
    },
    error(error) {
      console.error(error);
      return new Response('Uh oh!!', { status: 500 });
    }
  };

  console.info(`Listening on ${listenOn}`);
  const server = Bun.serve(serverOptions);
  return server;
};

const startDualServer = async () => {
  try {
    // Start Vite dev server first
    await startViteDevServer();
    
    // Wait a bit for Vite to fully start
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Start the HTTP server (proxying to Vite)
    const httpServer = await doServe({ hostname: '0.0.0.0' });
    console.log(`HTTP server running at ${httpServer.hostname}:${httpServer.port} (proxying to Vite)`);

    // Remove existing socket if present
    try {
      await Bun.file(socketPath).remove();
    } catch (e) {
      // Socket probably doesn't exist yet
    }

    // Start the Unix socket server (also proxying to Vite)
    await doServe({ unix: socketPath });
    console.log(`Unix socket server running at ${socketPath} (proxying to Vite)`);
    
    try {
      await Bun.spawn(['chmod', '777', socketPath]).exited;
    } catch (e) {
      console.warn('Could not set socket permissions:', e.message);
    }

    // Cleanup function
    const cleanup = async () => {
      if (cleanupDone) return;
      cleanupDone = true;
      
      console.log('\nShutting down servers...');
      
      if (viteProcess) {
        console.log('Stopping Vite development server...');
        viteProcess.kill('SIGTERM');
        
        // Give it time to shut down gracefully
        setTimeout(() => {
          if (viteProcess && !viteProcess.killed) {
            viteProcess.kill('SIGKILL');
          }
        }, 5000);
      }
      
      try {
        await Bun.file(socketPath).remove();
      } catch (e) {
        console.error('Error removing socket file:', e);
      }
      
      process.exit(0);
    };

    // Cleanup on exit
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('exit', cleanup);

    return { httpServer };
  } catch (error) {
    console.error('Failed to start dual server:', error);
    process.exit(1);
  }
};

// Start the dual server
startDualServer().catch((error) => {
  console.error('Failed to start dual server:', error);
  process.exit(1);
});