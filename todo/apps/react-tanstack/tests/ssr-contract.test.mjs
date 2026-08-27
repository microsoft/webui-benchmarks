// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import { collectHtmlObservation } from "../../../shared/observation.mjs";
import { TODO_STATE_VARIANTS } from "../../../shared/state.mjs";
import { assertValidObservation } from "../../../shared/validator.mjs";
import { createRenderer } from "../adapter.mjs";

const renderer = await createRenderer();

test("React + TanStack Router renders the canonical work route", async () => {
  for (const state of TODO_STATE_VARIANTS) {
    const html = await renderer.render(state, "/dynamic");
    assert.match(html, /data-route-page="work"/u);
    assertValidObservation(collectHtmlObservation(html), state);
  }
});

test("React + TanStack Router SSR matches every routed page", async () => {
  const state = TODO_STATE_VARIANTS[0];
  const activity = await renderer.render(state, "/activity");
  const settings = await renderer.render(state, "/settings");

  assert.match(activity, /data-route-page="activity"/u);
  assert.match(activity, /data-event-id="activity-0026"/u);
  assert.match(settings, /data-route-page="settings"/u);
  assert.match(settings, /data-setting-id="daily-digest"/u);
});
