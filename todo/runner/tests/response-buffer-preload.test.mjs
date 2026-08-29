// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

function loadModule() {
  const path = require.resolve("../lib/response-buffer-preload.cjs");
  delete require.cache[path];
  return require(path);
}

test("armResponseBuffering collects every chunk into one atomic response", async () => {
  const { armResponseBuffering } = loadModule();
  const { ServerResponse } = await import("node:http");
  armResponseBuffering(ServerResponse);

  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.write("above-the-fold shell ");
    response.write("below-the-fold list");
    response.end();
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    const body = await response.text();
    assert.equal(body, "above-the-fold shell below-the-fold list");
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});

test("armResponseBuffering also collects setHeader()+end(body) responses without writeHead()", async () => {
  const { armResponseBuffering } = loadModule();
  const { ServerResponse } = await import("node:http");
  armResponseBuffering(ServerResponse);

  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/plain; charset=utf-8");
    response.end("complete in one shot");
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    const body = await response.text();
    assert.equal(body, "complete in one shot");
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});

test("armResponseBuffering is idempotent and a no-op when applied twice", async () => {
  const { armResponseBuffering } = loadModule();
  const { ServerResponse } = await import("node:http");
  armResponseBuffering(ServerResponse);
  const patchedWrite = ServerResponse.prototype.write;
  armResponseBuffering(ServerResponse);
  assert.strictEqual(ServerResponse.prototype.write, patchedWrite);
});

test("the module only arms buffering when WEBUI_BENCH_RESPONSE_MODE=complete", async () => {
  const path = require.resolve("../lib/response-buffer-preload.cjs");
  delete require.cache[path];
  const previous = process.env.WEBUI_BENCH_RESPONSE_MODE;
  delete process.env.WEBUI_BENCH_RESPONSE_MODE;
  try {
    const { ServerResponse } = await import("node:http");
    const before = ServerResponse.prototype.write;
    require(path);
    assert.strictEqual(ServerResponse.prototype.write, before);
  } finally {
    if (previous === undefined) {
      delete process.env.WEBUI_BENCH_RESPONSE_MODE;
    } else {
      process.env.WEBUI_BENCH_RESPONSE_MODE = previous;
    }
  }
});
