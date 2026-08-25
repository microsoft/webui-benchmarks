// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { existsSync } from "node:fs";
import process from "node:process";
import { join, win32 as windowsPath } from "node:path";
import { runManagedCommand } from "./process-tree.mjs";
import { BENCHMARK_ROOT, REPOSITORY_ROOT } from "./paths.mjs";
import {
  configuredWebuiCheckout,
  webuiCargoArguments,
  webuiSupportsOptimizedWriter,
} from "../../shared/webui-dependency.mjs";

export function windowsCommandCandidates(name, environment = process.env) {
  const path = environment.Path ?? environment.PATH ?? "";
  const extensions = (environment.PATHEXT ?? ".EXE;.CMD")
    .split(";")
    .filter(Boolean);
  return path
    .split(";")
    .filter(Boolean)
    .flatMap((directory) =>
      extensions.map((extension) =>
        windowsPath.join(directory, `${name}${extension}`)
      )
    );
}

function resolveWindowsCommand(name) {
  return windowsCommandCandidates(name).find(existsSync) ?? `${name}.cmd`;
}

const pnpmCommand = process.platform === "win32"
  ? resolveWindowsCommand("pnpm")
  : "pnpm";
const cargoCommand = process.platform === "win32" ? "cargo.exe" : "cargo";
const webuiCheckout = configuredWebuiCheckout();
const optimizedWriter = webuiSupportsOptimizedWriter(webuiCheckout);

function benchmarkCargoArguments(args) {
  return webuiCargoArguments(
    optimizedWriter
      ? [...args, "--features", "optimized-webui-writer"]
      : args,
    webuiCheckout,
  );
}

function quoteCommandArgument(argument) {
  return /\s|"/u.test(argument)
    ? `"${argument.replaceAll('"', '""')}"`
    : argument;
}

export function portableBuildDefinition(
  definition,
  platform = process.platform,
) {
  if (
    platform !== "win32"
    || !definition.command.toLowerCase().endsWith(".cmd")
  ) {
    return definition;
  }
  const commandLine = [definition.command, ...definition.args]
    .map(quoteCommandArgument)
    .join(" ");
  return Object.freeze({
    ...definition,
    args: ["/d", "/s", "/c", commandLine],
    command: process.env.ComSpec ?? "cmd.exe",
  });
}

const definitions = Object.freeze({
  "webui-package": Object.freeze({
    args: [
      "--filter",
      "@microsoft/webui",
      "--filter",
      "@microsoft/webui-framework",
      "run",
      "build",
    ],
    command: pnpmCommand,
    cwd: webuiCheckout ?? REPOSITORY_ROOT,
    dependsOn: Object.freeze([]),
    display:
      "pnpm --filter @microsoft/webui --filter @microsoft/webui-framework run build",
    id: "webui-package",
  }),
  "native-addon": Object.freeze({
    args: webuiCargoArguments(
      ["build", "--release", "-p", "microsoft-webui-node"],
      webuiCheckout,
    ),
    command: cargoCommand,
    cwd: webuiCheckout ?? REPOSITORY_ROOT,
    dependsOn: Object.freeze([]),
    display: "cargo build --release -p microsoft-webui-node",
    id: "native-addon",
  }),
  webui: Object.freeze({
    args: [join("todo", "runner", "build-renderer.mjs"), "webui"],
    command: process.execPath,
    cwd: BENCHMARK_ROOT,
    dependsOn: Object.freeze([]),
    display: "node todo/runner/build-renderer.mjs webui",
    id: "webui",
  }),
  "webui-shadowdom": Object.freeze({
    args: [
      join("todo", "runner", "build-renderer.mjs"),
      "webui-shadowdom",
    ],
    command: process.execPath,
    cwd: BENCHMARK_ROOT,
    dependsOn: Object.freeze([]),
    display: "node todo/runner/build-renderer.mjs webui-shadowdom",
    id: "webui-shadowdom",
  }),
  "webui-fast": Object.freeze({
    args: [
      join("todo", "runner", "build-renderer.mjs"),
      "webui-fast",
    ],
    command: process.execPath,
    cwd: BENCHMARK_ROOT,
    dependsOn: Object.freeze(["webui"]),
    display: "node todo/runner/build-renderer.mjs webui-fast",
    id: "webui-fast",
  }),
  preact: Object.freeze({
    args: [join("todo", "runner", "build-renderer.mjs"), "preact"],
    command: process.execPath,
    cwd: BENCHMARK_ROOT,
    dependsOn: Object.freeze([]),
    display: "node todo/runner/build-renderer.mjs preact",
    id: "preact",
  }),
  react: Object.freeze({
    args: [join("todo", "runner", "build-renderer.mjs"), "react"],
    command: process.execPath,
    cwd: BENCHMARK_ROOT,
    dependsOn: Object.freeze([]),
    display: "node todo/runner/build-renderer.mjs react",
    id: "react",
  }),
  solid: Object.freeze({
    args: [join("todo", "runner", "build-renderer.mjs"), "solid"],
    command: process.execPath,
    cwd: BENCHMARK_ROOT,
    dependsOn: Object.freeze([]),
    display: "node todo/runner/build-renderer.mjs solid",
    id: "solid",
  }),
  vue: Object.freeze({
    args: [join("todo", "runner", "build-renderer.mjs"), "vue"],
    command: process.execPath,
    cwd: BENCHMARK_ROOT,
    dependsOn: Object.freeze([]),
    display: "node todo/runner/build-renderer.mjs vue",
    id: "vue",
  }),
  "state-pool": Object.freeze({
    args: [join("todo", "servers", "write-state-pool.mjs")],
    command: process.execPath,
    cwd: BENCHMARK_ROOT,
    dependsOn: Object.freeze([]),
    display: "node todo/servers/write-state-pool.mjs",
    id: "state-pool",
  }),
  "rust-actix": Object.freeze({
    args: benchmarkCargoArguments([
      "build",
      "--release",
      "-p",
      "ssr-framework-bench-todo-actix",
    ]),
    command: cargoCommand,
    cwd: REPOSITORY_ROOT,
    dependsOn: Object.freeze(["webui", "state-pool"]),
    display:
      "cargo build --release -p ssr-framework-bench-todo-actix",
    id: "rust-actix",
  }),
  "tls-material": Object.freeze({
    args: benchmarkCargoArguments([
      "build",
      "--release",
      "-p",
      "ssr-framework-bench-todo-actix",
      "--bin",
      "tls_material",
    ]),
    command: cargoCommand,
    cwd: REPOSITORY_ROOT,
    dependsOn: Object.freeze([]),
    display:
      "cargo build --release -p ssr-framework-bench-todo-actix --bin tls_material",
    id: "tls-material",
  }),
  "full-stack-next": Object.freeze({
    args: ["--dir", "todo/apps/next", "build"],
    command: pnpmCommand,
    cwd: BENCHMARK_ROOT,
    dependsOn: Object.freeze([]),
    display: "pnpm --dir todo/apps/next build",
    id: "full-stack-next",
  }),
  "full-stack-nuxt": Object.freeze({
    args: ["--dir", "todo/apps/nuxt", "build"],
    command: pnpmCommand,
    cwd: BENCHMARK_ROOT,
    dependsOn: Object.freeze([]),
    display: "pnpm --dir todo/apps/nuxt build",
    id: "full-stack-nuxt",
  }),
  "full-stack-sveltekit": Object.freeze({
    args: ["--dir", "todo/apps/sveltekit", "build"],
    command: pnpmCommand,
    cwd: BENCHMARK_ROOT,
    dependsOn: Object.freeze([]),
    display: "pnpm --dir todo/apps/sveltekit build",
    id: "full-stack-sveltekit",
  }),
  "full-stack-astro": Object.freeze({
    args: ["--dir", "todo/apps/astro", "build"],
    command: pnpmCommand,
    cwd: BENCHMARK_ROOT,
    dependsOn: Object.freeze([]),
    display: "pnpm --dir todo/apps/astro build",
    id: "full-stack-astro",
  }),
});

const BUILD_ORDER = Object.freeze([
  "webui-package",
  "native-addon",
  "webui",
  "webui-shadowdom",
  "webui-fast",
  "preact",
  "react",
  "solid",
  "vue",
  "state-pool",
  "rust-actix",
  "tls-material",
  "full-stack-next",
  "full-stack-nuxt",
  "full-stack-sveltekit",
  "full-stack-astro",
]);

function addWithDependencies(id, selected, localWebui) {
  if (
    !localWebui
    && (id === "webui-package" || id === "native-addon")
  ) {
    return;
  }
  const definition = definitions[id];
  if (definition === undefined) {
    throw new Error(`Unknown benchmark build '${id}'`);
  }
  const localDependencies = id === "webui"
    ? ["webui-package", "native-addon"]
    : id === "webui-shadowdom"
      ? ["webui-package"]
      : [];
  const dependencies = localWebui
    ? [...localDependencies, ...definition.dependsOn]
    : definition.dependsOn;
  for (const dependency of dependencies) {
    addWithDependencies(dependency, selected, localWebui);
  }
  selected.add(id);
}

export function createBuildPlan(
  cases,
  {
    all = false,
    browser = false,
    localWebui = webuiCheckout !== null,
  } = {},
) {
  const selected = new Set();
  if (browser) selected.add("tls-material");
  if (all) {
    for (const id of BUILD_ORDER) {
      if (
        !localWebui
        && (id === "webui-package" || id === "native-addon")
      ) {
        continue;
      }
      selected.add(id);
    }
  } else {
    for (const benchmarkCase of cases) {
      for (const buildId of benchmarkCase.buildIds) {
        addWithDependencies(buildId, selected, localWebui);
      }
    }
  }
  return Object.freeze(
    BUILD_ORDER.filter((id) => selected.has(id)).map((id) => definitions[id]),
  );
}

export async function runBuildPlan(plan, { registry, progress = () => {} }) {
  const results = [];
  for (const sourceDefinition of plan) {
    const definition = portableBuildDefinition(sourceDefinition);
    progress(`build ${definition.display}`);
    const result = await runManagedCommand(
      definition.command,
      definition.args,
      {
        cwd: definition.cwd,
        env: {
          ...process.env,
          NODE_ENV: "production",
        },
        registry,
      },
    );
    results.push(Object.freeze({
      command: definition.display,
      durationMilliseconds: result.durationMilliseconds,
      id: definition.id,
      status: "ok",
      stderrTail: result.stderr,
      stdoutTail: result.stdout,
    }));
  }
  return Object.freeze(results);
}

export { BUILD_ORDER };
