// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import typescript from "typescript";
import {
  REPOSITORY_ROOT,
  configuredWebuiAddonPath,
  webuiCargoArguments,
} from "../../todo/shared/webui-dependency.mjs";
import { loadFullStackMetadata } from "../../todo/runner/lib/metadata.mjs";
import { loadRuntimePins } from "../../todo/servers/verify-runtimes.mjs";

const require = createRequire(import.meta.url);
const {
  packageSpecifiers,
  rewriteDependencies,
} = require("../../.pnpmfile.cjs");

test("benchmark dependencies use exact stable versions and matching renderers", () => {
  const manifest = JSON.parse(
    readFileSync(resolve(REPOSITORY_ROOT, "package.json"), "utf8"),
  );
  const dependencies = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
  };
  for (const [name, version] of Object.entries(dependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/u, name);
  }
  assert.equal(dependencies.react, dependencies["react-dom"]);
  assert.equal(dependencies.vue, dependencies["@vue/server-renderer"]);
  assert.equal(dependencies.vue, dependencies["@vue/compiler-sfc"]);
  assert.equal(
    dependencies["@microsoft/webui"],
    dependencies["@microsoft/webui-framework"],
  );
  assert.match(
    dependencies["@microsoft/webui-delivery"],
    /^\d+\.\d+\.\d+$/u,
  );
});

test("runtime pins agree across applications, CI, and container builds", () => {
  const read = (path) =>
    readFileSync(resolve(REPOSITORY_ROOT, path), "utf8");
  const manifest = JSON.parse(read("package.json"));
  const { node, bun } = loadRuntimePins().runtimes;
  const rust = read("rust-toolchain.toml").match(
    /^channel = "(\d+\.\d+\.\d+)"$/mu,
  )?.[1];
  assert.ok(rust, "Rust must pin an exact stable toolchain");
  assert.equal(manifest.engines.node, node.version);
  assert.equal(manifest.devDependencies.bun, bun.version);
  assert.match(manifest.packageManager, /^pnpm@\d+\.\d+\.\d+$/u);
  for (const appId of ["astro", "next", "nuxt", "sveltekit"]) {
    assert.equal(
      loadFullStackMetadata(appId).manifest.engines.node,
      node.version,
      appId,
    );
  }
  const ci = read(".github/workflows/ci.yml");
  const dockerfile = read("todo/demo/Dockerfile");
  assert.ok(ci.includes(`node-version: ${node.version}`));
  assert.ok(ci.includes(`rustup toolchain install ${rust} --profile minimal`));
  assert.ok(dockerfile.includes(`FROM node:${node.version}-bookworm AS builder`));
  assert.ok(
    dockerfile.includes(`FROM node:${node.version}-bookworm-slim AS runtime`),
  );
  assert.ok(dockerfile.includes(`FROM rust:${rust}-bookworm AS rust`));
  for (const configuration of [ci, dockerfile, read("README.md")]) {
    assert.ok(
      configuration.includes(`npm install --global ${manifest.packageManager}`),
    );
  }
});

test("the shared TypeScript compiler exposes the API required by SvelteKit", () => {
  for (const method of [
    "createSourceFile",
    "parseJsonConfigFileContent",
    "readConfigFile",
  ]) {
    assert.equal(typeof typescript[method], "function", method);
  }
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
        "@microsoft/webui-delivery": "1.0.0",
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
      "@microsoft/webui-delivery": `link:${
        resolve(checkout, "packages", "webui-delivery").replaceAll("\\", "/")
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
      "@microsoft/webui-delivery":
        ".cache/webui-pack/webui-delivery-local.tgz",
    },
  };
  const specifiers = packageSpecifiers(configuration);
  assert.match(specifiers["@microsoft/webui"], /^file:/u);
  assert.match(
    specifiers["@microsoft/webui-framework"],
    /webui-framework-local\.tgz$/u,
  );
  assert.match(
    specifiers["@microsoft/webui-delivery"],
    /webui-delivery-local\.tgz$/u,
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
