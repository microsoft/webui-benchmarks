// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Request routing for the single-origin demo gateway.
 *
 * Every hosted todo application owns the root of its own URL space: the
 * benchmark contract fixes `/dynamic`, `/activity`, `/settings`, and `/cached`,
 * and each framework emits root-absolute asset URLs (`/__browser/...`,
 * `/_next/...`, `/_nuxt/...`). Hosting 24 of those applications behind one
 * container port therefore needs an explicit resolution order rather than a
 * plain prefix strip:
 *
 *   1. `/app/{productId}/{route}` is the launch entry point. It pins the
 *      product onto the browsing session with a cookie and redirects to
 *      `{route}` on the demo origin, so gallery links and shared deep links
 *      both work while the hosted application still owns the root path.
 *   2. Every other request is served by the pinned product, exactly at the path
 *      the application emitted. Serving each application from the origin root
 *      is what keeps it byte-for-byte the benchmark artifact: its router, its
 *      root-absolute asset URLs, and its module identities are untouched, and
 *      the gateway never rewrites markup. The cost is that one browsing session
 *      shows one product at a time; launching another product re-pins it.
 *   3. Anything left over is answered by the gallery's not-found page.
 *
 * All functions here are pure so the resolution order is unit tested without
 * sockets.
 */

export const DEMO_COOKIE = "webui-demo-product";
export const HEALTH_PATH = "/healthz";
export const READY_PATH = "/readyz";
export const REGISTRY_PATH = "/_demo/apps.json";
export const GALLERY_PATH = "/";
export const APP_PREFIX = "/app/";

const PRODUCT_ID_PATTERN = /^[\w.-]+$/u;
const ALLOWED_METHODS = Object.freeze(new Set(["GET", "HEAD"]));

/** Route every product opens on. */
export const ENTRY_ROUTE = "/dynamic";

function headerValue(headers, name) {
  const value = headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Split `/app/{productId}/rest` into its product id and the path the hosted
 * application actually sees. Returns `null` when the path is not prefixed.
 */
export function splitBasePath(pathname) {
  if (!pathname.startsWith(APP_PREFIX)) {
    return null;
  }
  const remainder = pathname.slice(APP_PREFIX.length);
  const boundary = remainder.indexOf("/");
  const productId = boundary === -1 ? remainder : remainder.slice(0, boundary);
  if (!PRODUCT_ID_PATTERN.test(productId)) {
    return null;
  }
  return Object.freeze({
    path: boundary === -1 ? "" : remainder.slice(boundary),
    productId,
  });
}

export function pinnedProductId(cookieHeader) {
  if (typeof cookieHeader !== "string" || cookieHeader.length === 0) {
    return null;
  }
  for (const pair of cookieHeader.split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) {
      continue;
    }
    if (pair.slice(0, separator).trim() !== DEMO_COOKIE) {
      continue;
    }
    const value = pair.slice(separator + 1).trim();
    return PRODUCT_ID_PATTERN.test(value) ? value : null;
  }
  return null;
}

function proxy(product, path) {
  return Object.freeze({ kind: "proxy", path, product });
}

function launch(product, location) {
  return Object.freeze({ kind: "launch", location, product });
}

/**
 * Resolve one request into a gateway action.
 *
 * @param {object} request
 * @param {string} request.url Raw request target (path plus query).
 * @param {string} request.method
 * @param {object} request.headers Lowercase Node request headers.
 * @param {Map<string, object>} request.products Registry indexed by product id.
 * @param {string} request.origin Absolute origin used to parse relative URLs.
 */
export function resolveDemoRoute({
  headers = {},
  method = "GET",
  origin = "http://demo.invalid",
  products,
  url,
}) {
  if (!ALLOWED_METHODS.has(method.toUpperCase())) {
    return Object.freeze({ kind: "method-not-allowed" });
  }
  let target;
  try {
    target = new URL(url, origin);
  } catch {
    return Object.freeze({ kind: "not-found" });
  }
  const { pathname, search } = target;

  if (pathname === GALLERY_PATH) {
    return Object.freeze({ kind: "gallery" });
  }
  if (pathname === HEALTH_PATH) {
    return Object.freeze({ kind: "health" });
  }
  if (pathname === READY_PATH) {
    return Object.freeze({ kind: "ready" });
  }
  if (pathname === REGISTRY_PATH) {
    return Object.freeze({ kind: "registry" });
  }

  const launched = splitBasePath(pathname);
  if (launched !== null) {
    const product = products.get(launched.productId);
    if (product === undefined) {
      return Object.freeze({ kind: "not-found" });
    }
    const route = launched.path === "" || launched.path === "/"
      ? ENTRY_ROUTE
      : launched.path;
    return launch(product, `${route}${search}`);
  }

  const pinned = products.get(
    pinnedProductId(headerValue(headers, "cookie")) ?? "",
  );
  if (pinned !== undefined) {
    return proxy(pinned, `${pathname}${search}`);
  }
  return Object.freeze({ kind: "not-found" });
}
