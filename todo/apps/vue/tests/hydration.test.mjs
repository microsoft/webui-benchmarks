// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "../build.mjs";
import { createRenderer } from "../adapter.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(here, "..");
const artifacts = await build();

test("the client entry activates the server markup with createSSRApp", async () => {
  const source = await readFile(resolve(appDirectory, "client.mjs"), "utf8");
  assert.match(
    source,
    /createSSRApp\([\s\S]*?\)\.mount\(/,
    "client.mjs must hydrate with createSSRApp(...).mount(...)",
  );
  assert.match(
    source,
    /import \{ createSSRApp \} from "vue"/,
    "client.mjs must take createSSRApp from vue",
  );
  assert.match(
    source,
    /from "\.\/components\/todo-app\.vue"/,
    "client.mjs must mount the same single file component the server renders",
  );
  assert.doesNotMatch(
    source,
    /createApp\(/,
    "a plain createApp would discard the server markup instead of hydrating",
  );
});

test("the adapter points the browser runner at the client entry", async () => {
  const renderer = await createRenderer();
  assert.equal(renderer.browserEntry, resolve(appDirectory, "client.mjs"));
  const server = await readFile(resolve(appDirectory, "server.mjs"), "utf8");
  assert.match(
    server,
    /from "\.\/components\/todo-app\.vue"/,
    "server.mjs must render the same single file component",
  );
  assert.match(server, /@vue\/server-renderer/);
});

test("the same sources compile to server, browser, and component artifacts", async () => {
  for (const key of ["artifactPath", "clientArtifactPath", "componentsArtifactPath"]) {
    const info = await stat(artifacts[key]);
    assert.ok(info.size > 1024, `${key} is suspiciously small`);
  }
  assert.equal(await build(), artifacts, "build() must be memoized");
});

test("the browser bundle is free of server-only code", async () => {
  const bundle = await readFile(artifacts.clientArtifactPath, "utf8");
  // Minification renames locals, so assert on what survives: the public
  // exports and Vue's hydration-only code paths.
  assert.match(bundle, /export\s*\{[\s\S]*hydrateTodo/);
  assert.match(bundle, /Hydration|hydrate/);
  assert.doesNotMatch(
    bundle,
    /\bfrom\s*"[^"]+"/,
    "the browser bundle must be self contained",
  );
  for (const forbidden of [
    "@vue/server-renderer",
    "renderToString",
    "node:fs",
    "node:path",
    "require(",
  ]) {
    assert.equal(
      bundle.includes(forbidden),
      false,
      `browser bundle must not contain ${forbidden}`,
    );
  }
});

test("the component artifact keeps vue external for host bundlers", async () => {
  const components = await readFile(
    artifacts.componentsArtifactPath,
    "utf8",
  );
  assert.match(components, /from "vue"/);
  assert.match(components, /export \{[\s\S]*TodoApp/);
});
