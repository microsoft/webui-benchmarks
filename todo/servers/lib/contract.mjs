// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Buffer } from "node:buffer";
import { STATE_VARIANT_COUNT } from "../../shared/contract.mjs";
import {
  createRequestTodoState,
  currentRequestTimestamp,
} from "../../shared/state.mjs";
import {
  controlledDocument,
  controlledDocumentStream,
} from "../../shared/document.mjs";
import { collectByteStream } from "../../shared/streaming.mjs";

export { STATE_VARIANT_COUNT };
export const SERVER_SCHEMA = "webui.ssr-todo-server/v1";
export const READY_PATH = "/__bench/ready";
export const DYNAMIC_PATH = "/dynamic";
export const ACTIVITY_PATH = "/activity";
export const SETTINGS_PATH = "/settings";
export const CACHED_PATH = "/cached";
export const CACHE_MODE = "dynamic-and-cached";
export const INPUT_POLICY = "request-timestamped-input";
export const HTML_CONTENT_TYPE = "text/html; charset=utf-8";
export const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
export const DYNAMIC_CACHE_CONTROL = "no-store";
export const CACHED_CACHE_CONTROL =
  "public, max-age=31536000, immutable";
const PROFILE_TIMESTAMP = "2000-01-01T00:00:00.000000Z";

export function toResponseBytes(value) {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (typeof value === "string") {
    return Buffer.from(value, "utf8");
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError("A renderer must return a string, Buffer, or Uint8Array");
}

function summarizeDynamicBytes(lengths) {
  let minimum = Number.MAX_SAFE_INTEGER;
  let maximum = 0;
  for (const length of lengths) {
    minimum = Math.min(minimum, length);
    maximum = Math.max(maximum, length);
  }
  return Object.freeze({
    byVariant: Object.freeze(lengths),
    maximum,
    minimum,
  });
}

function validateStates(states) {
  if (!Array.isArray(states) || states.length !== STATE_VARIANT_COUNT) {
    throw new RangeError(
      `The server state pool must contain exactly ${STATE_VARIANT_COUNT} variants`,
    );
  }
}

async function renderResponse(render, state, documentOptions, requestPath) {
  const rendered = await render(state, requestPath);
  if (documentOptions === null) {
    return rendered;
  }
  if (typeof rendered !== "string") {
    throw new TypeError(
      `${documentOptions.appId} must render a string before document hydration wrapping`,
    );
  }
  return controlledDocument({
    ...documentOptions,
    fragment: rendered,
    state,
  });
}

async function renderStreamResponse(
  renderStream,
  state,
  documentOptions,
  requestPath,
  options,
) {
  const rendered = await renderStream(state, requestPath, options);
  if (!(rendered instanceof ReadableStream)) {
    throw new TypeError("A streaming renderer must return a ReadableStream");
  }
  return documentOptions === null
    ? rendered
    : controlledDocumentStream({
        ...documentOptions,
        fragment: rendered,
        state,
      });
}

async function collectResponse(render, renderStream, state, documentOptions, path) {
  if (renderStream === null) {
    return toResponseBytes(
      await renderResponse(render, state, documentOptions, path),
    );
  }
  return toResponseBytes(
    await collectByteStream(
      await renderStreamResponse(renderStream, state, documentOptions, path),
    ),
  );
}

export async function createRouteController(options) {
  const {
    addonCapability,
    appId,
    document: documentOptions = null,
    render,
    renderStream = null,
    renderPartial = null,
    responseMode = "progressive",
    runtimeId,
    runtimeVersion,
    serverId,
    states,
    streaming,
  } = options;
  validateStates(states);
  if (typeof render !== "function") {
    throw new TypeError("render must be a function");
  }
  if (renderStream !== null && typeof renderStream !== "function") {
    throw new TypeError("renderStream must be a function or null");
  }
  if (!["complete", "progressive"].includes(responseMode)) {
    throw new RangeError(`Unknown response mode '${responseMode}'`);
  }
  // The complete suite always publishes one fully collected HTML response:
  // every controlled renderer already ships a genuine complete-response API
  // (see each app's render() adapter), so the complete suite calls it
  // directly instead of collecting the native renderStream() output.
  const effectiveRenderStream = responseMode === "complete" ? null : renderStream;
  const resolvedStreaming = responseMode === "complete"
    ? "buffered"
    : streaming ?? (effectiveRenderStream === null ? "buffered" : "native");
  if (
    !["buffered", "native", "progressive-boundaries"].includes(resolvedStreaming)
  ) {
    throw new RangeError(`Unknown streaming mode '${resolvedStreaming}'`);
  }

  const dynamicLengths = new Array(states.length);
  for (let index = 0; index < states.length; index += 1) {
    const body = await collectResponse(
      render,
      effectiveRenderStream,
      createRequestTodoState(states[index], PROFILE_TIMESTAMP),
      documentOptions,
      DYNAMIC_PATH,
    );
    dynamicLengths[index] = body.byteLength;
  }
  const cachedTimestamp = currentRequestTimestamp();
  const cachedBody = await collectResponse(
    render,
    effectiveRenderStream,
    createRequestTodoState(states[0], cachedTimestamp),
    documentOptions,
    CACHED_PATH,
  );
  const responseBytes = Object.freeze({
    cached: cachedBody.byteLength,
    dynamic: summarizeDynamicBytes(dynamicLengths),
  });
  const metadata = Object.freeze({
    addonCapability: Object.freeze({ ...addonCapability }),
    appId,
    cacheMode: CACHE_MODE,
    inputPolicy: INPUT_POLICY,
    naturalResponseBytes: responseBytes,
    payloadPolicy: "natural",
    responseBytes,
    responseMode,
    routes: Object.freeze({
      cached: CACHED_PATH,
      dynamic: DYNAMIC_PATH,
      activity: ACTIVITY_PATH,
      ready: READY_PATH,
      settings: SETTINGS_PATH,
    }),
    runtimeId,
    runtimeVersion,
    schema: SERVER_SCHEMA,
    serverId,
    stateVariantCount: states.length,
    status: "ready",
    streaming: resolvedStreaming,
    workerCount: 1,
  });
  let nextVariant = 0;

  return Object.freeze({
    cached() {
      return Object.freeze({
        body: cachedBody,
        cacheMode: "cached",
        requestTimestamp: cachedTimestamp,
        variantIndex: 0,
      });
    },
    metadata,
    async renderDynamic(requestPath = DYNAMIC_PATH, streamOptions) {
      const variantIndex = nextVariant;
      nextVariant = (nextVariant + 1) % states.length;
      const requestTimestamp = currentRequestTimestamp();
      const requestState = createRequestTodoState(
        states[variantIndex],
        requestTimestamp,
      );
      return Object.freeze({
        body: effectiveRenderStream === null
          ? toResponseBytes(
              await renderResponse(
                render,
                requestState,
                documentOptions,
                requestPath,
              ),
            )
          : await renderStreamResponse(
              effectiveRenderStream,
              requestState,
              documentOptions,
              requestPath,
              streamOptions,
            ),
        cacheMode: "dynamic",
        requestTimestamp,
        variantIndex,
      });
    },
    async renderPartial(requestPath, inventoryHex = "") {
      if (typeof renderPartial !== "function") {
        throw new TypeError(`${appId} does not support partial route rendering`);
      }
      const variantIndex = nextVariant;
      nextVariant = (nextVariant + 1) % states.length;
      const requestTimestamp = currentRequestTimestamp();
      const requestState = createRequestTodoState(
        states[variantIndex],
        requestTimestamp,
      );
      return Object.freeze({
        body: toResponseBytes(
          await renderPartial(requestState, requestPath, inventoryHex),
        ),
        cacheMode: "dynamic",
        requestTimestamp,
        variantIndex,
      });
    },
  });
}

export function htmlHeaders(result) {
  return {
    "cache-control":
      result.cacheMode === "cached"
        ? CACHED_CACHE_CONTROL
        : DYNAMIC_CACHE_CONTROL,
    ...(Number.isFinite(result.body?.byteLength)
      ? { "content-length": String(result.body.byteLength) }
      : {}),
    "content-type": HTML_CONTENT_TYPE,
    "x-webui-bench-cache": result.cacheMode,
    "x-webui-bench-timestamp": result.requestTimestamp,
    "x-webui-bench-variant": String(result.variantIndex),
  };
}

export function jsonHeaders(body) {
  return {
    "cache-control": DYNAMIC_CACHE_CONTROL,
    "content-length": String(body.byteLength),
    "content-type": JSON_CONTENT_TYPE,
  };
}
