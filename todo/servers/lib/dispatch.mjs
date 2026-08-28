// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Buffer } from "node:buffer";
import {
  ACTIVITY_PATH,
  CACHED_PATH,
  DYNAMIC_PATH,
  READY_PATH,
  SETTINGS_PATH,
  htmlHeaders,
  jsonHeaders,
} from "./contract.mjs";

const DYNAMIC_ROUTES = new Set([
  DYNAMIC_PATH,
  ACTIVITY_PATH,
  SETTINGS_PATH,
]);

function requestHeader(headers, name) {
  if (headers?.get instanceof Function) {
    return headers.get(name);
  }
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value.join(",") : value ?? null;
}

function jsonResponse(status, value) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  return Object.freeze({
    body,
    headers: jsonHeaders(body),
    status,
  });
}

export function createRequestDispatcher(controller) {
  const readyResponse = jsonResponse(200, controller.metadata);
  const cachedResult = controller.cached();
  const cachedResponse = Object.freeze({
    body: cachedResult.body,
    headers: htmlHeaders(cachedResult),
    status: 200,
  });

  return async function dispatch(
    requestUrl,
    method = "GET",
    headers = {},
    options = undefined,
  ) {
    const normalizedMethod = method.toUpperCase();
    if (normalizedMethod !== "GET" && normalizedMethod !== "HEAD") {
      return jsonResponse(405, {
        code: "method-not-allowed",
        message: "Benchmark routes accept only GET and HEAD requests.",
      });
    }
    const pathname = new URL(requestUrl, "http://127.0.0.1").pathname;
    let response;
    if (pathname === READY_PATH || pathname === "/ready") {
      response = readyResponse;
    } else if (DYNAMIC_ROUTES.has(pathname)) {
      const acceptsJson = requestHeader(headers, "accept")
        ?.split(",")
        .some((value) =>
          value.trim().startsWith("application/json")
          || value.trim().startsWith("application/x-ndjson")
        ) ?? false;
      const result = acceptsJson
        ? await controller.renderPartial(
            pathname,
            requestHeader(headers, "x-webui-inventory") ?? "",
          )
        : await controller.renderDynamic(pathname, options);
      response = Object.freeze({
        body: result.body,
        headers: acceptsJson
          ? {
              ...jsonHeaders(result.body),
              "x-webui-bench-timestamp": result.requestTimestamp,
              "x-webui-bench-variant": String(result.variantIndex),
            }
          : htmlHeaders(result),
        status: 200,
      });
    } else if (pathname === CACHED_PATH) {
      response = cachedResponse;
    } else {
      response = jsonResponse(404, {
        code: "route-not-found",
        message:
          `Use ${DYNAMIC_PATH}, ${ACTIVITY_PATH}, ${SETTINGS_PATH}, ${CACHED_PATH}, or ${READY_PATH}.`,
      });
    }
    const headOnly = normalizedMethod === "HEAD";
    if (headOnly && response.body instanceof ReadableStream) {
      await response.body.cancel(
        new Error("HEAD requests do not consume renderer streams"),
      );
    }
    return Object.freeze({
      ...response,
      headOnly,
    });
  };
}

export function internalErrorResponse(error) {
  const message = error instanceof Error ? error.message : String(error);
  return jsonResponse(500, {
    code: "render-failed",
    message,
  });
}
