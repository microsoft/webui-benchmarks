// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  APP_METADATA_SCHEMA,
  FULL_STACK_IDS,
  collectSourceRevision,
  computeFixtureHash,
  loadFullStackMetadata,
} from "../lib/metadata.mjs";
import { REPOSITORY_ROOT } from "../lib/paths.mjs";

test("full-stack manifests declare production integration metadata", () => {
  for (const appId of FULL_STACK_IDS) {
    const app = loadFullStackMetadata(appId);
    assert.equal(app.metadata.schema, APP_METADATA_SCHEMA);
    assert.equal(app.metadata.workerCount, 1);
    assert.equal(app.metadata.compression, false);
    assert.equal(app.metadata.routes.dynamic, "/dynamic");
    assert.equal(app.metadata.routes.cached, "/cached");
    assert.ok(app.metadata.frameworkPackages.length > 0);
  }
});

test("fixture hash covers benchmark harness and renderer sources", () => {
  const first = computeFixtureHash();
  const second = computeFixtureHash();
  assert.deepEqual(second, first);
  assert.equal(first.value.length, 64);
  assert.ok(first.files.includes("todo/shared/contract.mjs"));
  assert.ok(first.files.includes("todo/shared/state.mjs"));
  assert.ok(first.files.includes("todo/shared/styles.css"));
  assert.ok(first.files.includes("todo/browser/measurement.mjs"));
  assert.ok(first.files.includes("todo/servers/lib/contract.mjs"));
  assert.ok(first.files.includes("scripts/export-benchmark-summary.mjs"));
  assert.ok(first.files.includes("Cargo.toml"));
  assert.ok(first.files.includes("package.json"));
  assert.equal(
    first.files.some((path) => path.startsWith("workspace/")),
    false,
  );
  const revision = collectSourceRevision(first.value);
  assert.equal(revision.sourceDigest, first.value);
  assert.match(revision.commit, /^[0-9a-f]{40}$/u);
  assert.equal(typeof revision.workingTreeDirty, "boolean");
});

test("fixture hash ignores generated framework and browser outputs", () => {
  const root = resolve(
    REPOSITORY_ROOT,
    "target",
    `fixture-hash-${randomUUID()}`,
  );
  try {
    mkdirSync(resolve(root, "source"), { recursive: true });
    writeFileSync(resolve(root, "source", "fixture.mjs"), "export const value = 1;\n");
    const before = computeFixtureHash([root]);

    for (const directory of [
      ".git",
      ".browser-output",
      ".deno",
      ".deno-cache",
      ".next",
      ".nuxt",
      ".output",
      ".svelte-kit",
      ".vite",
      ".vite-temp",
      "browser-build",
      "browser-dist",
      "browser-generated",
      "browser-output",
      "build",
      "coverage",
      "dist",
      "generated",
      "node_modules",
      "playwright-report",
      "results",
      "target",
      "test-results",
    ]) {
      const generated = resolve(root, directory);
      mkdirSync(generated, { recursive: true });
      writeFileSync(resolve(generated, "generated.mjs"), directory);
    }

    assert.deepEqual(computeFixtureHash([root]), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
