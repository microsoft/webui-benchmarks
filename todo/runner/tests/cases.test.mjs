// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import {
  HEADLINE_INPUT_POLICY,
  NATURAL_PAYLOAD_POLICY,
  OFFICIAL_CASE_COUNT,
  OFFICIAL_MATRIX_ID,
  PRODUCT_KINDS,
  assertCaseMatrix,
  createCaseMatrix,
  filterCases,
} from "../lib/cases.mjs";
import { createBuildPlan } from "../lib/builds.mjs";

const EXPECTED_ROWS = Object.freeze([
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
  "react-tanstack",
  "solid",
]);

test("official matrix publishes exactly the 15 approved rows in order", () => {
  const matrix = createCaseMatrix();
  assert.equal(matrix.length, OFFICIAL_CASE_COUNT);
  assert.equal(matrix.length, 15);
  assert.deepEqual(
    matrix.map((benchmarkCase) => benchmarkCase.id),
    EXPECTED_ROWS,
  );
  assert.ok(
    matrix.every(
      (benchmarkCase) => benchmarkCase.matrixId === OFFICIAL_MATRIX_ID,
    ),
  );
});

test("every official row is a headline dynamic single-worker case", () => {
  for (const benchmarkCase of createCaseMatrix()) {
    assert.equal(benchmarkCase.headline, true, benchmarkCase.id);
    assert.equal(benchmarkCase.mode, "dynamic", benchmarkCase.id);
    assert.equal(benchmarkCase.workerCount, 1, benchmarkCase.id);
    assert.equal(
      benchmarkCase.inputPolicy,
      HEADLINE_INPUT_POLICY,
      benchmarkCase.id,
    );
    assert.equal(benchmarkCase.dynamicRoute, "/dynamic", benchmarkCase.id);
    assert.equal(benchmarkCase.cacheRoute, "/cached", benchmarkCase.id);
  }
});

test("official matrix publishes natural response bytes only", () => {
  const matrix = createCaseMatrix();
  assert.ok(
    matrix.every(
      (benchmarkCase) =>
        benchmarkCase.payloadPolicy === NATURAL_PAYLOAD_POLICY,
    ),
  );
  assert.equal(
    matrix.some(
      (benchmarkCase) => benchmarkCase.payloadPolicy === "equal-padded",
    ),
    false,
  );
});

test("no cached, fresh-input, padded, or Fastify rows exist", () => {
  const matrix = createCaseMatrix();
  assert.equal(
    matrix.some((benchmarkCase) => benchmarkCase.mode === "cached"),
    false,
  );
  assert.equal(
    matrix.some(
      (benchmarkCase) =>
        benchmarkCase.mode === "fresh-input"
        || benchmarkCase.inputPolicy === "fresh-input"
        || benchmarkCase.capability === "fresh-input-route",
    ),
    false,
  );
  assert.equal(
    matrix.some(
      (benchmarkCase) =>
        benchmarkCase.serverId === "fastify"
        || benchmarkCase.transport.toLowerCase().includes("fastify"),
    ),
    false,
  );
});

test("metadata separates the product SSR renderer from its transport", () => {
  const matrix = createCaseMatrix();
  for (const benchmarkCase of matrix) {
    assert.equal(typeof benchmarkCase.renderer, "string", benchmarkCase.id);
    assert.equal(typeof benchmarkCase.transport, "string", benchmarkCase.id);
    assert.ok(benchmarkCase.renderer.length > 0, benchmarkCase.id);
    assert.ok(benchmarkCase.transport.length > 0, benchmarkCase.id);
    assert.notEqual(
      benchmarkCase.renderer,
      benchmarkCase.transport,
      benchmarkCase.id,
    );
  }
  const renderers = matrix.filter(
    (benchmarkCase) => benchmarkCase.productKind === PRODUCT_KINDS.renderer,
  );
  assert.deepEqual(
    renderers.map((benchmarkCase) => benchmarkCase.id),
    ["vue", "preact", "react", "react-tanstack", "solid"],
  );
  assert.ok(
    renderers.every(
      (benchmarkCase) =>
        benchmarkCase.transport === "node:http"
        && benchmarkCase.serverId === "node-http"
        && benchmarkCase.launcher.kind === "renderer",
    ),
  );
  assert.deepEqual(
    renderers.map((benchmarkCase) => benchmarkCase.renderer),
    [
      "@vue/server-renderer renderToWebStream",
      "preact-render-to-string renderToReadableStream",
      "react-dom/server renderToReadableStream",
      "react-dom/server stream + @tanstack/react-router renderRouterToStream",
      "solid-js/web renderToStream",
    ],
  );
  assert.ok(renderers.every(({ streaming }) => streaming === "native"));
});

test("framework rows keep their own production servers", () => {
  const frameworks = createCaseMatrix().filter(
    (benchmarkCase) => benchmarkCase.productKind === PRODUCT_KINDS.framework,
  );
  assert.deepEqual(
    frameworks.map((benchmarkCase) => benchmarkCase.id),
    ["sveltekit", "nuxt", "next", "astro"],
  );
  assert.ok(
    frameworks.every(
      (benchmarkCase) =>
        benchmarkCase.launcher.kind === "full-stack"
        && benchmarkCase.serverId === benchmarkCase.appId,
    ),
  );
  assert.deepEqual(
    frameworks.map(({ streaming }) => streaming),
    ["buffered", "buffered", "native", "native"],
  );
});

test("WebUI rows cover Light, Shadow, FAST V3, Bun, Deno, and Node", () => {
  const webui = createCaseMatrix().filter(
    (benchmarkCase) => benchmarkCase.productKind === PRODUCT_KINDS.webui,
  );
  assert.deepEqual(
    webui.map((benchmarkCase) => benchmarkCase.transport),
    [
      "actix-web",
      "actix-web",
      "actix-web",
      "Bun.serve",
      "Deno.serve",
      "node:http",
    ],
  );
  assert.deepEqual(
    webui.map(({ streaming }) => streaming),
    [
      "progressive-boundaries",
      "progressive-boundaries",
      "native-chunks",
      "progressive-boundaries",
      "progressive-boundaries",
      "progressive-boundaries",
    ],
  );
  assert.deepEqual(
    webui.map((benchmarkCase) => benchmarkCase.runtimeId),
    ["rust", "rust", "rust", "bun", "deno", "node"],
  );
});

test("assertCaseMatrix rejects any deviation from the official contract", () => {
  const matrix = createCaseMatrix();
  assert.throws(() => assertCaseMatrix(matrix.slice(1)), /exactly 15 rows/u);
  assert.throws(
    () =>
      assertCaseMatrix([
        ...matrix.slice(1),
        { ...matrix[0], payloadPolicy: "equal-padded" },
      ]),
    /natural response bytes/u,
  );
  assert.throws(
    () =>
      assertCaseMatrix([
        ...matrix.slice(1),
        { ...matrix[0], serverId: "fastify" },
      ]),
    /Fastify/u,
  );
  assert.throws(
    () =>
      assertCaseMatrix([
        ...matrix.slice(1),
        { ...matrix[0], workerCount: 24 },
      ]),
    /one-worker/u,
  );
});

test("case filtering accepts ids, kinds, app ids, and wildcards", () => {
  const matrix = createCaseMatrix();
  assert.equal(filterCases(matrix, ["react"]).length, 1);
  assert.equal(filterCases(matrix, ["react-tanstack"]).length, 1);
  assert.equal(filterCases(matrix, ["renderer"]).length, 5);
  assert.equal(filterCases(matrix, ["framework"]).length, 4);
  assert.equal(filterCases(matrix, ["runtime"]).length, 6);
  assert.equal(filterCases(matrix, ["webui-*"]).length, 6);
  assert.equal(filterCases(matrix, []).length, 15);
  assert.throws(() => filterCases(matrix, ["does-not-exist"]), /No benchmark/u);
});

test("build plan deduplicates exact production and release commands", () => {
  const matrix = createCaseMatrix();
  const selected = filterCases(matrix, [
    "webui-node-http",
    "webui-rust-actix",
    "webui-fast-rust-actix",
    "next",
  ]);
  const plan = createBuildPlan(selected, { localWebui: false });
  const commands = plan.map((entry) => entry.display);
  assert.equal(
    commands.includes(
      "pnpm --filter @microsoft/webui --filter @microsoft/webui-framework --filter @microsoft/webui-router run build",
    ),
    false,
  );
  assert.equal(
    commands.includes("cargo build --release -p microsoft-webui-node"),
    false,
  );
  assert.ok(
    commands.includes(
      "cargo build --release -p ssr-framework-bench-todo-actix",
    ),
  );
  assert.ok(
    commands.includes("node todo/runner/build-renderer.mjs webui-fast"),
  );
  assert.ok(commands.includes("pnpm --dir todo/apps/next build"));
  assert.equal(new Set(commands).size, commands.length);
});

test("local WebUI builds are explicit build-plan dependencies", () => {
  const selected = filterCases(createCaseMatrix(), ["webui-node-http"]);
  const plan = createBuildPlan(selected, { localWebui: true });
  const commands = plan.map((entry) => entry.display);
  assert.ok(plan.some(({ id }) => id === "webui-package"));
  assert.ok(
    commands.includes("cargo build --release -p microsoft-webui-node"),
  );
});

test("packed WebUI builds consume artifacts without rebuilding package sources", () => {
  const selected = filterCases(createCaseMatrix(), ["webui-node-http"]);
  const ids = createBuildPlan(selected, {
    localWebui: true,
    localWebuiSource: false,
  }).map(({ id }) => id);
  assert.equal(ids.includes("webui-package"), false);
  assert.equal(ids.includes("native-addon"), true);
  assert.equal(ids.includes("webui"), true);
});

test("browser build plan always includes native TLS material", () => {
  const [react] = filterCases(createCaseMatrix(), ["react"]);
  const plan = createBuildPlan([react], { browser: true });
  assert.ok(plan.some(({ id }) => id === "tls-material"));
});
