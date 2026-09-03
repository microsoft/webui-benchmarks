// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
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
const LAZY_FEATURES = Object.freeze([
  "analytics",
  "csv",
  "saved-view",
  "schedule",
  "search",
]);
const ASYNC_FACADE_IMPLEMENTATIONS = Object.freeze([
  ["FAST", "../../apps/webui-fast/src/workspace-intelligence/workspace-intelligence.ts"],
  ["React, React + TanStack Router, and Next", "../../apps/react/components/workspace-intelligence.jsx"],
  ["Preact and Astro", "../../apps/preact/components/workspace-intelligence.jsx"],
  ["Solid", "../../apps/solid/components/workspace-intelligence.jsx"],
  ["SvelteKit", "../../apps/sveltekit/src/lib/components/workspace-intelligence.svelte"],
  ["Vue and Nuxt", "../../apps/vue/components/workspace-intelligence.vue"],
  ["Lit", "../../apps/lit/components/workspace-intelligence.mjs"],
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
    "lit",
  ]
) {
  test(`builds the production ${appId} browser entry`, async () => {
    const bundle = await buildClient(appId);
    assert.ok(Buffer.isBuffer(bundle));
    assert.ok(bundle.byteLength > 100);
    if (appId === "preact") {
      assert.ok(
        bundle.totalJavaScriptBytes >= WORKSPACE_MINIMUM_EMITTED_BYTES,
        `Preact must emit at least ${WORKSPACE_MINIMUM_EMITTED_BYTES} bytes`,
      );
    }
    for (const feature of LAZY_FEATURES) {
      const assetPath = bundle.featureAssets[feature];
      assert.equal(
        typeof assetPath,
        "string",
        `${appId} must emit workspace-${feature} as a lazy chunk`,
      );
      assert.ok(
        bundle.additionalAssets.has(assetPath),
        `${appId} must serve the workspace-${feature} chunk`,
      );
    }
    assert.equal(
      new Set(Object.values(bundle.featureAssets)).size,
      LAZY_FEATURES.length,
      `${appId} must keep each workspace feature in an independent chunk`,
    );
    for (const route of ["activity-page", "settings-page"]) {
      const assetPath = bundle.routeAssets[route];
      assert.equal(
        typeof assetPath,
        "string",
        `${appId} must emit ${route} as a lazy route chunk`,
      );
      assert.ok(
        bundle.additionalAssets.has(assetPath),
        `${appId} must serve the ${route} chunk`,
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

test("every framework implementation uses lazy workspace features", async () => {
  for (const [label, path] of ASYNC_FACADE_IMPLEMENTATIONS) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(
      source,
      /workspace-intelligence-client\.mjs/u,
      `${label} must use the async workspace facade`,
    );
  }

  for (
    const [label, path] of [
      ["shared client facade", "../../shared/workspace-intelligence-client.mjs"],
      ["WebUI Light and Shadow", "../../apps/webui-lightdom/src/workspace-intelligence/workspace-intelligence.ts"],
    ]
  ) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    for (const feature of LAZY_FEATURES) {
      assert.match(
        source,
        new RegExp(
          `import\\([\\s\\S]*?workspace-${feature}\\.mjs`,
          "u",
        ),
        `${label} must dynamically import workspace-${feature}`,
      );
    }
  }
});

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
    if (appId === "webui") {
      for (const dom of ["light", "shadow"]) {
        assert.ok(
          bundle.additionalAssets.has(
            `/__browser/${dom}/app-shell.css`,
          ),
          `WebUI must serve ${dom} DOM component CSS`,
        );
      }
    }
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
