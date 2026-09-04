// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { createServer } from "node:http2";
import test from "node:test";
import { requestHttp2Ok } from "../lib/server.mjs";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  return `http://127.0.0.1:${address.port}/ready`;
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test("HTTP/2 readiness accepts a successful response", async () => {
  const server = createServer();
  server.on("stream", (stream) => {
    stream.respond({ ":status": 200 });
    stream.end("ready");
  });
  try {
    const url = await listen(server);
    await requestHttp2Ok(url, { timeoutMilliseconds: 100 });
  } finally {
    await close(server);
  }
});

test("HTTP/2 readiness enforces its per-request timeout", async () => {
  const server = createServer();
  server.on("stream", () => {});
  try {
    const url = await listen(server);
    await assert.rejects(
      requestHttp2Ok(url, { timeoutMilliseconds: 25 }),
      /HTTP\/2 request timed out after 25ms/u,
    );
  } finally {
    await close(server);
  }
});
