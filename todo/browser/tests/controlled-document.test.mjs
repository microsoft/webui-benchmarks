// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";

import { controlledDocument } from "../controlled-browser-server.mjs";

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
  assert.match(document, /globalThis\.__TODO_BENCH_INITIAL_STATE__/u);
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
    /globalThis\.__TODO_BENCH_INITIAL_STATE__/u,
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
