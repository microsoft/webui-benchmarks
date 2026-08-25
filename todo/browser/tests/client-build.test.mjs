// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import {
  buildClient,
  buildSolidBrowserRenderer,
} from "../build-clients.mjs";
import { collectHtmlObservation } from "../../shared/observation.mjs";
import { TODO_STATE_VARIANTS } from "../../shared/state.mjs";
import { assertValidObservation } from "../../shared/validator.mjs";

for (
  const appId of [
    "webui",
    "webui-fast",
    "react",
    "vue",
    "solid",
    "preact",
  ]
) {
  test(`builds the production ${appId} browser entry`, async () => {
    const bundle = await buildClient(appId);
    assert.ok(Buffer.isBuffer(bundle));
    assert.ok(bundle.byteLength > 100);
  });
}

test("writes WebUI assets for the direct Rust browser server", async () => {
  for (const appId of ["webui", "webui-fast"]) {
    const bundle = await buildClient(appId);
    assert.equal(typeof bundle.browserAssetDirectory, "string");
    await Promise.all([
      access(`${bundle.browserAssetDirectory}/webui.js`),
      access(`${bundle.browserAssetDirectory}/webui-components.js`),
    ]);
  }
});

test("builds exact hydratable Solid browser SSR for every state", async () => {
  const renderer = await buildSolidBrowserRenderer();
  assert.ok(renderer.bundleBytes > 100);
  assert.match(renderer.bootstrap, /^<script>/u);
  assert.match(renderer.bootstrap, /window\._\$HY/u);
  for (const state of TODO_STATE_VARIANTS) {
    const html = renderer.render(state);
    assert.match(html, /\sdata-hk="[^"]+"/u);
    assertValidObservation(collectHtmlObservation(html), state);
  }
});
