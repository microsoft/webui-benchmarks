// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import { createCaseMatrix } from "../../todo/runner/lib/cases.mjs";
import {
  WINDOWS_PROCESS_METRICS_UNAVAILABLE_REASON,
} from "../../todo/runner/lib/metrics.mjs";
import { buildBenchmarkSummary } from "../export-benchmark-summary.mjs";

const WINDOWS_SATURATION_REASON = "Server process metrics were unavailable";

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

function responseByteProfile(index = 0) {
  return {
    cachedRouteContract: 10_000,
    dynamic: {
      byVariant: Array.from(
        { length: 32 },
        (_, variant) => 10_000 + index + variant,
      ),
      maximum: 10_131 + index,
      mean: 10_065.5 + index,
      minimum: 10_000 + index,
    },
  };
}

function rawRound(benchmarkCase, round, orderIndex) {
  return {
    caseId: benchmarkCase.id,
    headline: true,
    inputPolicy: "request-timestamped-input",
    latencyP50Ms: 10 + orderIndex,
    latencyP95Ms: 20 + orderIndex,
    latencyP99Ms: 30 + orderIndex,
    latencyP95Status: "histogram-10us",
    loadGenerator: { status: "available" },
    metricsStatus: "ok",
    naturalResponseBytes: 10_065.5 + orderIndex,
    orderIndex,
    payloadPolicy: "natural",
    requests: 10_000,
    requestsPerSecond: 1_000 - orderIndex * 10,
    responseByteProfile: responseByteProfile(orderIndex),
    responseBytes: 10_065.5 + orderIndex,
    round,
    serverMetrics: { status: "available" },
    throughputBytesPerSecond: 10_000_000,
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
    latencyP50Ms: statistic(10 + index),
    latencyP95Ms: statistic(20 + index),
    naturalResponseBytes: 10_065.5 + index,
    payloadPolicy: "natural",
    renderer: benchmarkCase.renderer,
    requestsPerSecond: statistic(1_000 - index * 10),
    responseByteProfile: responseByteProfile(index),
    responseBytes: 10_065.5 + index,
    throughputBytesPerSecond: statistic(10_000_000 - index * 10_000),
    transport: benchmarkCase.transport,
    workerCount: 1,
  }));
  const rawRounds = Array.from(
    { length: 7 },
    (_, round) => cases.map((benchmarkCase, index) =>
      rawRound(benchmarkCase, round, index)
    ),
  ).flat();
  return {
    builds: [],
    cases,
    config: {
      build: true,
      caseFilters: [],
      connections: 64,
      durationSeconds: 10,
      loadWorkers: 2,
      quick: false,
      rounds: 7,
      runtimeMode: "official",
      saturationConnections: [1, 8, 32, 64, 128, 192, 200],
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
    rawRounds,
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

function windowsPartialReport() {
  const value = report();
  const serverMetrics = () => ({
    reason: WINDOWS_PROCESS_METRICS_UNAVAILABLE_REASON,
    status: "unavailable",
  });
  value.status = "partial";
  value.machine = {
    osPlatform: "win32",
    processPlatform: "win32",
  };
  value.rawRounds = value.rawRounds.map((round) => ({
    ...round,
    metricsStatus: "metrics-unavailable",
    serverMetrics: serverMetrics(),
  }));
  const runtimeIds = [
    ...new Set(
      value.cases
        .map((benchmarkCase) => benchmarkCase.runtimeId)
        .filter((runtimeId) => runtimeId !== "rust"),
    ),
  ];
  value.runtimeVerification = {
    mode: "official",
    runtimes: runtimeIds.map((runtimeId) => ({
      installed: true,
      required: true,
      runtimeId,
      status: "available",
      versionMatches: true,
    })),
    schema: "webui.ssr-todo-runtime-pins/v1",
    status: "ok",
  };
  value.runtimePolicy = {
    decisions: runtimeIds.map((runtimeId) => ({
      code: null,
      reason: null,
      runtimeId,
      status: "available",
    })),
    status: "ok",
  };
  value.saturation = value.cases.map((benchmarkCase) => ({
    analysis: {
      peakConnections: 64,
      peakRequestsPerSecond: 1_000,
      plateauStatus: "saturated",
      reason: WINDOWS_SATURATION_REASON,
      status: "process-metrics-unavailable",
    },
    caseId: benchmarkCase.id,
    samples: value.config.saturationConnections.map((connections) => ({
      connections,
      latencyP95Status: "histogram-10us",
      loadGenerator: { status: "available" },
      serverMetrics: serverMetrics(),
    })),
  }));
  return value;
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

test("accepts complete Windows reports with intentional process telemetry gaps", () => {
  const summary = buildBenchmarkSummary(windowsPartialReport());
  assert.equal(summary.benchmarks.rows.length, 14);
  assert.equal(summary.benchmarks.hasUnavailable, false);
});

test("refuses dirty or incomplete benchmark evidence", () => {
  const dirty = report();
  dirty.sourceRevision.workingTreeDirty = true;
  assert.throws(
    () => buildBenchmarkSummary(dirty),
    /clean, complete, unfiltered seven-round official report/u,
  );
});

test("rejects partial reports with any non-Windows-sampler cause", async (t) => {
  const scenarios = [
    ["dirty source", (value) => {
      value.sourceRevision.workingTreeDirty = true;
    }],
    ["quick mode", (value) => {
      value.config.quick = true;
    }],
    ["case filters", (value) => {
      value.config.caseFilters = ["*"];
    }],
    ["incomplete case", (value) => {
      value.cases[0].status = "skipped";
    }],
    ["missing summary", (value) => {
      value.matrix.summaries = value.matrix.summaries.slice(1);
    }],
    ["missing required summary field", (value) => {
      delete value.matrix.summaries[0].renderer;
    }],
    ["missing required round", (value) => {
      value.rawRounds.pop();
    }],
    ["duplicate case and round", (value) => {
      value.rawRounds[1] = { ...value.rawRounds[0] };
    }],
    ["unverified runtime", (value) => {
      value.runtimeVerification.runtimes[0].versionMatches = false;
    }],
    ["failed runtime verification", (value) => {
      value.runtimeVerification.status = "failed";
    }],
    ["failed runtime policy", (value) => {
      value.runtimePolicy.decisions[0].status = "failed";
    }],
    ["non-Windows machine", (value) => {
      value.machine.osPlatform = "linux";
      value.machine.processPlatform = "linux";
    }],
    ["mixed process-metric reasons", (value) => {
      value.rawRounds[0].serverMetrics.reason = "A different failure";
    }],
    ["available server metrics", (value) => {
      value.rawRounds[0].serverMetrics = { status: "available" };
    }],
    ["failed server metrics", (value) => {
      value.rawRounds[0].serverMetrics.status = "failed";
    }],
    ["unavailable load-generator metrics", (value) => {
      value.rawRounds[0].loadGenerator.status = "unavailable";
    }],
    ["unavailable latency metrics", (value) => {
      value.rawRounds[0].latencyP95Status = "unavailable";
    }],
    ["mixed saturation reasons", (value) => {
      value.saturation[0].samples[0].serverMetrics.reason = "A different failure";
    }],
    ["additional saturation failure", (value) => {
      value.saturation[0].analysis.status = "server-unsaturated";
    }],
  ];
  for (const [name, mutate] of scenarios) {
    await t.test(name, () => {
      const value = windowsPartialReport();
      mutate(value);
      assert.throws(
        () => buildBenchmarkSummary(value),
        /partial reports are allowed only for documented Windows process telemetry unavailability/u,
      );
    });
  }
});
