// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";

import {
  controlledDocument,
  controlledDocumentStream,
} from "../controlled-browser-server.mjs";
import { controlledDocumentWrapperBytes } from "../../shared/document.mjs";
import { collectByteStream } from "../../shared/streaming.mjs";

const options = {
  appId: "react",
  bootstrap: "<script>bootstrap()</script>",
  clientPath: "/__browser/react.js",
  state: { title: "</script><b>unsafe</b>" },
};

test("injects benchmark metadata and client into a complete SSR document", () => {
  const document = controlledDocument({
    ...options,
    fragment:
      '<!doctype html><html><head><title>Todo</title></head><body><div id="todo-browser-root"></div></body></html>',
  });
  assert.equal(document.match(/<!doctype html>/giu)?.length, 1);
  assert.equal(document.match(/<html/giu)?.length, 1);
  assert.equal(document.match(/<body/giu)?.length, 1);
  assert.match(document, /<meta name="todo-browser-app" content="react">/u);
  assert.match(
    document,
    /<script id="todo-bench-initial-state" type="application\/json">/u,
  );
  assert.match(document, /\\u003c\/script>/u);
  assert.ok(
    document.indexOf("/__browser/react.js") < document.indexOf("</body>"),
  );
});

test("does not duplicate state already present in a complete SSR document", () => {
  const document = controlledDocument({
    ...options,
    appId: "webui",
    clientPath: "/__browser/webui.js",
    fragment:
      '<!doctype html><html><head><title>Todo</title></head><body><script type="application/json" id="webui-data">{"state":{"title":"from SSR"}}</script></body></html>',
    initialStateSource: "ssr-document",
  });
  assert.doesNotMatch(
    document,
    /id="todo-bench-initial-state"/u,
  );
  assert.match(document, /id="webui-data"/u);
  assert.match(document, /\/__browser\/webui\.js/u);
});

test("wraps fragment-only renderers in the controlled browser document", () => {
  const document = controlledDocument({
    ...options,
    fragment: '<todo-app id="todo-browser-root"></todo-app>',
  });
  assert.match(document, /^<!doctype html><html/iu);
  assert.match(
    document,
    /<div id="todo-browser-root"><todo-app id="todo-browser-root"><\/todo-app><\/div>/u,
  );
  assert.match(document, /<link rel="stylesheet" href="\/__browser\/styles\.css">/u);
});

test("streams fragment renderers between the controlled shell and state", async () => {
  const fragment = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("<todo-app>"));
      controller.enqueue(new TextEncoder().encode("</todo-app>"));
      controller.close();
    },
  });
  const document = Buffer.from(
    await collectByteStream(
      controlledDocumentStream({ ...options, fragment }),
    ),
  ).toString("utf8");
  assert.match(
    document,
    /<div id="todo-browser-root"><todo-app><\/todo-app><\/div>/u,
  );
  assert.match(document, /id="todo-bench-initial-state"/u);
  assert.match(document, /\\u003c\/script>/u);
  assert.match(document, /\/__browser\/react\.js/u);
  assert.equal(
    Buffer.byteLength(document) - Buffer.byteLength("<todo-app></todo-app>"),
    controlledDocumentWrapperBytes(options),
  );
});

test("cancels an unopened fragment when the controlled shell is abandoned", async () => {
  let cancelled = false;
  const fragment = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  const stream = controlledDocumentStream({ ...options, fragment });
  const reader = stream.getReader();
  const prefix = await reader.read();
  assert.equal(prefix.done, false);
  await reader.cancel(new Error("abandoned after shell"));
  assert.equal(cancelled, true);
});

test("cancels a fragment while its read is pending", async () => {
  let markPulling;
  let markCancelled;
  const pulling = new Promise((resolve) => {
    markPulling = resolve;
  });
  const cancelled = new Promise((resolve) => {
    markCancelled = resolve;
  });
  const fragment = new ReadableStream({
    cancel(reason) {
      markCancelled(reason);
    },
    pull() {
      markPulling();
      return new Promise(() => {});
    },
  });
  const stream = controlledDocumentStream({ ...options, fragment });
  const reader = stream.getReader();
  await reader.read();
  const pendingRead = reader.read();
  await pulling;
  const reason = new Error("cancel pending fragment");
  const cancellation = reader.cancel(reason);
  assert.equal(await cancelled, reason);
  await cancellation;
  await pendingRead;
});
