// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import {
  CACHED_CACHE_CONTROL,
  DYNAMIC_CACHE_CONTROL,
  HTML_CONTENT_TYPE,
  STATE_VARIANT_COUNT,
  createRouteController,
} from "../lib/contract.mjs";
import { createRequestDispatcher } from "../lib/dispatch.mjs";

function fakeStates() {
  return Object.freeze(
    Array.from({ length: STATE_VARIANT_COUNT }, (_, variantIndex) =>
      Object.freeze({
        footer: Object.freeze({}),
        todos: Object.freeze([]),
        variantIndex,
      })
    ),
  );
}

test("dynamic route warms then renders every rotating state request", async () => {
  const rendered = [];
  const controller = await createRouteController({
    addonCapability: {
      fallback: "disabled",
      kind: "test-native",
      required: true,
      supported: true,
    },
    appId: "webui",
    render(state) {
      rendered.push(state.variantIndex);
      return `<p>${state.variantIndex}</p>`;
    },
    runtimeId: "test-runtime",
    runtimeVersion: "1.0.0",
    serverId: "test-server",
    states: fakeStates(),
  });

  assert.deepEqual(
    rendered.slice(0, STATE_VARIANT_COUNT),
    Array.from({ length: STATE_VARIANT_COUNT }, (_, index) => index),
    "startup warmup must visit every state",
  );
  assert.equal(rendered.length, STATE_VARIANT_COUNT + 1);
  const bodies = [];
  const timestamps = new Set();
  for (let index = 0; index <= STATE_VARIANT_COUNT; index += 1) {
    const result = await controller.renderDynamic();
    bodies.push(result.body.toString("utf8"));
    timestamps.add(result.requestTimestamp);
    assert.equal(result.variantIndex, index % STATE_VARIANT_COUNT);
  }
  assert.equal(rendered.length, (STATE_VARIANT_COUNT * 2) + 2);
  assert.equal(bodies[0], "<p>0</p>");
  assert.equal(bodies[STATE_VARIANT_COUNT], "<p>0</p>");
  assert.equal(timestamps.size, STATE_VARIANT_COUNT + 1);
});

test("cached route renders once and reuses complete bytes", async () => {
  let renderCount = 0;
  const controller = await createRouteController({
    addonCapability: {
      fallback: "not-applicable",
      kind: "not-required",
      required: false,
      supported: true,
    },
    appId: "fake",
    render(state) {
      renderCount += 1;
      return `<p>${state.variantIndex}</p>`;
    },
    runtimeId: "node",
    runtimeVersion: "22.23.1",
    serverId: "node-http",
    states: fakeStates(),
  });
  const before = renderCount;
  const first = controller.cached();
  const second = controller.cached();
  assert.strictEqual(second.body, first.body);
  assert.equal(renderCount, before);
  assert.equal(first.body.toString("utf8"), "<p>0</p>");
});

test("renderer route emits a hydratable document with request state", async () => {
  const controller = await createRouteController({
    addonCapability: {
      fallback: "not-applicable",
      kind: "not-required",
      required: false,
      supported: true,
    },
    appId: "react",
    document: {
      appId: "react",
      bootstrap: "",
      clientPath: "/__browser/react.js",
      initialStateSource: "browser-wrapper",
    },
    render(state) {
      return `<todo-app data-variant="${state.variantIndex}"></todo-app>`;
    },
    runtimeId: "node",
    runtimeVersion: "22.23.1",
    serverId: "node-http",
    states: fakeStates(),
  });

  const result = await controller.renderDynamic();
  const body = result.body.toString("utf8");
  assert.match(body, /^<!doctype html>/u);
  assert.match(body, /id="todo-browser-root"/u);
  assert.match(body, /globalThis\.__TODO_BENCH_INITIAL_STATE__/u);
  assert.match(body, /"requestTimestamp":/u);
  assert.match(body, /<script type="module" src="\/__browser\/react\.js">/u);
});

test("dispatcher exposes metadata and equivalent cache headers", async () => {
  const controller = await createRouteController({
    addonCapability: {
      fallback: "disabled",
      kind: "node-api-native",
      path: "addon",
      required: true,
      supported: true,
    },
    appId: "webui",
    render(state) {
      return `<p>${state.variantIndex}</p>`;
    },
    runtimeId: "node",
    runtimeVersion: "22.23.1",
    serverId: "node-http",
    states: fakeStates(),
  });
  const dispatch = createRequestDispatcher(controller);
  const ready = await dispatch("http://localhost/__bench/ready");
  const metadata = JSON.parse(ready.body.toString("utf8"));
  assert.equal(metadata.runtimeId, "node");
  assert.equal(metadata.serverId, "node-http");
  assert.equal(metadata.appId, "webui");
  assert.equal(metadata.cacheMode, "dynamic-and-cached");
  assert.equal(metadata.inputPolicy, "request-timestamped-input");
  assert.equal(metadata.stateVariantCount, STATE_VARIANT_COUNT);
  assert.equal(metadata.responseBytes.cached, Buffer.byteLength("<p>0</p>"));
  assert.equal(metadata.addonCapability.supported, true);

  const dynamic = await dispatch("http://localhost/dynamic");
  const cached = await dispatch("http://localhost/cached");
  assert.equal(dynamic.headers["content-type"], HTML_CONTENT_TYPE);
  assert.equal(cached.headers["content-type"], HTML_CONTENT_TYPE);
  assert.equal(dynamic.headers["cache-control"], DYNAMIC_CACHE_CONTROL);
  assert.equal(cached.headers["cache-control"], CACHED_CACHE_CONTROL);
  assert.match(
    dynamic.headers["x-webui-bench-timestamp"],
    /^\d{4}-\d{2}-\d{2}T/u,
  );
  assert.equal(dynamic.headers["content-encoding"], undefined);
  assert.equal(cached.headers["content-encoding"], undefined);
});
