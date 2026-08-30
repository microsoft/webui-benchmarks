// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DEMO_COOKIE, resolveDemoRoute } from "./routing.mjs";
import {
  registryDocument,
  renderGallery,
  renderNotFound,
} from "./gallery.mjs";

export const DEMO_GATEWAY_SCHEMA = "webui.ssr-todo-demo-gateway/v1";

/**
 * Hop-by-hop headers must never cross a proxy boundary (RFC 9110 7.6.1).
 * `content-length` is dropped as well because the gateway re-frames every
 * proxied body as a chunked stream, which is what keeps the progressive
 * variants streaming end to end.
 */
const HOP_BY_HOP = Object.freeze(
  new Set([
    "connection",
    "content-encoding",
    "content-length",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ]),
);

/** Request headers the gateway refuses to forward to a hosted application. */
const STRIPPED_REQUEST_HEADERS = Object.freeze(
  new Set([
    ...HOP_BY_HOP,
    "accept-encoding",
    "cookie",
    "forwarded",
    "host",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
  ]),
);

const SECURITY_HEADERS = Object.freeze({
  "referrer-policy": "same-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
});

const HTML_CONTENT_TYPE = "text/html; charset=utf-8";
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

function securityHeaders(secure) {
  return secure
    ? {
        ...SECURITY_HEADERS,
        "strict-transport-security": "max-age=31536000; includeSubDomains",
      }
    : SECURITY_HEADERS;
}

function isSecureRequest(request, trustProxyHeaders) {
  return (
    request.socket.encrypted === true
    || (
      trustProxyHeaders
      && request.headers["x-forwarded-proto"]?.split(",")[0].trim() === "https"
    )
  );
}

function send(
  request,
  response,
  status,
  contentType,
  body,
  {
    headers = {},
    secure,
  },
) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": String(bytes.byteLength),
    "content-type": contentType,
    ...securityHeaders(secure),
    ...headers,
  });
  response.end(request.method === "HEAD" ? undefined : bytes);
}

function productCookie(product, secure) {
  return [
    `${DEMO_COOKIE}=${product.id}`,
    "Path=/",
    "SameSite=Lax",
    "HttpOnly",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

/**
 * Keep a hosted application's redirect on the demo origin. Applications only
 * ever redirect within their own root-absolute URL space, but an absolute
 * `Location` would leak the internal loopback origin of the child process, so
 * anything pointing at that origin is reduced to its path and anything
 * protocol-relative is refused.
 */
export function rewriteLocation(location, upstreamOrigin) {
  if (typeof location !== "string" || location.length === 0) {
    return location;
  }
  if (location.startsWith("//")) {
    return "/";
  }
  if (location.startsWith("/")) {
    return location;
  }
  let parsed;
  try {
    parsed = new URL(location, upstreamOrigin);
  } catch {
    return "/";
  }
  return parsed.origin === upstreamOrigin
    ? `${parsed.pathname}${parsed.search}`
    : "/";
}

/**
 * A fixed-window per-client request limiter. The demo renders every response
 * dynamically, so an unbounded public origin would be trivially expensive; the
 * limiter bounds that cost without any external dependency.
 */
export function createRateLimiter({
  limit = 600,
  windowMilliseconds = 60_000,
  now = () => Date.now(),
} = {}) {
  const clients = new Map();
  return function admit(key) {
    const current = now();
    const entry = clients.get(key);
    if (entry === undefined || current >= entry.resetAt) {
      clients.set(key, { count: 1, resetAt: current + windowMilliseconds });
      if (clients.size > 10_000) {
        for (const [candidate, value] of clients) {
          if (current >= value.resetAt) {
            clients.delete(candidate);
          }
        }
      }
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  };
}

function clientKey(request, trustProxyHeaders) {
  if (trustProxyHeaders) {
    const forwarded = request.headers["x-forwarded-for"];
    const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const first = value?.split(",")[0].trim();
    if (first !== undefined && first.length > 0) {
      return first;
    }
  }
  return request.socket.remoteAddress ?? "unknown";
}

function forwardedRequestHeaders(request, secure, trustProxyHeaders) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (name.startsWith(":") || STRIPPED_REQUEST_HEADERS.has(name)) {
      continue;
    }
    headers.set(name, Array.isArray(value) ? value.join(", ") : String(value));
  }
  headers.set("accept-encoding", "identity");
  headers.set("x-forwarded-for", clientKey(request, trustProxyHeaders));
  headers.set("x-forwarded-proto", secure ? "https" : "http");
  const host = request.headers.host;
  if (typeof host === "string") {
    headers.set("x-forwarded-host", host);
  }
  return headers;
}

async function proxyRequest({
  entry,
  path,
  request,
  response,
  timeoutMilliseconds,
  trustProxyHeaders,
}) {
  const secure = isSecureRequest(request, trustProxyHeaders);
  const abort = new AbortController();
  const onClose = () => {
    if (!response.writableEnded) {
      abort.abort(new Error("The demo client disconnected"));
    }
  };
  response.once("close", onClose);
  let upstream;
  try {
    upstream = await fetch(`${entry.origin}${path}`, {
      headers: forwardedRequestHeaders(request, secure, trustProxyHeaders),
      method: request.method,
      redirect: "manual",
      signal: AbortSignal.any([
        abort.signal,
        AbortSignal.timeout(timeoutMilliseconds),
      ]),
    });
  } catch (error) {
    if (abort.signal.aborted) {
      return;
    }
    throw error;
  }
  const headers = {
    ...securityHeaders(secure),
    "cache-control": "no-store",
  };
  for (const [name, value] of upstream.headers) {
    if (HOP_BY_HOP.has(name) || name === "set-cookie") {
      continue;
    }
    headers[name] = name === "location"
      ? rewriteLocation(value, entry.origin)
      : value;
  }
  response.writeHead(upstream.status, headers);
  if (request.method === "HEAD" || upstream.body === null) {
    await upstream.body?.cancel(new Error("HEAD requests discard the body"));
    response.end();
    return;
  }
  await pipeline(Readable.fromWeb(upstream.body), response, {
    signal: abort.signal,
  });
}

/**
 * Create the demo gateway request handler over an already-launched registry of
 * hosted products.
 */
export function createDemoHandler({
  hosted,
  products,
  rateLimiter = createRateLimiter(),
  startedAt = Date.now(),
  timeoutMilliseconds = 30_000,
  trustProxyHeaders = false,
}) {
  const index = new Map(products.map((product) => [product.id, product]));
  const gallery = Buffer.from(renderGallery(products), "utf8");
  const notFound = Buffer.from(renderNotFound(), "utf8");
  const registry = Buffer.from(
    JSON.stringify(
      {
        ...registryDocument(products),
        schema: DEMO_GATEWAY_SCHEMA,
      },
      null,
      2,
    ),
    "utf8",
  );

  return async function handle(request, response) {
    const secure = isSecureRequest(request, trustProxyHeaders);
    if (!rateLimiter(clientKey(request, trustProxyHeaders))) {
      send(request, response, 429, "text/plain; charset=utf-8", "Too many requests", {
        headers: { "retry-after": "60" },
        secure,
      });
      return;
    }
    const action = resolveDemoRoute({
      headers: request.headers,
      method: request.method ?? "GET",
      origin: `${secure ? "https" : "http"}://${request.headers.host ?? "demo.invalid"}`,
      products: index,
      url: request.url ?? "/",
    });

    if (action.kind === "method-not-allowed") {
      send(request, response, 405, "text/plain; charset=utf-8", "Method not allowed", {
        headers: { allow: "GET, HEAD" },
        secure,
      });
      return;
    }
    if (action.kind === "gallery") {
      send(request, response, 200, HTML_CONTENT_TYPE, gallery, { secure });
      return;
    }
    if (action.kind === "registry") {
      send(request, response, 200, JSON_CONTENT_TYPE, registry, { secure });
      return;
    }
    if (action.kind === "health" || action.kind === "ready") {
      const ready = hosted.size === products.length;
      const body = JSON.stringify({
        hosted: hosted.size,
        products: products.length,
        status: ready ? "ready" : "starting",
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1_000),
      });
      const healthy = action.kind === "health" || ready;
      send(
        request,
        response,
        healthy ? 200 : 503,
        JSON_CONTENT_TYPE,
        body,
        { secure },
      );
      return;
    }
    if (action.kind === "launch") {
      send(request, response, 302, HTML_CONTENT_TYPE, "", {
        headers: {
          location: action.location,
          "set-cookie": productCookie(action.product, secure),
        },
        secure,
      });
      return;
    }
    if (action.kind === "proxy") {
      const entry = hosted.get(action.product.id);
      if (entry === undefined) {
        send(
          request,
          response,
          503,
          "text/plain; charset=utf-8",
          `${action.product.id} is still starting`,
          { headers: { "retry-after": "5" }, secure },
        );
        return;
      }
      const assetPath = action.path.split("?")[0];
      const asset = entry.assets.get(assetPath);
      if (asset !== undefined) {
        send(request, response, 200, asset.contentType, asset.body, {
          headers: { "cache-control": asset.cacheControl },
          secure,
        });
        return;
      }
      await proxyRequest({
        entry,
        path: action.path,
        request,
        response,
        timeoutMilliseconds,
        trustProxyHeaders,
      });
      return;
    }
    send(request, response, 404, HTML_CONTENT_TYPE, notFound, { secure });
  };
}

export function startDemoGateway({
  handler,
  headersTimeout = 20_000,
  host = "0.0.0.0",
  port = 8080,
  requestTimeout = 60_000,
  trustProxyHeaders = false,
}) {
  const server = createServer((request, response) => {
    void Promise.resolve(handler(request, response)).catch((error) => {
      if (response.destroyed) {
        return;
      }
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      send(
        request,
        response,
        502,
        "text/plain; charset=utf-8",
        "The hosted application could not be reached",
        { secure: isSecureRequest(request, trustProxyHeaders) },
      );
    });
  });
  server.headersTimeout = headersTimeout;
  server.requestTimeout = requestTimeout;
  server.maxHeadersCount = 100;
  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolveServer(
        Object.freeze({
          close: () =>
            new Promise((resolveClose, rejectClose) => {
              server.closeAllConnections();
              server.close((error) => (error ? rejectClose(error) : resolveClose()));
            }),
          port: typeof address === "object" && address !== null
            ? address.port
            : port,
          server,
        }),
      );
    });
  });
}
