// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import {
  OFFICIAL_BENCHMARK_OUTPUTS,
  OFFICIAL_BENCHMARK_STEPS,
  runOfficialBenchmarks,
} from "../run-official-benchmarks.mjs";

test("official workflow emits raw evidence and a copy-ready summary", async () => {
  const observed = [];
  const outputs = await runOfficialBenchmarks({
    runStep(step) {
      observed.push(step);
    },
  });
  assert.equal(outputs, OFFICIAL_BENCHMARK_OUTPUTS);
  assert.deepEqual(
    observed.map(({ id }) => id),
    ["ssr", "browser", "summary"],
  );
  assert.deepEqual(OFFICIAL_BENCHMARK_OUTPUTS, {
    browser: "results/ssr-todo-browser-outcomes-official.json",
    ssr: "results/ssr-todo-official.json",
    summary: "results/benchmark-summary.json",
  });
  assert.deepEqual(
    OFFICIAL_BENCHMARK_STEPS[2].arguments,
    [
      "--input",
      OFFICIAL_BENCHMARK_OUTPUTS.ssr,
      "--browser-input",
      OFFICIAL_BENCHMARK_OUTPUTS.browser,
      "--output",
      OFFICIAL_BENCHMARK_OUTPUTS.summary,
    ],
  );
});
