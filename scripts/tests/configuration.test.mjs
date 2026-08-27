// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  REPOSITORY_ROOT,
  webuiCargoArguments,
  webuiReleaseVersion,
} from "../../todo/shared/webui-dependency.mjs";

async function json(path) {
  return JSON.parse(await readFile(resolve(REPOSITORY_ROOT, path), "utf8"));
}

test("pins released WebUI and benchmark runtimes exactly", async () => {
  const root = await json("package.json");
  const runtimes = await json("todo/servers/runtime-versions.json");
  const fast = await json("todo/apps/webui-fast/package.json");
  const shadow = await json("todo/apps/webui-shadowdom/package.json");
  const tsconfig = await json("tsconfig.json");
  assert.equal(webuiReleaseVersion(), "0.0.26");
  assert.equal(root.dependencies["@microsoft/webui"], "0.0.26");
  assert.equal(root.dependencies["@microsoft/webui-framework"], "0.0.26");
  assert.equal(root.dependencies["@microsoft/webui-router"], "0.0.26");
  assert.equal(root.devDependencies.typescript, "6.0.3");
  assert.equal(fast.dependencies["@microsoft/webui"], "0.0.26");
  assert.equal(fast.dependencies["@microsoft/webui-router"], "0.0.26");
  assert.equal(shadow.dependencies["@microsoft/webui"], "0.0.26");
  assert.equal(tsconfig.compilerOptions.experimentalDecorators, true);
  assert.equal(tsconfig.compilerOptions.useDefineForClassFields, false);
  assert.equal(runtimes.runtimes.bun.version, "1.3.14");
  assert.equal(runtimes.runtimes.deno.version, "2.9.5");
  assert.equal(runtimes.runtimes.node.version, "24.19.0");
});

test("patches only Cargo builds that target a local WebUI checkout", () => {
  const checkout = resolve(REPOSITORY_ROOT, "local-webui");
  const handler = resolve(checkout, "crates", "webui-handler")
    .replaceAll("\\", "\\\\");
  assert.deepEqual(webuiCargoArguments(["metadata"], null), ["metadata"]);
  assert.deepEqual(
    webuiCargoArguments(["metadata"], checkout),
    [
      "--config",
      `patch.crates-io.microsoft-webui-handler.path="${handler}"`,
      "metadata",
    ],
  );
});
