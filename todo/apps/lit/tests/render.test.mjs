// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createRenderer } from "../adapter.mjs";
import {
  ACTIVITY_EVENT_COUNT,
  SETTING_CONTROL_COUNT,
  STATE_VARIANT_COUNT,
} from "../../../shared/contract.mjs";
import { collectHtmlObservation } from "../../../shared/observation.mjs";
import { createTodoState } from "../../../shared/state.mjs";
import { validateObservation } from "../../../shared/validator.mjs";

const renderer = await createRenderer();

async function drainStream(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    output += typeof value === "string" ? value : decoder.decode(value);
  }
  return output;
}

test("the adapter memoizes its compiled artifact", async () => {
  const { build } = await import("../build.mjs");
  assert.equal(await build(), await build());
  const again = await createRenderer();
  assert.equal(again.id, renderer.id);
  assert.equal(renderer.id, "lit");
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
    // The Lit row produces zero validator errors, so any error is a hard
    // failure rather than a tolerated shared-fixture text drift.
    assert.deepEqual(
      validateObservation(collectHtmlObservation(html), state).errors,
      [],
      `variant ${variant} failed shared validation`,
    );
  }
});

test("the activity route renders its page marker and event count", async () => {
  const html = await renderer.render(createTodoState(0), "/activity");
  assert.match(html, /data-route-page="activity"/);
  assert.equal(
    [...html.matchAll(/class="activity-event"/gu)].length,
    ACTIVITY_EVENT_COUNT,
    "activity route must render every contract event",
  );
});

test("the settings route renders its page marker and control count", async () => {
  const html = await renderer.render(createTodoState(0), "/settings");
  assert.match(html, /data-route-page="settings"/);
  assert.equal(
    [...html.matchAll(/data-setting-id="/gu)].length,
    SETTING_CONTROL_COUNT,
    "settings route must render every contract control",
  );
});

test("server rendering emits declarative shadow DOM", async () => {
  const html = await renderer.render(createTodoState(0));
  assert.match(
    html,
    /<template shadowroot(?:mode)?="open"/,
    "output must contain declarative shadow roots",
  );
  assert.match(html, /shadowrootmode="open"/);
});

test("streaming render is byte-identical to the complete render", async () => {
  for (const requestPath of ["/dynamic", "/activity", "/settings"]) {
    const state = createTodoState(0);
    const complete = await renderer.render(state, requestPath);
    const streamed = await drainStream(
      renderer.renderStream(createTodoState(0), requestPath),
    );
    assert.equal(
      streamed,
      complete,
      `${requestPath} stream diverged from the complete render`,
    );
  }
});
