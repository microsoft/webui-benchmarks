// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import {
  PRODUCT_ORDER,
  createBrowserCases,
} from "../apps.mjs";
import {
  enforceProductionMode,
  isRetryableBrowserInfrastructureFailure,
  normalizeOptions,
} from "../runner.mjs";

const EXPECTED_PRODUCTS = Object.freeze([
  "webui-rust-actix",
  "webui-shadowdom-rust-actix",
  "webui-fast-rust-actix",
  "webui-bun-serve",
  "webui-deno-serve",
  "webui-node-http",
  "sveltekit",
  "nuxt",
  "next",
  "astro",
  "vue",
  "lit",
  "preact",
  "react",
  "react-tanstack",
  "solid",
]);

test("browser suite contains the definitive 16 product rows", () => {
  const cases = createBrowserCases();
  assert.deepEqual(PRODUCT_ORDER, EXPECTED_PRODUCTS);
  assert.deepEqual(
    cases.map(({ productId }) => productId),
    EXPECTED_PRODUCTS,
  );
  assert.equal(new Set(cases.map(({ productId }) => productId)).size, 16);
  assert.ok(
    cases.every(({ clientMode, hydration }) =>
      hydration.status !== "unsupported"
      && hydration.framework.length > 0
      && clientMode.includes("hydrate")
    ),
    "every browser product must use a real framework hydration path",
  );
  assert.ok(
    cases.every(
      ({ routing }) =>
        routing.clientNavigation === "supported"
        && routing.router.length > 0
        && routing.journey.join(",")
          === "/dynamic,/activity,/settings,/dynamic",
    ),
    "every browser product must use its production client router",
  );
});

test("WebUI app filter selects the five base DOM/transport products", () => {
  const cases = createBrowserCases(["webui"]);
  assert.deepEqual(
    cases.map(({ productId }) => productId),
    [
      "webui-rust-actix",
      "webui-shadowdom-rust-actix",
      "webui-bun-serve",
      "webui-deno-serve",
      "webui-node-http",
    ],
  );
  assert.ok(
    cases.every(({ initialStateSource }) =>
      initialStateSource === "ssr-document"
    ),
  );
});

test("JavaScript-hosted WebUI rows use the Light DOM protocol", () => {
  const cases = createBrowserCases([
    "webui-bun-serve",
    "webui-deno-serve",
    "webui-node-http",
  ]);
  assert.deepEqual(
    cases.map(({ label }) => label),
    [
      "WebUI / Light DOM / Bun.serve",
      "WebUI / Light DOM / Deno.serve",
      "WebUI / Light DOM / Node node:http",
    ],
  );
  assert.ok(
    cases.every(({ sourceCase }) =>
      sourceCase.launcher.protocol
        === "todo/apps/webui-lightdom/dist/protocol.bin"
    ),
  );
  const fast = createBrowserCases(["webui-fast"])[0];
  assert.equal(fast.label, "WebUI / FAST V3 / Rust / Actix");
  assert.equal(
    fast.sourceCase.launcher.protocol,
    "todo/apps/webui-fast/dist/protocol.bin",
  );
});

test("FAST app filter selects its dedicated Rust/Actix product", () => {
  const cases = createBrowserCases(["webui-fast"]);
  assert.deepEqual(
    cases.map(({ productId }) => productId),
    ["webui-fast-rust-actix"],
  );
  assert.equal(
    cases[0].hydration.framework,
    "@microsoft/fast-element 3 declarative hydration",
  );
});

test("Astro browser row uses a real Preact hydration island", () => {
  const astro = createBrowserCases(["astro"])[0];
  assert.equal(astro.label, "Astro + Preact");
  assert.equal(astro.clientMode, "framework-island-hydrate");
  assert.equal(astro.hydration.status, "supported");
  assert.equal(astro.hydration.framework, "@astrojs/preact client:visible");
});

test("records only native viewport hydration capabilities", () => {
  const supported = createBrowserCases()
    .filter(({ lazyHydration }) => lazyHydration.status === "supported")
    .map(({ productId }) => productId);
  assert.deepEqual(supported, [
    "webui-rust-actix",
    "webui-shadowdom-rust-actix",
    "webui-bun-serve",
    "webui-deno-serve",
    "webui-node-http",
    "nuxt",
    "astro",
    "vue",
  ]);
});

test("official options require exactly ten rounds and the complete matrix", () => {
  assert.throws(
    () => normalizeOptions({ appFilters: ["react"], mode: "official" }),
    /complete product matrix/u,
  );
  assert.throws(
    () => normalizeOptions({ mode: "official", rounds: 9 }),
    /exactly 10 rounds/u,
  );
  assert.equal(
    normalizeOptions({ appFilters: ["react"], mode: "quick" }).rounds,
    1,
  );
  assert.equal(normalizeOptions({ mode: "official" }).build, true);
  assert.equal(
    normalizeOptions({
      appFilters: ["webui-node-http"],
      mode: "refresh",
    }).rounds,
    10,
  );
  assert.throws(
    () => normalizeOptions({ mode: "refresh" }),
    /at least one app filter/u,
  );
});

test("browser SSR renderers always load framework production runtimes", () => {
  const environment = { NODE_ENV: "development" };
  enforceProductionMode(environment);
  assert.equal(environment.NODE_ENV, "production");
});

test("only browser-process infrastructure failures are retryable", () => {
  assert.equal(
    isRetryableBrowserInfrastructureFailure(
      "page.evaluate: Target page, context or browser has been closed",
    ),
    true,
  );
  assert.equal(
    isRetryableBrowserInfrastructureFailure(
      "Chromium logs: X connection error received.",
    ),
    true,
  );
  assert.equal(
    isRetryableBrowserInfrastructureFailure(
      "Expected 100 todos after hydration, received 300",
    ),
    false,
  );
});
