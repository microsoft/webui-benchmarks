// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import {
  TODO_STATE_VARIANTS,
  createRequestTodoState,
} from "../../shared/state.mjs";
import {
  collectHtmlObservation as collectObservation,
} from "../../shared/observation.mjs";
import { assertValidObservation } from "../../shared/validator.mjs";
import { startNodeHttpWebuiServer } from "../node-http.mjs";
import { startNodeRendererServer } from "../node-renderer.mjs";
import {
  CACHED_CACHE_CONTROL,
  DYNAMIC_CACHE_CONTROL,
  HTML_CONTENT_TYPE,
} from "../lib/contract.mjs";

async function responseBytes(response) {
  return Buffer.from(await response.arrayBuffer());
}

async function assertHtmlResponse(response, cacheMode) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), HTML_CONTENT_TYPE);
  assert.equal(
    response.headers.get("cache-control"),
    cacheMode === "cached"
      ? CACHED_CACHE_CONTROL
      : DYNAMIC_CACHE_CONTROL,
  );
  assert.equal(response.headers.get("content-encoding"), null);
  const timestamp = response.headers.get("x-webui-bench-timestamp");
  assert.match(timestamp, /^\d{4}-\d{2}-\d{2}T/u);
  return {
    body: await responseBytes(response),
    timestamp,
  };
}

async function validateWebuiServer(server, expectedServerId) {
  const { announcement } = server;
  assert.equal(announcement.status, "ready");
  assert.equal(announcement.runtimeId, "node");
  assert.equal(announcement.serverId, expectedServerId);
  assert.equal(announcement.appId, "webui");
  assert.equal(announcement.stateVariantCount, 32);
  assert.equal(announcement.addonCapability.supported, true);
  assert.equal(announcement.addonCapability.fallback, "disabled");

  const readyResponse = await fetch(`${announcement.url}/__bench/ready`);
  const metadata = await readyResponse.json();
  assert.equal(metadata.runtimeId, "node");
  assert.equal(metadata.serverId, expectedServerId);
  assert.equal(metadata.responseBytes.dynamic.byVariant.length, 32);
  assert.equal(metadata.streaming, "progressive-boundaries");

  const firstDynamic = await assertHtmlResponse(
    await fetch(`${announcement.url}/dynamic`),
    "dynamic",
  );
  const secondDynamic = await assertHtmlResponse(
    await fetch(`${announcement.url}/dynamic`),
    "dynamic",
  );
  assert.notDeepEqual(secondDynamic.body, firstDynamic.body);
  assert.notEqual(secondDynamic.timestamp, firstDynamic.timestamp);
  assertValidObservation(
    collectObservation(firstDynamic.body.toString("utf8")),
    createRequestTodoState(TODO_STATE_VARIANTS[0], firstDynamic.timestamp),
  );
  assertValidObservation(
    collectObservation(secondDynamic.body.toString("utf8")),
    createRequestTodoState(TODO_STATE_VARIANTS[1], secondDynamic.timestamp),
  );

  const firstCached = await assertHtmlResponse(
    await fetch(`${announcement.url}/cached`),
    "cached",
  );
  const secondCached = await assertHtmlResponse(
    await fetch(`${announcement.url}/cached`),
    "cached",
  );
  assert.deepEqual(secondCached.body, firstCached.body);
  assert.equal(secondCached.timestamp, firstCached.timestamp);
  assertValidObservation(
    collectObservation(firstCached.body.toString("utf8")),
    createRequestTodoState(TODO_STATE_VARIANTS[0], firstCached.timestamp),
  );
}

test("node:http serves request-materialized WebUI dynamic and cached routes", async () => {
  const server = await startNodeHttpWebuiServer({
    addonPath: undefined,
    host: "127.0.0.1",
    port: 0,
  });
  try {
    await validateWebuiServer(server, "node-http");
  } finally {
    await server.close();
  }
});

test("node:http serves the complete suite as one buffered WebUI response", async () => {
  const server = await startNodeHttpWebuiServer({
    addonPath: undefined,
    host: "127.0.0.1",
    port: 0,
    responseMode: "complete",
  });
  try {
    const { announcement } = server;
    assert.equal(announcement.status, "ready");
    const readyResponse = await fetch(`${announcement.url}/__bench/ready`);
    const metadata = await readyResponse.json();
    assert.equal(metadata.streaming, "buffered");
    assert.equal(metadata.responseMode, "complete");
    const result = await assertHtmlResponse(
      await fetch(`${announcement.url}/dynamic`),
      "dynamic",
    );
    assertValidObservation(
      collectObservation(result.body.toString("utf8")),
      createRequestTodoState(TODO_STATE_VARIANTS[0], result.timestamp),
    );
  } finally {
    await server.close();
  }
});

test("node:http renderer transport serves one product renderer", async () => {
  const server = await startNodeRendererServer({
    addonPath: undefined,
    appId: "react",
    host: "127.0.0.1",
    port: 0,
  });
  try {
    assert.equal(server.announcement.appId, "react");
    assert.equal(server.announcement.serverId, "node-http");
    assert.equal(server.announcement.workerCount, 1);
    assert.equal(server.announcement.streaming, "native");
    assert.equal(
      server.announcement.addonCapability.kind,
      "not-required",
    );
    const result = await assertHtmlResponse(
      await fetch(`${server.announcement.url}/dynamic`),
      "dynamic",
    );
    assertValidObservation(
      collectObservation(result.body.toString("utf8")),
      createRequestTodoState(TODO_STATE_VARIANTS[0], result.timestamp),
    );
  } finally {
    await server.close();
  }
});

test("node:http renderer transport rejects unknown renderer ids", async () => {
  await assert.rejects(
    startNodeRendererServer({
      addonPath: undefined,
      appId: "../../shared",
      host: "127.0.0.1",
      port: 0,
    }),
    /Unknown product renderer/,
  );
});
