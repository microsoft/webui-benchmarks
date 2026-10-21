// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cpus,
  freemem,
  hostname,
  platform,
  release,
  totalmem,
} from "node:os";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import {
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import process from "node:process";
import {
  BENCHMARK_ROOT,
  BUILD_ROOT,
  REPOSITORY_ROOT,
  TODO_ROOT,
} from "./paths.mjs";
import { resolveNativeAddon } from "../../servers/lib/webui-engine.mjs";
import {
  collectWebuiDependency,
  configuredWebuiCheckout,
  webuiFixtureFiles,
  webuiFixtureRoots,
} from "../../shared/webui-dependency.mjs";

const APP_METADATA_SCHEMA = "webui.ssr-todo-app/v1";
const FULL_STACK_IDS = Object.freeze(["next", "nuxt", "sveltekit", "astro"]);
const FIXTURE_EXTENSIONS = new Set([
  ".astro",
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".jsx",
  ".json",
  ".lock",
  ".mjs",
  ".proto",
  ".rs",
  ".svelte",
  ".toml",
  ".ts",
  ".tsx",
  ".vue",
  ".yaml",
  ".yml",
]);
const IGNORED_DIRECTORIES = new Set([
  ".astro",
  ".browser-output",
  ".cache",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".vite",
  ".vite-temp",
  ".git",
  "browser-build",
  "browser-dist",
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
  "tests",
]);
const IGNORED_FILES = new Set([".webui-local.json"]);
const webuiCheckout = configuredWebuiCheckout();

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function isIgnoredDirectory(name) {
  if (IGNORED_DIRECTORIES.has(name)) {
    return true;
  }
  const normalized = name.toLowerCase();
  return normalized.includes("browser")
    && (
      normalized.includes("build")
      || normalized.includes("dist")
      || normalized.includes("generated")
      || normalized.includes("output")
    );
}

export function loadFullStackMetadata(appId) {
  if (!FULL_STACK_IDS.includes(appId)) {
    throw new RangeError(`Unknown full-stack app '${appId}'`);
  }
  const appRoot = resolve(TODO_ROOT, "apps", appId);
  const manifestPath = resolve(appRoot, "package.json");
  const manifest = readJson(manifestPath);
  const metadata = manifest.webuiBenchmark;
  if (metadata?.schema !== APP_METADATA_SCHEMA || metadata.id !== appId) {
    throw new Error(`${appId} has invalid webuiBenchmark metadata`);
  }
  if (manifest.engines?.node !== "24.19.0") {
    throw new Error(`${appId} must pin Node 24.19.0`);
  }
  const rootManifest = readJson(resolve(BENCHMARK_ROOT, "package.json"));
  const dependencies = {
    ...rootManifest.dependencies,
    ...rootManifest.devDependencies,
  };
  for (const packageName of metadata.frameworkPackages) {
    if (typeof dependencies[packageName] !== "string") {
      throw new Error(
        `root workspace does not declare framework dependency '${packageName}'`,
      );
    }
  }
  if (metadata.workerCount !== 1 || metadata.compression !== false) {
    throw new Error(`${appId} must declare one worker and disabled compression`);
  }
  return Object.freeze({
    appRoot,
    dependencies: Object.freeze(dependencies),
    manifest: Object.freeze(manifest),
    metadata: Object.freeze(metadata),
  });
}

function walkFixtureFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current)) {
      if (isIgnoredDirectory(entry) || IGNORED_FILES.has(entry)) {
        continue;
      }
      if (entry.endsWith(".test.mjs")) {
        continue;
      }
      const path = join(current, entry);
      if (statSync(path).isDirectory()) {
        pending.push(path);
      } else if (FIXTURE_EXTENSIONS.has(extname(entry))) {
        files.push(path);
      }
    }
  }
  return files.sort();
}

function fixturePathName(path) {
  const benchmarkName = relative(BENCHMARK_ROOT, path).replaceAll("\\", "/");
  if (!benchmarkName.startsWith("../") && !isAbsolute(benchmarkName)) {
    return benchmarkName;
  }
  if (webuiCheckout !== null) {
    const checkoutName = relative(webuiCheckout, path).replaceAll("\\", "/");
    if (!checkoutName.startsWith("../") && !isAbsolute(checkoutName)) {
      return `webui-checkout/${checkoutName}`;
    }
  }
  throw new Error(`Fixture source is outside known roots: ${path}`);
}

export function computeFixtureHash(
  roots = undefined,
  explicitFiles = [],
) {
  const fixtureRoots = roots ?? [BENCHMARK_ROOT, ...webuiFixtureRoots()];
  const files = [
    ...fixtureRoots.flatMap(walkFixtureFiles).map((path) => ({
      name: fixturePathName(path),
      path,
    })),
    ...(roots === undefined ? webuiFixtureFiles() : []),
    ...explicitFiles.map((file) =>
      typeof file === "string"
        ? { name: fixturePathName(file), path: file }
        : file
    ),
  ].sort((left, right) => left.name.localeCompare(right.name));
  const hash = createHash("sha256");
  for (const { name, path } of files) {
    hash.update(name);
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return Object.freeze({
    algorithm: "sha256",
    files: Object.freeze(files.map(({ name }) => name)),
    value: hash.digest("hex"),
  });
}

export function collectSourceRevision(sourceDigest) {
  if (typeof sourceDigest !== "string" || sourceDigest.length !== 64) {
    throw new TypeError("sourceDigest must be a SHA-256 digest");
  }
  const commit = commandVersion("git", ["rev-parse", "HEAD"], REPOSITORY_ROOT);
  const status = commandVersion(
    "git",
    ["status", "--porcelain"],
    REPOSITORY_ROOT,
  );
  if (commit === null || status === null) {
    throw new Error("Failed to capture the benchmark source revision");
  }
  return Object.freeze({
    commit,
    sourceDigest,
    workingTreeDirty: status.length > 0,
  });
}

function workspaceDependencyVersion(name) {
  const cargo = readFileSync(resolve(REPOSITORY_ROOT, "Cargo.toml"), "utf8");
  const prefix = `${name} = `;
  const line = cargo.split(/\r?\n/u).find((candidate) =>
    candidate.startsWith(prefix)
  );
  if (line === undefined) {
    return null;
  }
  const quoted = line.match(/"([^"]+)"/u);
  return quoted?.[1] ?? null;
}

export function collectFrameworkVersions() {
  const rootManifest = readJson(resolve(BENCHMARK_ROOT, "package.json"));
  const controlledPackages = [
    "@microsoft/fast-element",
    "@microsoft/webui-router",
    "@solidjs/router",
    "@tanstack/react-router",
    "@vue/server-renderer",
    "preact",
    "preact-iso",
    "preact-render-to-string",
    "react",
    "react-dom",
    "react-router",
    "solid-js",
    "vue",
    "vue-router",
  ];
  const controlled = Object.fromEntries(
    controlledPackages.map((name) => [
      name,
      rootManifest.dependencies[name] ?? rootManifest.devDependencies?.[name],
    ]),
  );
  const fullStack = Object.fromEntries(
    FULL_STACK_IDS.map((appId) => {
      const app = loadFullStackMetadata(appId);
      return [
        appId,
        Object.fromEntries(
          app.metadata.frameworkPackages.map((name) => [
            name,
            app.dependencies[name],
          ]),
        ),
      ];
    }),
  );
  return Object.freeze({
    actixWeb: workspaceDependencyVersion("actix-web"),
    controlled: Object.freeze(controlled),
    fullStack: Object.freeze(fullStack),
    webui: collectWebuiDependency().version,
  });
}

export function collectMachineMetadata() {
  const processors = cpus();
  return Object.freeze({
    architecture: process.arch,
    cpuCount: processors.length,
    cpuModel: processors[0]?.model ?? "unknown",
    freeMemoryBytes: freemem(),
    hostname: hostname(),
    nodeExecutable: process.execPath,
    nodeVersion: process.versions.node,
    osPlatform: platform(),
    osRelease: release(),
    processPlatform: process.platform,
    totalMemoryBytes: totalmem(),
  });
}

function commandVersion(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
}

export function collectToolVersions() {
  return Object.freeze({
    cargo: commandVersion("cargo", ["--version"]),
    node: process.version,
    rustc: commandVersion("rustc", ["--version", "--verbose"]),
  });
}

export async function assertBuildArtifacts(cases) {
  const missing = [];
  for (const benchmarkCase of cases) {
    if (benchmarkCase.launcher.kind === "full-stack") {
      const app = loadFullStackMetadata(benchmarkCase.appId);
      const path = resolve(app.appRoot, app.metadata.buildOutput);
      if (!existsSync(path)) {
        missing.push(relative(BENCHMARK_ROOT, path));
      }
    }
  }
  const rustSelected = cases.some(
    (benchmarkCase) => benchmarkCase.launcher.kind === "rust-actix",
  );
  if (rustSelected) {
    const extension = process.platform === "win32" ? ".exe" : "";
    const path = resolve(
      BUILD_ROOT,
      "release",
      `ssr-framework-bench-todo-actix${extension}`,
    );
    if (!existsSync(path)) {
      missing.push(relative(BENCHMARK_ROOT, path));
    }
    for (const benchmarkCase of cases) {
      const protocol = benchmarkCase.launcher.protocol;
      if (
        benchmarkCase.launcher.kind === "rust-actix"
        && protocol !== undefined
      ) {
        const protocolPath = resolve(BENCHMARK_ROOT, protocol);
        if (!existsSync(protocolPath)) {
          missing.push(relative(BENCHMARK_ROOT, protocolPath));
        }
      }
    }
  }
  const rendererArtifacts = {
    solid: resolve(TODO_ROOT, "apps", "solid", "dist", "server.mjs"),
    webui: resolve(
      TODO_ROOT,
      "apps",
      "webui-lightdom",
      "dist",
      "protocol.bin",
    ),
  };
  for (const [appId, path] of Object.entries(rendererArtifacts)) {
    if (
      cases.some(
        (benchmarkCase) =>
          benchmarkCase.launcher.kind === "renderer"
          && benchmarkCase.appId === appId,
      )
      && !existsSync(path)
    ) {
      missing.push(relative(BENCHMARK_ROOT, path));
    }
  }
  const nativeAddonSelected = cases.some(
    (benchmarkCase) => benchmarkCase.launcher.kind === "webui-runtime",
  );
  if (nativeAddonSelected) {
    const protocol = resolve(
      TODO_ROOT,
      "apps",
      "webui-lightdom",
      "dist",
      "protocol.bin",
    );
    if (!existsSync(protocol)) {
      missing.push(relative(BENCHMARK_ROOT, protocol));
    }
    try {
      await resolveNativeAddon();
    } catch (error) {
      missing.push(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing production benchmark artifacts:\n${missing.join("\n")}`);
  }
}

export function productionEntry(app) {
  return resolve(
    app.metadata.productionEntryBase === "workspace"
      ? BENCHMARK_ROOT
      : app.appRoot,
    app.metadata.productionEntry,
  );
}

export {
  APP_METADATA_SCHEMA,
  FULL_STACK_IDS,
  collectWebuiDependency,
};
