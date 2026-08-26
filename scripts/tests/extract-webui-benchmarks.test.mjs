// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildWebuiBenchmarkSummary,
  extractWebuiBenchmarks,
} from "../extract-webui-benchmarks.mjs";

function metricValue(value, valueDisplay = String(value)) {
  return {
    available: true,
    detail: `${valueDisplay} measured`,
    value,
    valueDisplay,
  };
}

function row(caseId, label, requestsPerSecond, firstContentfulPaintMs) {
  return {
    activeAvailable: true,
    activeDetail: `${requestsPerSecond} measured`,
    activeUnit: "req/s",
    activeValueDisplay: String(requestsPerSecond),
    activeWidth: `${requestsPerSecond / 1.2}%`,
    caseId,
    label,
    metrics: {
      firstContentfulPaintMs: metricValue(firstContentfulPaintMs),
      requestsPerSecond: metricValue(requestsPerSecond),
    },
    primary: caseId.startsWith("webui-"),
    rank: "0",
  };
}

function benchmarkSummary() {
  const benchmarks = {
    description:
      "Compare 3 product paths by single-core throughput or browser cost.",
    hasUnavailable: false,
    link: "/webui/guide/concepts/performance/",
    methodology: "SSR methodology",
    metricSummary: "React is first.",
    metrics: [
      {
        available: true,
        description: "Median server throughput.",
        direction: "higher",
        directionLabel: "higher is better",
        id: "requestsPerSecond",
        label: "Single-core RPS",
        methodology: "SSR methodology",
        selected: true,
        summary: "React is first.",
        unit: "req/s",
      },
      {
        available: true,
        description: "First contentful paint.",
        direction: "lower",
        directionLabel: "lower is better",
        id: "firstContentfulPaintMs",
        label: "FCP",
        methodology: "Browser methodology",
        selected: false,
        summary: "React is first.",
        unit: "ms",
      },
    ],
    rows: [
      row("react", "React", 120, 30),
      row("webui-node-http", "WebUI / Node", 100, 40),
      row("webui-deno-serve", "WebUI / Deno", 80, 60),
    ],
    selectedMetric: "requestsPerSecond",
    selectedMetricDescription: "Median server throughput.",
    selectedMetricLabel: "Single-core RPS",
    title: "Same workload. Choose the metric.",
  };
  return {
    benchmarks,
    benchmarksJson: JSON.stringify(benchmarks),
  };
}

test("filters and reranks the compact summary to WebUI rows", () => {
  const source = benchmarkSummary();
  const original = structuredClone(source);
  const filtered = buildWebuiBenchmarkSummary(source);

  assert.deepEqual(source, original);
  assert.deepEqual(
    filtered.benchmarks.rows.map(({ caseId }) => caseId),
    ["webui-node-http", "webui-deno-serve"],
  );
  assert.deepEqual(
    filtered.benchmarks.rows.map(({ rank }) => rank),
    ["1", "2"],
  );
  assert.deepEqual(
    filtered.benchmarks.rows.map(({ activeWidth }) => activeWidth),
    ["100.0%", "80.0%"],
  );
  assert.match(filtered.benchmarks.description, /^Compare 2 WebUI product/u);
  assert.doesNotMatch(filtered.benchmarks.metricSummary, /React/u);
  assert.match(
    filtered.benchmarks.metrics[1].summary,
    /WebUI \/ Node.*40 ms/u,
  );
  assert.deepEqual(
    JSON.parse(filtered.benchmarksJson),
    filtered.benchmarks,
  );
});

test("rejects summaries without WebUI rows", () => {
  const source = benchmarkSummary();
  source.benchmarks.rows = source.benchmarks.rows.slice(0, 1);
  assert.throws(
    () => buildWebuiBenchmarkSummary(source),
    /contains no WebUI rows/u,
  );
});

test("writes a WebUI-only state file", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "webui-benchmarks-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const inputPath = join(directory, "benchmark-summary.json");
  const outputPath = join(directory, "webui.json");
  await writeFile(
    inputPath,
    JSON.stringify(benchmarkSummary()),
    "utf8",
  );

  await extractWebuiBenchmarks(inputPath, outputPath);

  const written = JSON.parse(await readFile(outputPath, "utf8"));
  assert.equal(written.benchmarks.rows.length, 2);
  assert.equal(
    written.benchmarks.rows.every(({ caseId }) =>
      caseId.startsWith("webui-")
    ),
    true,
  );
});
