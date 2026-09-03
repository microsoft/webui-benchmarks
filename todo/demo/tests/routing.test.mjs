// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import { createDemoRegistry } from "../registry.mjs";
import {
  DEMO_COOKIE,
  ENTRY_ROUTE,
  pinnedProductId,
  resolveDemoRoute,
  splitBasePath,
} from "../routing.mjs";

const products = new Map(
  createDemoRegistry().map((product) => [product.id, product]),
);
const first = "react--progressive";
const second = "solid--complete";

function resolve(url, { cookie, method = "GET" } = {}) {
  return resolveDemoRoute({
    headers: cookie === undefined ? {} : { cookie },
    method,
    origin: "https://demo.example",
    products,
    url,
  });
}

test("gateway endpoints resolve before any hosted application", () => {
  assert.equal(resolve("/").kind, "gallery");
  assert.equal(resolve("/healthz").kind, "health");
  assert.equal(resolve("/readyz").kind, "ready");
  assert.equal(resolve("/_demo/apps.json").kind, "registry");
});

test("only safe read methods are accepted", () => {
  for (const method of ["POST", "PUT", "DELETE", "PATCH", "TRACE"]) {
    assert.equal(resolve("/dynamic", { method }).kind, "method-not-allowed");
  }
  assert.equal(resolve("/", { method: "head" }).kind, "gallery");
});

test("a benchmark path proxies directly without session state", () => {
  const action = resolve(`/benchmark/${first}${ENTRY_ROUTE}`);
  assert.equal(action.kind, "proxy");
  assert.equal(action.product.id, first);
  assert.equal(action.path, ENTRY_ROUTE);
  assert.equal(
    resolve(`/benchmark/${first}/activity?filter=all`).path,
    "/activity?filter=all",
  );
});

test("an app launch pins the product and redirects onto the origin root", () => {
  const action = resolve(`/app/${first}${ENTRY_ROUTE}`);
  assert.equal(action.kind, "launch");
  assert.equal(action.product.id, first);
  assert.equal(action.location, ENTRY_ROUTE);
  assert.equal(resolve(`/app/${first}`).location, ENTRY_ROUTE);
  assert.equal(resolve(`/app/${first}/`).location, ENTRY_ROUTE);
  assert.equal(resolve(`/app/${first}/activity?filter=all`).location, "/activity?filter=all");
});

test("an unknown product is never launched", () => {
  assert.equal(resolve("/app/does-not-exist/dynamic").kind, "not-found");
  assert.equal(resolve("/app/..%2F..%2Fetc/passwd").kind, "not-found");
  assert.equal(resolve(`/app/${first}//evil.example/x`).kind, "not-found");
});

test("the pinned product serves every other path unchanged", () => {
  const action = resolve("/__browser/react.js", {
    cookie: `${DEMO_COOKIE}=${first}`,
  });
  assert.equal(action.kind, "proxy");
  assert.equal(action.product.id, first);
  assert.equal(action.path, "/__browser/react.js");
  assert.equal(
    resolve("/activity?filter=deployment", { cookie: `${DEMO_COOKIE}=${first}` })
      .path,
    "/activity?filter=deployment",
  );
});

test("an app launch re-pins the browsing session", () => {
  const action = resolve(`/app/${second}${ENTRY_ROUTE}`, {
    cookie: `${DEMO_COOKIE}=${first}`,
  });
  assert.equal(action.kind, "launch");
  assert.equal(action.product.id, second);
});

test("an unpinned request falls through to the not-found page", () => {
  assert.equal(resolve("/dynamic").kind, "not-found");
  assert.equal(resolve("/dynamic", { cookie: "other=1" }).kind, "not-found");
  assert.equal(
    resolve("/dynamic", { cookie: `${DEMO_COOKIE}=../../etc` }).kind,
    "not-found",
  );
});

test("cookie parsing accepts only a well-formed product name", () => {
  assert.equal(pinnedProductId(`${DEMO_COOKIE}=${first}`), first);
  assert.equal(pinnedProductId(`a=1; ${DEMO_COOKIE}=${first}; b=2`), first);
  assert.equal(pinnedProductId(`${DEMO_COOKIE}=with space`), null);
  assert.equal(pinnedProductId(`${DEMO_COOKIE}=`), null);
  assert.equal(pinnedProductId(undefined), null);
});

test("launch paths are split without ever escaping the prefix", () => {
  assert.deepEqual(splitBasePath("/app/react--complete/activity"), {
    path: "/activity",
    productId: "react--complete",
  });
  assert.equal(splitBasePath("/activity"), null);
  assert.equal(splitBasePath("/app/react/../../etc"), null);
});
