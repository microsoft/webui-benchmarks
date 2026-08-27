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
import { WORKSPACE_MINIMUM_EMITTED_BYTES } from "../../shared/workspace-intelligence.mjs";

const MAXIMUM_TREE_SHAKEN_ZOD_BYTES = 70 * 1024;
const FORBIDDEN_WEBUI_CLIENT_FRAMEWORKS = Object.freeze([
  "@tanstack/react-router",
  "@tanstack/table-core",
  "preact",
  "react",
  "react-dom",
  "solid-js",
  "svelte",
  "vue",
]);

for (
  const appId of [
    "webui",
    "webui-fast",
    "react",
    "react-tanstack",
    "vue",
    "solid",
    "preact",
  ]
) {
  test(`builds the production ${appId} browser entry`, async () => {
    const bundle = await buildClient(appId);
    assert.ok(Buffer.isBuffer(bundle));
    assert.ok(bundle.byteLength > 100);
    if (appId === "preact") {
      assert.ok(
        bundle.byteLength >= WORKSPACE_MINIMUM_EMITTED_BYTES,
        `Preact must emit at least ${WORKSPACE_MINIMUM_EMITTED_BYTES} bytes`,
      );
    }
    if (appId === "preact" || appId === "webui") {
      assert.ok(bundle.packageBytes.zod > 0);
      assert.ok(
        bundle.packageBytes.zod <= MAXIMUM_TREE_SHAKEN_ZOD_BYTES,
        `${appId} emitted ${bundle.packageBytes.zod} bytes of Zod; use named imports so esbuild can tree-shake the package`,
      );
    }
    if (appId === "webui") {
      for (const packageName of FORBIDDEN_WEBUI_CLIENT_FRAMEWORKS) {
        assert.equal(
          bundle.packageBytes[packageName],
          0,
          `WebUI must not bundle ${packageName}`,
        );
      }
    }
  });
}

test("writes WebUI assets for the direct Rust browser server", async () => {
  for (const appId of ["webui", "webui-fast"]) {
    const bundle = await buildClient(appId);
    assert.equal(typeof bundle.browserAssetDirectory, "string");
    await access(`${bundle.browserAssetDirectory}/webui.js`);
    assert.ok(
      [...bundle.additionalAssets.keys()].some(
        (path) => path.startsWith("/__browser/chunks/"),
      ),
      `${appId} must emit lazy browser chunks`,
    );
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
