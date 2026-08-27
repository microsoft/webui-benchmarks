// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isMainModule } from "../todo/servers/lib/cli.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const OFFICIAL_BENCHMARK_OUTPUTS = Object.freeze({
  browser: "results/ssr-todo-browser-outcomes-official.json",
  ssr: "results/ssr-todo-official.json",
  summary: "results/benchmark-summary.json",
});

export const OFFICIAL_BENCHMARK_STEPS = Object.freeze([
  Object.freeze({
    arguments: Object.freeze([
      "--runtime-mode",
      "official",
      "--save-baseline",
      "official",
    ]),
    id: "ssr",
    script: "todo/runner/cli.mjs",
  }),
  Object.freeze({
    arguments: Object.freeze([
      "--official",
      "--rounds",
      "10",
      "--headed",
      "--output",
      OFFICIAL_BENCHMARK_OUTPUTS.browser,
    ]),
    id: "browser",
    script: "todo/browser/cli.mjs",
  }),
  Object.freeze({
    arguments: Object.freeze([
      "--input",
      OFFICIAL_BENCHMARK_OUTPUTS.ssr,
      "--browser-input",
      OFFICIAL_BENCHMARK_OUTPUTS.browser,
      "--output",
      OFFICIAL_BENCHMARK_OUTPUTS.summary,
    ]),
    id: "summary",
    script: "scripts/export-benchmark-summary.mjs",
  }),
]);

function executeStep(step) {
  return new Promise((resolveStep, reject) => {
    const child = spawn(
      process.execPath,
      [resolve(repositoryRoot, step.script), ...step.arguments],
      {
        cwd: repositoryRoot,
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveStep();
        return;
      }
      reject(
        new Error(
          signal === null
            ? `${step.id} benchmark step exited with code ${code}`
            : `${step.id} benchmark step exited from signal ${signal}`,
        ),
      );
    });
  });
}

export async function runOfficialBenchmarks({
  runStep = executeStep,
} = {}) {
  for (const step of OFFICIAL_BENCHMARK_STEPS) {
    await runStep(step);
  }
  process.stdout.write(
    `Copy-ready benchmark summary: ${
      resolve(repositoryRoot, OFFICIAL_BENCHMARK_OUTPUTS.summary)
    }\n`,
  );
  return OFFICIAL_BENCHMARK_OUTPUTS;
}

if (isMainModule(import.meta.url)) {
  await runOfficialBenchmarks();
}
