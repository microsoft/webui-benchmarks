// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// This preload module is the "closest framework-owned server boundary" the
// complete suite uses for full-stack products whose production server is
// intrinsically streaming (Next.js, Astro). It is loaded in-process, inside
// the exact same Node http.Server the framework's own production entry
// point (`next start`, the Astro Node standalone adapter, ...) creates for
// itself, via NODE_OPTIONS="--require ...". It is NOT an external reverse
// proxy: no extra process or socket hop is introduced, and every response
// still goes through the framework's real request handler.
//
// It is only armed when WEBUI_BENCH_RESPONSE_MODE=complete is set by the
// runner (see ../lib/server.mjs), so the progressive suite and every other
// use of these apps (dev servers, the browser suite, `pnpm start`, ...) is
// completely unaffected by default.
//
// Mechanism: buffer every response body chunk the framework writes and only
// hand the fully assembled body to the real socket once, from a single
// write() + end() pair issued from our patched `end()`. This mirrors exactly
// what the controlled renderer tier's own `render()` APIs already do (see
// todo/servers/lib/contract.mjs): fully collect, then publish the response
// in one piece, never as a progressive/partial delivery.
//
// This deliberately does not attempt to rewrite Content-Length or
// Transfer-Encoding after the framework has already called writeHead():
// Node's http implementation locks and reuses its private header state the
// instant writeHead() runs, and safely undoing that would require depending
// on undocumented internals that can change across Node versions. Instead:
//   - When the framework never calls writeHead() directly (setHeader() +
//     write()/end() only), Node's own implicit-header logic still runs
//     normally from our single flush and publishes an exact Content-Length.
//   - When the framework does call writeHead() up front, the response keeps
//     whatever framing it chose (typically chunked), but the buffering here
//     still guarantees the *entire* body is written and ended together, so
//     no partial/progressive content is ever observable -- exactly the
//     "complete" suite's fairness requirement.
"use strict";

const http = require("node:http");

function armResponseBuffering(ServerResponse) {
  if (ServerResponse.prototype.__webuiBenchBuffered === true) {
    return;
  }
  const originalWrite = ServerResponse.prototype.write;
  const originalEnd = ServerResponse.prototype.end;

  ServerResponse.prototype.write = function bufferedWrite(chunk, encoding, callback) {
    this.__webuiBenchChunks ??= [];
    if (chunk !== undefined && chunk !== null) {
      const resolvedEncoding = typeof encoding === "string" ? encoding : undefined;
      this.__webuiBenchChunks.push(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, resolvedEncoding),
      );
    }
    const done = typeof encoding === "function" ? encoding : callback;
    if (typeof done === "function") {
      process.nextTick(done);
    }
    return true;
  };

  ServerResponse.prototype.end = function bufferedEnd(chunk, encoding, callback) {
    if (typeof chunk === "function") {
      callback = chunk;
      chunk = undefined;
      encoding = undefined;
    } else if (typeof encoding === "function") {
      callback = encoding;
      encoding = undefined;
    }
    this.__webuiBenchChunks ??= [];
    if (chunk !== undefined && chunk !== null) {
      const resolvedEncoding = typeof encoding === "string" ? encoding : undefined;
      this.__webuiBenchChunks.push(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, resolvedEncoding),
      );
    }
    const body = Buffer.concat(this.__webuiBenchChunks);
    this.__webuiBenchChunks = [];
    // A single real write() call, through the *original* unpatched write(),
    // hands the entire body to Node/the socket atomically. When writeHead()
    // was never called, this also triggers Node's normal implicit-header
    // generation (including an exact Content-Length) exactly as it would for
    // any ordinary single-shot `res.end(body)` response.
    if (body.byteLength > 0) {
      originalWrite.call(this, body);
    }
    return originalEnd.call(this, callback);
  };

  Object.defineProperty(ServerResponse.prototype, "__webuiBenchBuffered", {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
}

if (process.env.WEBUI_BENCH_RESPONSE_MODE === "complete") {
  armResponseBuffering(http.ServerResponse);
  try {
    // Astro's and Next's Node adapters both build on node:http, but arm
    // node:http2 as well in case a future production entry negotiates h2
    // directly (the primary official matrix binds HTTP/1.1 for these apps).
    const http2 = require("node:http2");
    if (http2.Http2ServerResponse) {
      armResponseBuffering(http2.Http2ServerResponse);
    }
  } catch {
    // http2 is always available in supported Node versions; ignore defensively.
  }
}

module.exports = { armResponseBuffering };
