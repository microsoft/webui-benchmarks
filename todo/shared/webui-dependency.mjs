// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = resolve(here, "..", "..");
export const LOCAL_WEBUI_CONFIG = resolve(
  REPOSITORY_ROOT,
  ".webui-local.json",
);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function configuredWebuiCheckout(environment = process.env) {
  const explicit = environment.WEBUI_CHECKOUT;
  const configured = explicit
    ?? (existsSync(LOCAL_WEBUI_CONFIG)
      ? readJson(LOCAL_WEBUI_CONFIG).checkout
      : undefined);
  if (!configured) {
    return null;
  }
  const checkout = realpathSync(resolve(REPOSITORY_ROOT, configured));
  for (const path of [
    resolve(checkout, "Cargo.toml"),
    resolve(checkout, "packages", "webui", "package.json"),
    resolve(checkout, "packages", "webui-framework", "package.json"),
    resolve(checkout, "crates", "webui-handler", "Cargo.toml"),
  ]) {
    if (!existsSync(path)) {
      throw new Error(`Configured WebUI checkout is missing ${path}`);
    }
  }
  return checkout;
}

export function webuiReleaseVersion() {
  const manifest = readJson(resolve(REPOSITORY_ROOT, "package.json"));
  const webui = manifest.dependencies?.["@microsoft/webui"];
  const framework = manifest.dependencies?.["@microsoft/webui-framework"];
  const router = manifest.dependencies?.["@microsoft/webui-router"];
  if (
    typeof webui !== "string"
    || webui !== framework
    || webui !== router
    || !/^\d+\.\d+\.\d+$/u.test(webui)
  ) {
    throw new Error(
      "WebUI, WebUI Framework, and WebUI Router must use one exact version",
    );
  }
  return webui;
}

export function webuiCargoArguments(
  args,
  checkout = configuredWebuiCheckout(),
) {
  if (checkout === null) {
    return [...args];
  }
  const handler = resolve(checkout, "crates", "webui-handler")
    .replaceAll("\\", "\\\\");
  return [
    "--config",
    `patch.crates-io.microsoft-webui-handler.path="${handler}"`,
    ...args,
  ];
}

export function webuiSupportsOptimizedWriter(
  checkout = configuredWebuiCheckout(),
) {
  if (checkout === null) {
    return false;
  }
  const source = readFileSync(
    resolve(checkout, "crates", "webui-handler", "src", "lib.rs"),
    "utf8",
  );
  return source.includes("fn write_attribute(&mut self");
}

function gitValue(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  return result.stdout.trim();
}

export function collectWebuiDependency() {
  const version = webuiReleaseVersion();
  const checkout = configuredWebuiCheckout();
  if (checkout === null) {
    return Object.freeze({
      cargo: `=${version}`,
      kind: "release",
      npm: version,
      version,
    });
  }
  const manifest = readJson(
    resolve(checkout, "packages", "webui", "package.json"),
  );
  const commit = gitValue(["rev-parse", "HEAD"], checkout);
  const status = gitValue(["status", "--porcelain"], checkout);
  if (commit === null || status === null) {
    throw new Error("Failed to identify the configured WebUI checkout");
  }
  return Object.freeze({
    checkout: relative(REPOSITORY_ROOT, checkout).replaceAll("\\", "/"),
    commit,
    kind: "checkout",
    version: manifest.version,
    workingTreeDirty: status.length > 0,
  });
}

export function webuiFixtureRoots() {
  const checkout = configuredWebuiCheckout();
  if (checkout === null) {
    return Object.freeze([]);
  }
  return Object.freeze([
    resolve(checkout, "crates", "webui-expressions"),
    resolve(checkout, "crates", "webui-discovery"),
    resolve(checkout, "crates", "webui-handler"),
    resolve(checkout, "crates", "webui-node"),
    resolve(checkout, "crates", "webui-parser"),
    resolve(checkout, "crates", "webui-protocol"),
    resolve(checkout, "crates", "webui-state"),
    resolve(checkout, "crates", "webui-tokens"),
    resolve(checkout, "crates", "webui"),
    resolve(checkout, "packages", "webui"),
    resolve(checkout, "packages", "webui-framework"),
  ]);
}
