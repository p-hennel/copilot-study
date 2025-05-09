// @bun
/* eslint-disable @typescript-eslint/no-unused-vars */

import {
build_options,
env,
handler_default
} from "./build/web/handler.js";
import"./build/web/mime.conf.js";

var { httpserver, websocket } = handler_default(build_options.assets ?? true);

const defaultPort = 3000
// Store request sources in the locals object via a header
const SOURCE_HEADER = 'x-request-source';
// Unix Socket Server (for container-to-container communication)
const socketPath = './data.private/config/api.sock';

const doServe = (opts) => {
  let listenOn = ""
  let source = ""
  if ("hostname" in Object.keys(opts)) {
    opts = {
      ...opts,
      port: env("PORT", defaultPort),
    }
    listenOn = `${opts.hostname}:${opts.port}`
    source = "http"
  } else if ("unix" in Object.keys(opts)) {
    listenOn = opts.unix
    source = "unix"
  }
  var serverOptions = {
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
  if (websocket) {
    serverOptions.websocket = websocket
  }
  console.info(`Listening on ${listenOn}` + (websocket ? " (Websocket)" : ""));
  return Bun.serve(serverOptions);
}

doServe({ hostname: "0.0.0.0" })
console.log(`HTTP server running at ${httpserver.hostname}:${httpserver.port}`);

// Remove existing socket if present
try {
  await Bun.file(socketPath).remove();
} catch (e) {
  // Socket probably doesn't exist yet
}

const socketServer = doServe({ unix: socketPath })

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