// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { once } from "node:events";
import { connect, constants } from "node:http2";
import test from "node:test";
import { startControlledBrowserServer } from "../controlled-browser-server.mjs";

test("controlled HTTP/2 streaming cancels the renderer on disconnect", {
  timeout: 30_000,
}, async () => {
  let markCancelled;
  const cancelled = new Promise((resolve) => {
    markCancelled = resolve;
  });

  test("controlled HTTP/2 observes disconnects before stream creation", {
    timeout: 30_000,
  }, async () => {
    let markCancelled;
    const cancelled = new Promise((resolve) => {
      markCancelled = resolve;
    });

    test("controlled HTTP/2 cancels renderer streams for HEAD", {
      timeout: 30_000,
    }, async () => {
      let markCancelled;
      const cancelled = new Promise((resolve) => {
        markCancelled = resolve;
      });

      test("controlled HTTP/2 does not abort a completed renderer stream", {
        timeout: 30_000,
      }, async () => {
        let renderSignal;
        const server = await startControlledBrowserServer({
          backend: undefined,
          browserCase: {
            appId: "completed-stream",
            initialStateSource: "browser-wrapper",
          },
          clientBundle: Buffer.from("export {};"),
          serverRenderer: {
            bundleBytes: 1,
            ownsDocument: true,
            renderStream(_state, _path, { signal }) {
              renderSignal = signal;
              return new ReadableStream({
                start(controller) {
                  controller.enqueue(
                    new TextEncoder().encode(
                      "<!doctype html><html><body>complete</body></html>",
                    ),
                  );
                  controller.close();
                },
              });
            },
          },
        });
        const client = connect(server.url, { rejectUnauthorized: false });
        try {
          const request = client.request({ ":path": "/dynamic" });
          request.resume();
          request.end();
          await once(request, "end");
          assert.equal(renderSignal.aborted, false);
        } finally {
          client.close();
          await server.stop();
        }
      });
      const server = await startControlledBrowserServer({
        backend: undefined,
        browserCase: {
          appId: "head-stream-cancellation",
          initialStateSource: "browser-wrapper",
        },
        clientBundle: Buffer.from("export {};"),
        serverRenderer: {
          bundleBytes: 1,
          ownsDocument: true,
          renderStream() {
            return new ReadableStream({
              cancel(reason) {
                markCancelled(reason);
              },
              pull(controller) {
                controller.enqueue(new Uint8Array(64 * 1024));
              },
            });
          },
        },
      });
      const client = connect(server.url, { rejectUnauthorized: false });
      try {
        const request = client.request({
          ":method": "HEAD",
          ":path": "/dynamic",
        });
        request.end();
        request.resume();
        await once(request, "end");
        const reason = await cancelled;
        assert.match(String(reason), /HEAD requests/u);
      } finally {
        client.close();
        await server.stop();
      }
    });
    const server = await startControlledBrowserServer({
      backend: undefined,
      browserCase: {
        appId: "delayed-stream-cancellation",
        initialStateSource: "browser-wrapper",
      },
      clientBundle: Buffer.from("export {};"),
      serverRenderer: {
        bundleBytes: 1,
        ownsDocument: true,
        async renderStream() {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return new ReadableStream({
            cancel(reason) {
              markCancelled(reason);
            },
          });
        },
      },
    });
    const client = connect(server.url, { rejectUnauthorized: false });
    try {
      const request = client.request({ ":path": "/dynamic" });
      request.end();
      setTimeout(() => request.close(constants.NGHTTP2_CANCEL), 10).unref();
      const reason = await Promise.race([
        cancelled,
        new Promise((_, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("delayed renderer stream was not cancelled")),
            10_000,
          );
          timeout.unref();
        }),
      ]);
      assert.match(String(reason), /closed before rendering/u);
    } finally {
      client.close();
      await server.stop();
    }
  });
  const server = await startControlledBrowserServer({
    backend: undefined,
    browserCase: {
      appId: "stream-cancellation",
      initialStateSource: "browser-wrapper",
    },
    clientBundle: Buffer.from("export {};"),
    serverRenderer: {
      bundleBytes: 1,
      ownsDocument: true,
      renderStream() {
        return new ReadableStream({
          cancel(reason) {
            markCancelled(reason);
          },
          pull(controller) {
            controller.enqueue(new Uint8Array(64 * 1024));
          },
        });
      },
    },
  });
  const client = connect(server.url, { rejectUnauthorized: false });
  try {
    const request = client.request({ ":path": "/dynamic" });
    request.once("data", () => {
      request.close(constants.NGHTTP2_CANCEL);
    });
    request.end();
    let timeout;
    const cancellationTimeout = new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error("renderer stream was not cancelled")),
        10_000,
      );
      timeout.unref();
    });
    const reason = await Promise.race([cancelled, cancellationTimeout])
      .finally(() => clearTimeout(timeout));
    assert.match(String(reason), /did not complete|closed/u);
  } finally {
    client.close();
    await server.stop();
  }
});
