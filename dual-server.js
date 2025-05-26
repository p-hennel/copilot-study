/* eslint-disable @typescript-eslint/no-unused-vars */

import { build_options, env, handler_default } from "./web/handler.js";
import "./web/mime.conf.js";

var { httpserver, websocket } = handler_default(build_options.assets ?? true);

const defaultPort = 3000
// Store request sources in the locals object via a header
const SOURCE_HEADER = 'x-request-source';
// Unix Socket Server (for container-to-container communication)
const socketPath = env("SOCKET_PATH", './data.private/config/api.sock');

const doServe = async (opts) => {
  let listenOn = ""
  let source = ""
  if (Object.keys(opts).includes("hostname")) {
    opts = {
      ...opts,
      port: env("PORT", defaultPort),
    }
    listenOn = `${opts.hostname}:${opts.port}`
    source = "http"
  } else if (Object.keys(opts).includes("unix")) {
    listenOn = opts.unix
    source = "unix"
  }
  var serverOptions = {
    ...opts,
    baseURI: env("ORIGIN", undefined),
    fetch: async (req, srv) => {
      const newRequest = new Request(req, {
        headers: {
          ...Object.fromEntries(req.headers.entries()),
          [SOURCE_HEADER]: source
        }
      });
      return await httpserver(newRequest, srv)
    },
    development: env("SERVERDEV", build_options.development ?? false),
    error(error) {
      console.error(error);
      return new Response("Uh oh!!", { status: 500 });
    }
  };
  if (websocket && source !== "unix") {
    serverOptions.websocket = websocket
  }
  console.info(`Listening on ${listenOn}` + (websocket ? " (Websocket)" : ""));
  const server = Bun.serve(serverOptions);
  return server
}

const httpServer = await doServe({ hostname: "0.0.0.0" })
console.log(`HTTP server running at ${httpServer.hostname}:${httpServer.port}`);

// Remove existing socket if present
try {
  await Bun.file(socketPath).remove();
} catch (e) {
  // Socket probably doesn't exist yet
}

await doServe({ unix: socketPath })

console.log(`Unix socket server running at ${socketPath}`);
await Bun.spawn(['chmod', '777', socketPath]).exited;

// Cleanup on exit
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

function cleanup() {
  try { Bun.file(socketPath).remove(); } 
  catch (e) { console.error(e) }
  process.exit(0);
}