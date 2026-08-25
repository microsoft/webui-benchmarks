// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { createRequire } from "node:module";
import { createSecureServer } from "node:http2";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { TODO_ROOT } from "../runner/lib/paths.mjs";
import { isMainModule } from "../servers/lib/cli.mjs";
import { browserTlsMaterial } from "./tls.mjs";

function parseOptions(argv) {
  let appId;
  let port = 0;
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${option} requires a value`);
    if (option === "--app") appId = value;
    else if (option === "--port") port = Number(value);
    else throw new Error(`Unknown option '${option}'`);
  }
  if (!["astro", "next", "nuxt", "sveltekit"].includes(appId)) {
    throw new Error("--app must be astro, next, nuxt, or sveltekit");
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("--port must be a valid TCP port");
  }
  return { appId, port };
}

async function loadHandler(appId) {
  const appRoot = resolve(TODO_ROOT, "apps", appId);
  if (appId === "astro") {
    return (await import(
      pathToFileURL(resolve(appRoot, "dist", "server", "h2-entry.mjs")).href
    )).handler;
  }
  if (appId === "sveltekit") {
    return (await import(
      pathToFileURL(resolve(appRoot, "build", "handler.js")).href
    )).handler;
  }
  if (appId === "nuxt") {
    globalThis._importMeta_ = {
      env: process.env,
      url: pathToFileURL(
        resolve(appRoot, ".output", "server", "index.mjs"),
      ).href,
    };
    const nitro = await import(
      pathToFileURL(
        resolve(appRoot, ".output", "server", "chunks", "_", "nitro.mjs"),
      ).href
    );
    return nitro.t(nitro.b().h3App);
  }
  const require = createRequire(resolve(appRoot, "package.json"));
  const next = require("next");
  const app = next({ dev: false, dir: appRoot });
  await app.prepare();
  return app.getRequestHandler();
}

export async function startFullstackH2Server({ appId, port }) {
  const [handler, tls] = await Promise.all([
    loadHandler(appId),
    browserTlsMaterial(),
  ]);
  const server = createSecureServer(
    {
      allowHTTP1: false,
      cert: tls.cert,
      key: tls.key,
    },
    (request, response) => {
      request.headers.host ??= request.headers[":authority"];
      const visibleHeaders = Object.fromEntries(
        Object.entries(request.headers).filter(
          ([name]) => !name.startsWith(":"),
        ),
      );
      Object.defineProperty(request, "headers", {
        configurable: true,
        value: visibleHeaders,
      });
      Promise.resolve(handler(request, response)).catch((error) => {
        if (!response.headersSent) response.writeHead(500);
        response.end(
          error instanceof Error ? error.message : String(error),
        );
      });
    },
  );
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Full-stack H2 server exposed no TCP address");
  }
  const url = `https://127.0.0.1:${address.port}`;
  process.stdout.write(`${JSON.stringify({
    appId,
    runtimeId: "node",
    runtimeVersion: process.versions.node,
    serverId: appId,
    status: "ready",
    url,
    workerCount: 1,
  })}\n`);
  return server;
}

if (isMainModule(import.meta.url)) {
  const server = await startFullstackH2Server(
    parseOptions(process.argv.slice(2)),
  );
  const close = () => server.close(() => process.exit(0));
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}
