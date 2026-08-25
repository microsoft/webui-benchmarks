// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Buffer } from "node:buffer";
import { collectHtmlObservation } from "../../shared/observation.mjs";
import {
  TODO_STATE_VARIANTS,
  createRequestTodoState,
} from "../../shared/state.mjs";
import {
  assertValidObservation,
  validateTodoState,
} from "../../shared/validator.mjs";
import { NATURAL_PAYLOAD_POLICY, PRODUCT_KINDS } from "./cases.mjs";
import { assertServerMetadata } from "./server.mjs";

async function fetchResponse(url) {
  const requestedAt = Date.now();
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "accept-encoding": "gzip, br, deflate",
    },
    signal: AbortSignal.timeout(15_000),
  });
  const body = Buffer.from(await response.arrayBuffer());
  const completedAt = Date.now();
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}: ${body.toString("utf8")}`);
  }
  return Object.freeze({
    body,
    completedAt,
    headers: response.headers,
    requestedAt,
    status: response.status,
  });
}

function validateHtmlHeaders(
  benchmarkCase,
  response,
  cacheMode,
) {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("text/html")) {
    throw new Error(`${benchmarkCase.id} returned '${contentType}' instead of HTML`);
  }
  const contentEncoding = response.headers.get("content-encoding");
  if (contentEncoding !== null && contentEncoding !== "identity") {
    throw new Error(
      `${benchmarkCase.id} enabled forbidden response compression '${contentEncoding}'`,
    );
  }
  const cacheControl =
    response.headers.get("cache-control")?.toLowerCase() ?? "";
  if (cacheMode === "dynamic") {
    if (!cacheControl.includes("no-store")) {
      throw new Error(`${benchmarkCase.id} dynamic route is not no-store`);
    }
  } else if (
    cacheControl.length === 0
    || cacheControl.includes("no-store")
    || cacheControl.includes("no-cache")
  ) {
    throw new Error(`${benchmarkCase.id} cached route is not cacheable`);
  }
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null
    && Number(contentLength) !== response.body.byteLength
  ) {
    throw new Error(`${benchmarkCase.id} returned an invalid content-length`);
  }
}

function validateSemanticBody(response, state) {
  assertValidObservation(
    collectHtmlObservation(response.body.toString("utf8")),
    state,
  );
}

function validateHydratableRendererDocument(benchmarkCase, response, state) {
  if (benchmarkCase.productKind !== PRODUCT_KINDS.renderer) {
    return;
  }
  const html = response.body.toString("utf8");
  const statePrefix = "globalThis.__TODO_BENCH_INITIAL_STATE__=";
  const stateStart = html.indexOf(statePrefix);
  const stateEnd = stateStart === -1
    ? -1
    : html.indexOf(";</script>", stateStart + statePrefix.length);
  if (
    !html.trimStart().toLowerCase().startsWith("<!doctype html>")
    || !html.includes('id="todo-browser-root"')
    || stateStart === -1
    || stateEnd === -1
    || !html.includes(
      `<script type="module" src="/__browser/${benchmarkCase.appId}.js">`,
    )
  ) {
    throw new Error(
      `${benchmarkCase.id} must return a complete hydratable SSR document`,
    );
  }
  const serializedState = JSON.parse(
    html.slice(stateStart + statePrefix.length, stateEnd),
  );
  const validation = validateTodoState(serializedState);
  if (
    !validation.valid
    || serializedState.variantIndex !== state.variantIndex
    || serializedState.requestTimestamp !== state.requestTimestamp
    || serializedState.todos.some(
      (todo, index) => todo.title !== state.todos[index]?.title,
    )
  ) {
    throw new Error(
      `${benchmarkCase.id} hydration state must match its measured SSR markup`,
    );
  }
}

function variantIndex(response, fallback) {
  const value = response.headers.get("x-webui-bench-variant");
  if (value === null) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed)
    && parsed >= 0
    && parsed < TODO_STATE_VARIANTS.length
    ? parsed
    : fallback;
}

function responseTimestamp(response, requireCurrent) {
  const header = response.headers.get("x-webui-bench-timestamp");
  const html = response.body.toString("utf8");
  const timestamps = collectHtmlObservation(html).visibleSubtree.items.map(
    ({ title }) => title.match(
      /^Todo \d{4} · (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)$/u,
    )?.[1],
  );
  const unique = new Set(timestamps);
  if (
    timestamps.length !== 100
    || unique.size !== 1
    || (header !== null && !unique.has(header))
  ) {
    throw new Error(
      "SSR response must render one request timestamp on all 100 todos",
    );
  }
  const timestamp = header ?? timestamps[0];
  if (requireCurrent) {
    const timestampMs = Date.parse(timestamp);
    if (
      !Number.isFinite(timestampMs)
      || timestampMs < response.requestedAt - 1_000
      || timestampMs > response.completedAt + 1_000
    ) {
      throw new Error(`SSR response timestamp '${timestamp}' is not current`);
    }
  }
  return timestamp;
}

function byteSummary(values) {
  return Object.freeze({
    byVariant: Object.freeze(values),
    maximum: Math.max(...values),
    mean: values.reduce((total, value) => total + value, 0) / values.length,
    minimum: Math.min(...values),
  });
}

async function validateReadyEndpoint(benchmarkCase, server) {
  if (benchmarkCase.launcher.kind === "full-stack") {
    return;
  }
  const response = await fetchResponse(
    `${server.announcement.url}/__bench/ready`,
  );
  const encoding = response.headers.get("content-encoding");
  if (encoding !== null && encoding !== "identity") {
    throw new Error(`${benchmarkCase.id} compressed readiness metadata`);
  }
  const metadata = JSON.parse(response.body.toString("utf8"));
  assertServerMetadata(benchmarkCase, metadata);
  if (
    metadata.runtimeVersion !== server.announcement.runtimeVersion
    || metadata.cacheMode !== "dynamic-and-cached"
  ) {
    throw new Error(`${benchmarkCase.id} readiness metadata changed after start`);
  }
}

function assertNaturalPayload(benchmarkCase, server) {
  const announced = server.announcement.payloadPolicy;
  if (announced !== undefined && announced !== NATURAL_PAYLOAD_POLICY) {
    throw new Error(
      `${benchmarkCase.id} announced payload policy '${announced}' instead of natural response bytes`,
    );
  }
}

export async function validateServerContract(benchmarkCase, server) {
  assertServerMetadata(benchmarkCase, server.announcement);
  assertNaturalPayload(benchmarkCase, server);
  await validateReadyEndpoint(benchmarkCase, server);
  const dynamicPath = benchmarkCase.dynamicRoute;
  const dynamicResponses = [];
  const requestTimestamps = new Set();
  for (
    let expectedIndex = 0;
    expectedIndex < TODO_STATE_VARIANTS.length;
    expectedIndex += 1
  ) {
    const response = await fetchResponse(
      `${server.announcement.url}${dynamicPath}`,
    );
    validateHtmlHeaders(benchmarkCase, response, "dynamic");
    const observedIndex = variantIndex(response, expectedIndex);
    if (observedIndex !== expectedIndex) {
      throw new Error(
        `${benchmarkCase.id} dynamic route returned variant ${observedIndex}, expected ${expectedIndex}`,
      );
    }
    const requestTimestamp = responseTimestamp(response, true);
    if (requestTimestamps.has(requestTimestamp)) {
      throw new Error(
        `${benchmarkCase.id} reused request timestamp '${requestTimestamp}'`,
      );
    }
    requestTimestamps.add(requestTimestamp);
    const expectedState = createRequestTodoState(
      TODO_STATE_VARIANTS[observedIndex],
      requestTimestamp,
    );
    validateSemanticBody(response, expectedState);
    validateHydratableRendererDocument(benchmarkCase, response, expectedState);
    dynamicResponses.push(response);
  }
  const firstDynamic = dynamicResponses[0];
  if (
    dynamicResponses.every((response) =>
      response.body.equals(firstDynamic.body)
    )
  ) {
    throw new Error(`${benchmarkCase.id} dynamic route did not rotate variants`);
  }

  const firstCached = await fetchResponse(
    `${server.announcement.url}${benchmarkCase.cacheRoute}`,
  );
  const secondCached = await fetchResponse(
    `${server.announcement.url}${benchmarkCase.cacheRoute}`,
  );
  validateHtmlHeaders(benchmarkCase, firstCached, "cached");
  validateHtmlHeaders(benchmarkCase, secondCached, "cached");
  const cachedTimestamp = responseTimestamp(firstCached, false);
  if (responseTimestamp(secondCached, false) !== cachedTimestamp) {
    throw new Error(`${benchmarkCase.id} cached route changed its timestamp`);
  }
  const cachedState = createRequestTodoState(
    TODO_STATE_VARIANTS[0],
    cachedTimestamp,
  );
  validateSemanticBody(firstCached, cachedState);
  validateSemanticBody(secondCached, cachedState);
  if (!firstCached.body.equals(secondCached.body)) {
    throw new Error(`${benchmarkCase.id} cached route changed response bytes`);
  }

  const dynamicBytes = byteSummary(
    dynamicResponses.map((response) => response.body.byteLength),
  );
  return Object.freeze({
    cachedBytes: firstCached.body.byteLength,
    dynamicBytes: dynamicBytes.byVariant,
    inputPolicy:
      server.announcement.inputPolicy ?? benchmarkCase.inputPolicy,
    measuredBytes: dynamicBytes.mean,
    naturalResponseBytes: dynamicBytes.mean,
    payloadPolicy: NATURAL_PAYLOAD_POLICY,
    responseByteProfile: Object.freeze({
      cachedRouteContract: firstCached.body.byteLength,
      dynamic: dynamicBytes,
    }),
  });
}

export function routeForCase(benchmarkCase) {
  return benchmarkCase.dynamicRoute;
}
