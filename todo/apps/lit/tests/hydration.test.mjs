// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createRenderer } from "../adapter.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(here, "..");

const clientSource = await readFile(resolve(appDirectory, "client.mjs"), "utf8");
const serverSource = await readFile(resolve(appDirectory, "server.mjs"), "utf8");

test("the client installs hydration support before any lit element", async () => {
  const hydrateIndex = clientSource.indexOf(
    "@lit-labs/ssr-client/lit-element-hydrate-support.js",
  );
  assert.ok(
    hydrateIndex !== -1,
    "client.mjs must import @lit-labs/ssr-client hydrate support",
  );
  // Hydration support monkeypatches LitElement, so it must be installed before
  // any element module registers a class; assert on source order to lock it in.
  const componentIndex = clientSource.indexOf('import("./components/');
  assert.ok(
    componentIndex !== -1,
    "client.mjs must dynamically import at least one lit component",
  );
  assert.ok(
    hydrateIndex < componentIndex,
    "hydrate support must be imported before any lit component",
  );
});

test("the client routes with @lit-labs/router", async () => {
  assert.match(
    clientSource,
    /from "@lit-labs\/router"/,
    "client.mjs must route with @lit-labs/router",
  );
});

test("the adapter points the browser runner at the client entry", async () => {
  const renderer = await createRenderer();
  assert.equal(renderer.browserEntry, resolve(appDirectory, "client.mjs"));
});

test("the server renders with @lit-labs/ssr and no global dom shim", async () => {
  assert.match(
    serverSource,
    /from "@lit-labs\/ssr"/,
    "server.mjs must render with @lit-labs/ssr",
  );
  // The global `install-global-dom-shim` entry point leaks `window`/`document`
  // into every other renderer sharing this process, which corrupts peers that
  // branch on their absence to pick their server code path. It was deliberately
  // dropped in favor of @lit-labs/ssr's per-render shim; lock that decision in.
  // Only a real import statement is forbidden - the source comment legitimately
  // names the shim to document why it is deliberately avoided.
  assert.doesNotMatch(
    serverSource,
    /^\s*import\b[^\n]*install-global-dom-shim/mu,
    "server.mjs must not install the global dom shim",
  );
});

test("server and client agree on the routed root component", async () => {
  assert.match(
    serverSource,
    /workspace-app/,
    "server.mjs must render the workspace-app shell",
  );
  assert.match(
    clientSource,
    /workspace-app/,
    "client.mjs must hydrate the workspace-app shell",
  );
});
