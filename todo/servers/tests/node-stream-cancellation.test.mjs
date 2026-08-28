// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { once } from "node:events";
import { get } from "node:http";
import test from "node:test";
import { startNodeHttp } from "../lib/node-http-server.mjs";

test("node:http cancels a stream created after the client disconnects", {
  timeout: 30_000,
}, async () => {
  let markCancelled;
  const cancelled = new Promise((resolve) => {
    markCancelled = resolve;
  });

  test("node:http does not abort a completed renderer stream", async () => {
    let renderSignal;
    const controller = {
      cached() {
        return {
          body: Buffer.from("<p>cached</p>"),
          cacheMode: "cached",
          requestTimestamp: "2026-08-27T00:00:00.000000Z",
          variantIndex: 0,
        };
      },
      metadata: {
        appId: "completed-stream",
        runtimeId: "node",
        runtimeVersion: process.versions.node,
        serverId: "node-http",
        status: "ready",
        workerCount: 1,
      },
      async renderDynamic(_path, { signal }) {
        renderSignal = signal;
        return {
          body: new ReadableStream({
            start(stream) {
              stream.enqueue(new TextEncoder().encode("<p>complete</p>"));
              stream.close();
            },
          }),
          cacheMode: "dynamic",
          requestTimestamp: "2026-08-27T00:00:00.000000Z",
          variantIndex: 0,
        };
      },
    };
    const server = await startNodeHttp(controller, {
      host: "127.0.0.1",
      port: 0,
    });
    try {
      const request = get(`${server.announcement.url}/dynamic`);
      const [response] = await once(request, "response");
      response.resume();
      await once(response, "end");
      assert.equal(renderSignal.aborted, false);
    } finally {
      await server.close();
    }
  });
  const controller = {
    cached() {
      return {
        body: Buffer.from("<p>cached</p>"),
        cacheMode: "cached",
        requestTimestamp: "2026-08-27T00:00:00.000000Z",
        variantIndex: 0,
      };
    },
    metadata: {
      appId: "delayed-stream",
      runtimeId: "node",
      runtimeVersion: process.versions.node,
      serverId: "node-http",
      status: "ready",
      workerCount: 1,
    },
    async renderDynamic() {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return {
        body: new ReadableStream({
          cancel(reason) {
            markCancelled(reason);
          },
        }),
        cacheMode: "dynamic",
        requestTimestamp: "2026-08-27T00:00:00.000000Z",
        variantIndex: 0,
      };
    },
  };
  const server = await startNodeHttp(controller, {
    host: "127.0.0.1",
    port: 0,
  });
  try {
    const request = get(`${server.announcement.url}/dynamic`);
    request.on("error", () => {});
    setTimeout(() => request.destroy(), 10).unref();
    const reason = await Promise.race([
      cancelled,
      new Promise((_, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("delayed node stream was not cancelled")),
          10_000,
        );
        timeout.unref();
      }),
    ]);
    assert.match(String(reason), /closed before rendering/u);
  } finally {
    await server.close();
  }
});
