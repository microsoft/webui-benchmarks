// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import { createCaseMatrix } from "../../todo/runner/lib/cases.mjs";
import { buildBenchmarkSummary } from "../export-benchmark-summary.mjs";

function statistic(median, mad = 1) {
  return {
    count: 7,
    mad,
    max: median + mad,
    median,
    min: median - mad,
    p95: median + mad,
  };
}

function report() {
  const cases = createCaseMatrix().map((benchmarkCase) => ({
    ...benchmarkCase,
    status: "complete",
  }));
  const summaries = cases.map((benchmarkCase, index) => ({
    caseId: benchmarkCase.id,
    headline: true,
    inputPolicy: "request-timestamped-input",
    label: benchmarkCase.label,
    latencyP95Ms: statistic(20 + index),
    naturalResponseBytes: 10_050 + index,
    payloadPolicy: "natural",
    renderer: benchmarkCase.renderer,
    requestsPerSecond: statistic(1_000 - index * 10),
    responseByteProfile: {
      cachedRouteContract: 10_000,
      dynamic: {
        maximum: 10_100 + index,
        mean: 10_050 + index,
        minimum: 10_000 + index,
      },
      variants: Array.from({ length: 32 }, (_, variant) => 10_000 + variant),
    },
    responseBytes: 10_050 + index,
    transport: benchmarkCase.transport,
    workerCount: 1,
  }));
  return {
    builds: [],
    cases,
    config: {
      connections: 64,
      durationSeconds: 10,
      loadWorkers: 2,
      quick: false,
      rounds: 7,
      runtimeMode: "official",
    },
    createdAt: "2026-08-25T00:00:00.000Z",
    fixture: {
      hash: {
        algorithm: "sha256",
        value: "a".repeat(64),
      },
      stateVariants: 32,
    },
    matrix: {
      expectedCaseCount: 14,
      id: "official-ssr-matrix",
      naturalResponseBytes: { policy: "natural" },
      summaries,
    },
    policies: {
      finalHtmlCacheInHeadline: false,
      headlineInput: "request-timestamped-input",
      headlineMode: "dynamic",
      payload: "natural",
      workersPerCase: 1,
    },
    rawRounds: [],
    schema: "webui.ssr-todo-benchmark/v1",
    sourceRevision: {
      commit: "b".repeat(40),
      sourceDigest: "a".repeat(64),
      workingTreeDirty: false,
    },
    status: "ok",
    summaries,
  };
}

test("exports only the compact homepage benchmark DTO", () => {
  const summary = buildBenchmarkSummary(report());
  assert.deepEqual(Object.keys(summary), ["benchmarks", "benchmarksJson"]);
  assert.equal(summary.benchmarks.rows.length, 14);
  assert.equal(summary.benchmarks.rows[0].rank, "1");
  assert.equal(summary.benchmarks.rows[0].primary, true);
  assert.deepEqual(JSON.parse(summary.benchmarksJson), summary.benchmarks);
  assert.equal("rawRounds" in summary, false);
});

test("refuses dirty or incomplete benchmark evidence", () => {
  const dirty = report();
  dirty.sourceRevision.workingTreeDirty = true;
  assert.throws(
    () => buildBenchmarkSummary(dirty),
    /clean, complete seven-round official report/u,
  );
});
