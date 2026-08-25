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
  "preact",
  "react",
  "solid",
]);

test("browser suite contains the definitive 14 product rows", () => {
  const cases = createBrowserCases();
  assert.deepEqual(PRODUCT_ORDER, EXPECTED_PRODUCTS);
  assert.deepEqual(
    cases.map(({ productId }) => productId),
    EXPECTED_PRODUCTS,
  );
  assert.equal(new Set(cases.map(({ productId }) => productId)).size, 14);
  assert.ok(
    cases.every(({ clientMode, hydration }) =>
      hydration.status !== "unsupported"
      && hydration.framework.length > 0
      && clientMode.includes("hydrate")
    ),
    "every browser product must use a real framework hydration path",
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

test("official options require exactly seven rounds and the complete matrix", () => {
  assert.throws(
    () => normalizeOptions({ appFilters: ["react"], mode: "official" }),
    /complete product matrix/u,
  );
  assert.throws(
    () => normalizeOptions({ mode: "official", rounds: 6 }),
    /exactly 7 rounds/u,
  );
  assert.equal(
    normalizeOptions({ appFilters: ["react"], mode: "quick" }).rounds,
    1,
  );
  assert.equal(normalizeOptions({ mode: "official" }).build, true);
});

test("browser SSR renderers always load framework production runtimes", () => {
  const environment = { NODE_ENV: "development" };
  enforceProductionMode(environment);
  assert.equal(environment.NODE_ENV, "production");
});
