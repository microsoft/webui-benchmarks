// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  REPOSITORY_ROOT,
  configuredWebuiAddonPath,
  webuiCargoArguments,
  webuiSupportsOptimizedWriter,
} from "../../todo/shared/webui-dependency.mjs";

const require = createRequire(import.meta.url);
const {
  packageSpecifiers,
  rewriteDependencies,
} = require("../../.pnpmfile.cjs");

async function json(path) {
  return JSON.parse(await readFile(resolve(REPOSITORY_ROOT, path), "utf8"));
}

test("centralizes benchmark dependencies and preserves build configuration", async () => {
  const fast = await json("todo/apps/webui-fast/package.json");
  const shadow = await json("todo/apps/webui-shadowdom/package.json");
  const astro = await json("todo/apps/astro/package.json");
  const next = await json("todo/apps/next/package.json");
  const nuxt = await json("todo/apps/nuxt/package.json");
  const sveltekit = await json("todo/apps/sveltekit/package.json");
  const tsconfig = await json("tsconfig.json");
  assert.equal(webuiSupportsOptimizedWriter(null), true);
  for (const manifest of [astro, fast, next, nuxt, shadow, sveltekit]) {
    assert.equal(manifest.dependencies, undefined);
    assert.equal(manifest.devDependencies, undefined);
    assert.equal(manifest.optionalDependencies, undefined);
    assert.equal(manifest.peerDependencies, undefined);
  }
  assert.equal(next.webuiBenchmark.productionEntryBase, "workspace");
  assert.equal(tsconfig.compilerOptions.experimentalDecorators, true);
  assert.equal(tsconfig.compilerOptions.useDefineForClassFields, false);
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

test("links every local WebUI JavaScript package from one checkout", () => {
  const checkout = resolve(REPOSITORY_ROOT, "local-webui");
  const configuration = { checkout, mode: "source" };
  assert.deepEqual(
    rewriteDependencies(
      {
        "@microsoft/webui": "1.0.0",
        "@microsoft/webui-framework": "1.0.0",
        "@microsoft/webui-router": "1.0.0",
        react: "2.0.0",
      },
      configuration,
    ),
    {
      "@microsoft/webui": `link:${
        resolve(checkout, "packages", "webui").replaceAll("\\", "/")
      }`,
      "@microsoft/webui-framework": `link:${
        resolve(checkout, "packages", "webui-framework").replaceAll("\\", "/")
      }`,
      "@microsoft/webui-router": `link:${
        resolve(checkout, "packages", "webui-router").replaceAll("\\", "/")
      }`,
      react: "2.0.0",
    },
  );
});

test("packed mode resolves immutable package artifacts", () => {
  const configuration = {
    checkout: resolve(REPOSITORY_ROOT, "local-webui"),
    mode: "packed",
    packages: {
      "@microsoft/webui": ".cache/webui-pack/webui-local.tgz",
      "@microsoft/webui-framework":
        ".cache/webui-pack/webui-framework-local.tgz",
      "@microsoft/webui-router":
        ".cache/webui-pack/webui-router-local.tgz",
    },
  };
  const specifiers = packageSpecifiers(configuration);
  assert.match(specifiers["@microsoft/webui"], /^file:/u);
  assert.match(
    specifiers["@microsoft/webui-framework"],
    /webui-framework-local\.tgz$/u,
  );
  assert.match(
    specifiers["@microsoft/webui-router"],
    /webui-router-local\.tgz$/u,
  );
});

test("local builds expose the checkout native addon", () => {
  const checkout = resolve(REPOSITORY_ROOT, "local-webui");
  const addon = configuredWebuiAddonPath(checkout, process.platform);
  if (process.platform === "win32") {
    assert.equal(addon, resolve(checkout, "target", "release", "webui_node.dll"));
  } else {
    assert.ok(addon?.includes(resolve(checkout, "target", "release")));
  }
});
