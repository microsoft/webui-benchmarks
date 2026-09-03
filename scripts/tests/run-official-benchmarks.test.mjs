// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import {
  OFFICIAL_BENCHMARK_OUTPUTS,
  OFFICIAL_BENCHMARK_STEPS,
  runOfficialBenchmarks,
} from "../run-official-benchmarks.mjs";

test("official workflow emits raw evidence and copy-ready summaries for both suites", async () => {
  const observed = [];
  const outputs = await runOfficialBenchmarks({
    runStep(step) {
      observed.push(step);
    },
  });
  assert.equal(outputs, OFFICIAL_BENCHMARK_OUTPUTS);
  assert.deepEqual(
    observed.map(({ id }) => id),
    ["ssr", "ssr-complete", "browser", "summary", "summary-complete"],
  );
  assert.deepEqual(OFFICIAL_BENCHMARK_OUTPUTS, {
    browser: "results/ssr-todo-browser-outcomes-official.json",
    ssr: "results/ssr-todo-official.json",
    ssrComplete: "results/ssr-todo-official-complete.json",
    summary: "results/benchmark-summary.json",
    summaryComplete: "results/benchmark-summary-complete.json",
  });
  assert.deepEqual(
    OFFICIAL_BENCHMARK_STEPS[0].arguments,
    [
      "--runtime-mode",
      "official",
      "--response-mode",
      "progressive",
      "--save-baseline",
      "official",
      "--allow-load-errors",
    ],
  );
  assert.deepEqual(
    OFFICIAL_BENCHMARK_STEPS[1].arguments,
    [
      "--runtime-mode",
      "official",
      "--response-mode",
      "complete",
      "--save-baseline",
      "official-complete",
      "--allow-load-errors",
    ],
  );
  assert.deepEqual(
    OFFICIAL_BENCHMARK_STEPS[3].arguments,
    [
      "--input",
      OFFICIAL_BENCHMARK_OUTPUTS.ssr,
      "--browser-input",
      OFFICIAL_BENCHMARK_OUTPUTS.browser,
      "--complete-input",
      OFFICIAL_BENCHMARK_OUTPUTS.ssrComplete,
      "--output",
      OFFICIAL_BENCHMARK_OUTPUTS.summary,
    ],
  );
  assert.deepEqual(
    OFFICIAL_BENCHMARK_STEPS[4].arguments,
    [
      "--input",
      OFFICIAL_BENCHMARK_OUTPUTS.ssrComplete,
      "--output",
      OFFICIAL_BENCHMARK_OUTPUTS.summaryComplete,
    ],
  );
});
