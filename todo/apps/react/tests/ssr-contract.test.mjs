// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  COMPONENTS,
  SENTINEL_IDS,
  STATE_VARIANT_COUNT,
} from "../../../shared/contract.mjs";
import {
  collectHtmlObservation,
  semanticObservation,
} from "../../../shared/observation.mjs";
import { createTodoState } from "../../../shared/state.mjs";
import { validateObservation } from "../../../shared/validator.mjs";
import * as adapter from "../adapter.mjs";
import { createRenderer as createPeerRenderer } from "../../preact/adapter.mjs";
import { APP_ID, APP_ROOT, SHARED_TEXT_DRIFT } from "./support.mjs";

const renderer = await adapter.createRenderer();
const peer = await createPeerRenderer();
const variants = Array.from({ length: STATE_VARIANT_COUNT }, (_unused, index) =>
  createTodoState(index),
);

test(`${APP_ID}: metadata describes a sync renderer with a real hydration entry`, () => {
  assert.equal(adapter.metadata.id, APP_ID);
  assert.equal(adapter.metadata.async, false);
  assert.deepEqual([...adapter.metadata.componentNames], COMPONENTS);
  assert.ok(existsSync(adapter.metadata.stylesPath));
  assert.equal(adapter.metadata.browserEntry, resolve(APP_ROOT, "client.jsx"));
  assert.ok(
    existsSync(adapter.metadata.browserEntry),
    "browserEntry must point at the authored hydration entry",
  );
});

test(`${APP_ID}: build() is cached and createRenderer() is stable`, async () => {
  const first = await adapter.build();
  const second = await adapter.build();
  assert.equal(second, first);
  assert.equal(await adapter.createRenderer(), renderer);
});

test(`${APP_ID}: server artifact bundles the production React runtime`, async () => {
  const { artifactPath } = await adapter.build();
  const artifact = await readFile(artifactPath, "utf8");
  assert.doesNotMatch(
    artifact,
    /\bfrom\s*["']react(?:-dom)?(?:\/[^"']*)?["']/u,
    "external React imports select development code when NODE_ENV is unset",
  );
});

test(`${APP_ID}: render is synchronous and returns markup`, () => {
  const html = renderer.render(variants[0]);
  assert.equal(typeof html, "string");
  assert.ok(!(html instanceof Promise));
  assert.ok(html.startsWith('<div class="workspace-shell">'));
  assert.ok(!html.includes("<!--"), "SSR output must not carry HTML comments");
});

test(`${APP_ID}: SSR output is contract-valid for all ${STATE_VARIANT_COUNT} states`, () => {
  for (const state of variants) {
    const observation = collectHtmlObservation(renderer.render(state));
    const { errors } = validateObservation(observation, state);
    const unexpected = errors.filter(
      (entry) => !SHARED_TEXT_DRIFT.includes(entry),
    );
    assert.deepEqual(
      unexpected,
      [],
      `variant ${state.variantId} produced app-owned validation errors`,
    );
  }
});

test(`${APP_ID}: SSR is semantically identical to the Preact peer for all states`, async () => {
  for (const state of variants) {
    const mine = semanticObservation(
      collectHtmlObservation(renderer.render(state)),
    );
    const theirs = semanticObservation(
      collectHtmlObservation(await peer.render(state)),
    );
    assert.deepEqual(mine, theirs, `variant ${state.variantId} diverged`);
  }
});

test(`${APP_ID}: every component boundary and sentinel survives SSR`, () => {
  const html = renderer.render(variants[0]);
  for (const componentName of COMPONENTS) {
    assert.ok(
      html.includes(`data-component="${componentName}"`),
      `${componentName} boundary missing from SSR output`,
    );
  }
  for (const todoId of SENTINEL_IDS) {
    assert.ok(html.includes(`data-todo-id="${todoId}"`), `${todoId} missing`);
  }
  assert.equal(
    html.split('data-component="todo-item"').length - 1,
    100,
    "SSR must render 100 todos",
  );
});

test(`${APP_ID}: response bytes are natural, not padded or cached`, () => {
  const sizes = new Set();
  for (const state of variants) {
    const html = renderer.render(state);
    assert.equal(html, renderer.render(state), "render must be deterministic");
    sizes.add(html.length);
  }
  assert.ok(sizes.size > 1, "variants must produce naturally varying byte sizes");

  const mutated = {
    ...variants[0],
    todos: variants[0].todos.map((todo, index) =>
      index === 0 ? { ...todo, title: "Mutated sentinel title" } : todo,
    ),
  };
  assert.ok(
    renderer.render(mutated).includes("Mutated sentinel title"),
    "render must be a pure function of its input, not memoized",
  );
});
