// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
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
const LOCAL_WEBUI_MODES = new Set(["source", "packed"]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
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

function workingTreeHash(checkout, status) {
  const diff = gitValue(["diff", "--binary", "HEAD"], checkout);
  const untracked = gitValue(
    ["ls-files", "--others", "--exclude-standard"],
    checkout,
  );
  if (diff === null || untracked === null) {
    throw new Error("Failed to fingerprint the WebUI working tree");
  }
  const hash = createHash("sha256").update(status).update(diff);
  for (const path of untracked.split("\n").filter(Boolean)) {
    hash.update(path).update(readFileSync(resolve(checkout, path)));
  }
  return hash.digest("hex");
}

function workspaceVersion(checkout) {
  const manifest = readFileSync(resolve(checkout, "Cargo.toml"), "utf8");
  const workspacePackage = manifest
    .split("[workspace.package]")[1]
    ?.split(/^\[/mu)[0];
  return /^version\s*=\s*"([^"]+)"/mu.exec(workspacePackage ?? "")?.[1]
    ?? null;
}

function walkAllFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current)) {
      const path = resolve(current, entry);
      if (statSync(path).isDirectory()) {
        pending.push(path);
      } else {
        files.push(path);
      }
    }
  }
  return files.sort();
}

export function configuredWebuiConfiguration(environment = process.env) {
  const explicit = environment.WEBUI_CHECKOUT;
  const stored = explicit === undefined && existsSync(LOCAL_WEBUI_CONFIG)
    ? readJson(LOCAL_WEBUI_CONFIG)
    : null;
  const configured = explicit ?? stored?.checkout;
  if (configured === undefined) {
    return null;
  }
  const mode = explicit === undefined ? stored?.mode ?? "source" : "source";
  if (!LOCAL_WEBUI_MODES.has(mode)) {
    throw new Error(`Unsupported local WebUI mode '${mode}'`);
  }
  const checkout = realpathSync(resolve(REPOSITORY_ROOT, configured));
  for (const path of [
    resolve(checkout, "Cargo.toml"),
    resolve(checkout, "packages", "webui", "package.json"),
    resolve(checkout, "packages", "webui-framework", "package.json"),
    resolve(checkout, "packages", "webui-delivery", "package.json"),
    resolve(checkout, "crates", "webui-handler", "Cargo.toml"),
  ]) {
    if (!existsSync(path)) {
      throw new Error(`Configured WebUI checkout is missing ${path}`);
    }
  }
  const version = readJson(
    resolve(checkout, "packages", "webui", "package.json"),
  ).version;
  if (
    version !== webuiReleaseVersion()
    || workspaceVersion(checkout) !== webuiReleaseVersion()
  ) {
    throw new Error(
      `Configured WebUI ${version} does not match the benchmark's exact ${webuiReleaseVersion()} dependency`,
    );
  }
  if (mode === "packed") {
    const commit = gitValue(["rev-parse", "HEAD"], checkout);
    const status = gitValue(["status", "--porcelain"], checkout);
    const snapshot = stored?.snapshot;
    if (
      commit === null
      || status === null
      || snapshot?.commit !== commit
      || snapshot.statusHash !== workingTreeHash(checkout, status)
    ) {
      throw new Error(
        "Packed WebUI checkout changed; run webui:packed again",
      );
    }
    for (const [name, path] of Object.entries(stored?.packages ?? {})) {
      const artifact = resolve(REPOSITORY_ROOT, path);
      const hash = existsSync(artifact)
        ? createHash("sha256").update(readFileSync(artifact)).digest("hex")
        : null;
      if (hash !== stored?.packageHashes?.[name]) {
        throw new Error(
          `Packed WebUI artifact changed or is missing: ${artifact}`,
        );
      }
    }
    if (
      Object.keys(stored?.packages ?? {}).length !== 3
      || Object.keys(stored?.packageHashes ?? {}).length !== 3
    ) {
      throw new Error("Packed WebUI configuration is incomplete");
    }
  }
  return Object.freeze({
    checkout,
    mode,
    packageHashes: stored?.packageHashes ?? null,
    packages: stored?.packages ?? null,
    requestedRef: stored?.requestedRef ?? null,
    snapshot: stored?.snapshot ?? null,
    version: stored?.version ?? version,
  });
}

export function configuredWebuiCheckout(environment = process.env) {
  return configuredWebuiConfiguration(environment)?.checkout ?? null;
}

export function configuredWebuiMode(environment = process.env) {
  return configuredWebuiConfiguration(environment)?.mode ?? "release";
}

export function configuredWebuiAddonPath(
  checkout = configuredWebuiCheckout(),
  platform = process.platform,
) {
  if (checkout === null) {
    return null;
  }
  const fileName = {
    darwin: "libwebui_node.dylib",
    linux: "libwebui_node.so",
    win32: "webui_node.dll",
  }[platform];
  return fileName === undefined
    ? null
    : resolve(checkout, "target", "release", fileName);
}

export function webuiReleaseVersion() {
  const manifest = readJson(resolve(REPOSITORY_ROOT, "package.json"));
  const webui = manifest.dependencies?.["@microsoft/webui"];
  const framework = manifest.dependencies?.["@microsoft/webui-framework"];
  const delivery = manifest.dependencies?.["@microsoft/webui-delivery"];
  if (
    typeof webui !== "string"
    || webui !== framework
    || !/^\d+\.\d+\.\d+$/u.test(webui)
    || typeof delivery !== "string"
    || !/^\d+\.\d+\.\d+$/u.test(delivery)
  ) {
    throw new Error(
      "WebUI and WebUI Framework must share one exact version; WebUI Delivery must use an exact version",
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
    const [major, minor, patch] = webuiReleaseVersion()
      .split(".")
      .map(Number);
    return major > 0 || minor > 0 || patch >= 27;
  }
  const source = readFileSync(
    resolve(checkout, "crates", "webui-handler", "src", "lib.rs"),
    "utf8",
  );
  return source.includes("fn write_attribute(&mut self");
}

export function collectWebuiDependency() {
  const version = webuiReleaseVersion();
  const configuration = configuredWebuiConfiguration();
  if (configuration === null) {
    return Object.freeze({
      cargo: `=${version}`,
      kind: "release",
      npm: version,
      version,
    });
  }
  const {
    checkout,
    mode,
    packageHashes,
    packages,
    snapshot,
  } = configuration;
  const manifest = readJson(
    resolve(checkout, "packages", "webui", "package.json"),
  );
  const commit = gitValue(["rev-parse", "HEAD"], checkout);
  const status = gitValue(["status", "--porcelain"], checkout);
  if (commit === null || status === null) {
    throw new Error("Failed to identify the configured WebUI checkout");
  }
  if (
    mode === "source"
    && configuration.packages !== null
    && (
      configuration.snapshot?.commit !== commit
      || configuration.snapshot.statusHash !== workingTreeHash(checkout, status)
    )
  ) {
    throw new Error("Source WebUI checkout changed; run webui:sync");
  }
  return Object.freeze({
    checkout: relative(REPOSITORY_ROOT, checkout).replaceAll("\\", "/"),
    commit: mode === "packed" ? snapshot.commit : commit,
    kind: mode === "packed" ? "packed-checkout" : "checkout",
    packageArtifacts: mode === "packed"
      ? Object.fromEntries(
        Object.entries(packages).map(([name, path]) => [
          name,
          { path, sha256: packageHashes[name] },
        ]),
      )
      : null,
    version: configuration.version ?? manifest.version,
    workingTreeDirty: mode === "packed"
      ? snapshot.workingTreeDirty
      : status.length > 0,
  });
}

export function webuiFixtureRoots() {
  const configuration = configuredWebuiConfiguration();
  if (configuration === null) {
    return Object.freeze([]);
  }
  const { checkout } = configuration;
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
    resolve(checkout, "packages", "webui-delivery"),
  ]);
}

export function webuiFixtureFiles() {
  const configuration = configuredWebuiConfiguration();
  if (configuration === null || configuration.packages === null) {
    return Object.freeze([]);
  }
  if (configuration.mode === "packed") {
    return Object.freeze(
      Object.entries(configuration.packages).map(([name, path]) =>
        Object.freeze({
          name: `webui-packages/${name.replace("/", "-")}.tgz`,
          path: resolve(REPOSITORY_ROOT, path),
        })
      ),
    );
  }
  return Object.freeze(
    Object.entries(configuration.packages).flatMap(([name, packagePath]) => {
      const root = resolve(REPOSITORY_ROOT, packagePath);
      return walkAllFiles(root).map((path) =>
        Object.freeze({
          name: `webui-packages/${name.replace("/", "-")}/${
            relative(root, path).replaceAll("\\", "/")
          }`,
          path,
        })
      );
    }),
  );
}
