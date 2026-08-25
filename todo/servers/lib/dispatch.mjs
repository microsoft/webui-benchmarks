// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Buffer } from "node:buffer";
import {
  CACHED_PATH,
  DYNAMIC_PATH,
  READY_PATH,
  htmlHeaders,
  jsonHeaders,
} from "./contract.mjs";

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

  return async function dispatch(requestUrl, method = "GET") {
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
    } else if (pathname === DYNAMIC_PATH) {
      const result = await controller.renderDynamic();
      response = Object.freeze({
        body: result.body,
        headers: htmlHeaders(result),
        status: 200,
      });
    } else if (pathname === CACHED_PATH) {
      response = cachedResponse;
    } else {
      response = jsonResponse(404, {
        code: "route-not-found",
        message: `Use ${DYNAMIC_PATH}, ${CACHED_PATH}, or ${READY_PATH}.`,
      });
    }
    return Object.freeze({
      ...response,
      headOnly: normalizedMethod === "HEAD",
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
