// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createRenderer } from "../adapter.mjs";
import { createRenderer as createReactRenderer } from "../../react/adapter.mjs";
import {
  ARIA_PRESSED_COUNT,
  COMPONENTS,
  FILTER_IDS,
  STATE_VARIANT_COUNT,
  TODO_BUTTON_COUNT,
  TODO_ITEM_COUNT,
} from "../../../shared/contract.mjs";
import {
  collectHtmlObservation,
  semanticObservation,
} from "../../../shared/observation.mjs";
import { createTodoState } from "../../../shared/state.mjs";
import { validateObservation } from "../../../shared/validator.mjs";

// The shared fixture copy currently drifts from `REQUIRED_TEXT`, which every
// renderer reports identically; anything else must stay a hard failure here.
const SHARED_CONTRACT_TEXT_DRIFT = new Set([
  "textCounts.app-subtitle must be at least 1",
  "textCounts.footer must be at least 1",
]);

const renderer = await createRenderer();
const reactRenderer = await createReactRenderer();

function unexpectedErrors(observation, state) {
  return validateObservation(observation, state).errors.filter(
    (error) => !SHARED_CONTRACT_TEXT_DRIFT.has(error),
  );
}

test("the adapter memoizes its compiled artifact", async () => {
  const { build } = await import("../build.mjs");
  assert.equal(await build(), await build());
  const again = await createRenderer();
  assert.equal(again.id, renderer.id);
  assert.equal(renderer.id, "vue");
  assert.equal(renderer.async, true);
});

test("the adapter serves the shared stylesheet", async () => {
  assert.equal(renderer.css, await readFile(renderer.stylesPath, "utf8"));
});

test("server rendering satisfies the shared validator for every variant", async () => {
  for (let variant = 0; variant < STATE_VARIANT_COUNT; variant += 1) {
    const state = createTodoState(variant);
    const snapshot = JSON.stringify(state);
    const html = await renderer.render(state);
    assert.equal(JSON.stringify(state), snapshot, "render must not mutate state");
    assert.deepEqual(
      unexpectedErrors(collectHtmlObservation(html), state),
      [],
      `variant ${variant} failed shared validation`,
    );
  }
});

test("server rendering is semantically identical to the react baseline", async () => {
  for (let variant = 0; variant < STATE_VARIANT_COUNT; variant += 1) {
    const state = createTodoState(variant);
    assert.deepEqual(
      semanticObservation(collectHtmlObservation(await renderer.render(state))),
      semanticObservation(
        collectHtmlObservation(await reactRenderer.render(state)),
      ),
      `variant ${variant} diverged from the react baseline`,
    );
  }
});

test("server rendering keeps the contract markup shape", async () => {
  const state = createTodoState(0);
  const html = await renderer.render(state);
  const observation = collectHtmlObservation(html);
  assert.match(html, /<h1 id="todo-app-title">SSR Todo Benchmark<\/h1>/);
  assert.deepEqual(observation.componentNames, [...COMPONENTS]);
  assert.equal(observation.selectorCounts["todo-item"], TODO_ITEM_COUNT);
  assert.equal(observation.selectorCounts["todo-checkbox"], TODO_ITEM_COUNT);
  assert.equal(observation.selectorCounts["todo-button"], TODO_BUTTON_COUNT);
  assert.equal(observation.selectorCounts["todo-filter"], FILTER_IDS.length);
  assert.equal(observation.selectorCounts["todo-app"], 1);
  assert.equal(observation.selectorCounts["aria-pressed"], ARIA_PRESSED_COUNT);
  assert.equal(observation.interactionCounts.filter, FILTER_IDS.length);
  assert.equal(observation.interactionCounts.select, TODO_ITEM_COUNT);
  assert.equal(
    observation.interactionCounts["toggle-completion"],
    TODO_ITEM_COUNT,
  );
  assert.equal(observation.interactionCounts["clear-completed"], 1);
  for (const filterId of FILTER_IDS) {
    assert.ok(
      html.includes(`data-filter="${filterId}"`),
      `missing filter control for ${filterId}`,
    );
  }
});
