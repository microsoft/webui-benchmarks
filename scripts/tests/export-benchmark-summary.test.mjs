// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  BROWSER_REPORT_SCHEMA,
  BROWSER_TIER,
  createBrowserCases,
} from "../../todo/browser/apps.mjs";
import {
  METRIC_PATHS,
  aggregateAppRounds,
  availableMetric,
  metricAt,
} from "../../todo/browser/metrics.mjs";
import { createBuildPlan } from "../../todo/runner/lib/builds.mjs";
import {
  ASYNC_DATA_BOUNDARY_CAPABILITY,
  createCaseMatrix,
} from "../../todo/runner/lib/cases.mjs";
import {
  PROCESS_METRICS_INTERVAL_MILLISECONDS,
  WINDOWS_PROCESS_METRICS_UNAVAILABLE_REASON,
} from "../../todo/runner/lib/metrics.mjs";
import { analyzeSaturation } from "../../todo/runner/lib/load.mjs";
import { deterministicOrder } from "../../todo/runner/lib/order.mjs";
import { DEFAULT_PROTOCOL } from "../../todo/runner/lib/options.mjs";
import {
  summarizeResponseByteProfiles,
  summarizeRounds,
} from "../../todo/runner/lib/statistics.mjs";
import { TODO_STATE_VARIANTS } from "../../todo/shared/state.mjs";
import { loadRuntimePins } from "../../todo/servers/verify-runtimes.mjs";
import { buildBenchmarkSummary } from "../export-benchmark-summary.mjs";

const BROWSER_LAUNCH_ARGUMENTS = Object.freeze([
  "--disable-backgrounding-occluded-windows",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-features=CalculateNativeWinOcclusion",
  "--enable-precise-memory-info",
  "--enable-blink-features=DeclarativeCSSModules",
  "--process-per-tab",
]);
const OFFICIAL_CASES = createCaseMatrix();
const OFFICIAL_BUILD_IDS = Object.freeze(
  createBuildPlan(OFFICIAL_CASES, { localWebui: false }).map(({ id }) => id),
);
const OFFICIAL_SOURCE_BUILD_IDS = Object.freeze(
  createBuildPlan(OFFICIAL_CASES, {
    localWebui: true,
    localWebuiSource: true,
  }).map(({ id }) => id),
);
const OFFICIAL_BROWSER_BUILD_IDS = Object.freeze(
  createBuildPlan(OFFICIAL_CASES, {
    browser: true,
    localWebui: false,
  }).map(({ id }) => id),
);
const OFFICIAL_SOURCE_BROWSER_BUILD_IDS = Object.freeze(
  createBuildPlan(OFFICIAL_CASES, {
    browser: true,
    localWebui: true,
    localWebuiSource: true,
  }).map(({ id }) => id),
);
const RUNTIME_PINS = loadRuntimePins();
const SHARED_STATE_DIGEST = createHash("sha256")
  .update(JSON.stringify(TODO_STATE_VARIANTS))
  .digest("hex");

function runtimeEvidence() {
  const runtimeIds = Object.keys(RUNTIME_PINS.runtimes);
  return {
    runtimePolicy: {
      decisions: runtimeIds.map((runtimeId) => ({
        code: null,
        reason: null,
        runtimeId,
        status: "available",
      })),
      status: "ok",
    },
    runtimeVerification: {
      mode: "official",
      runtimes: runtimeIds.map((runtimeId) => ({
        code: null,
        error: null,
        expectedVersion: RUNTIME_PINS.runtimes[runtimeId].version,
        installed: true,
        required: true,
        runtimeId,
        status: "available",
        version: RUNTIME_PINS.runtimes[runtimeId].version,
        versionMatches: true,
      })),
      schema: RUNTIME_PINS.schema,
      status: "ok",
    },
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
  const startupRssBytes = (40 + orderIndex) * 1024 * 1024;
  const postWarmupRssBytes = startupRssBytes + 2 * 1024 * 1024;
  const peakRssBytes = startupRssBytes + 4 * 1024 * 1024;
  const postSettleRssBytes = startupRssBytes + 1024 * 1024;
  return {
    affinity: { cpuIndex: 0, status: "applied" },
    caseId: benchmarkCase.id,
    headline: true,
    inputPolicy: "request-timestamped-input",
    latencyP50Ms: 10 + orderIndex,
    latencyP95Ms: 20 + orderIndex,
    latencyP99Ms: 30 + orderIndex,
    latencyP95Status: "histogram-10us",
    loadGenerator: { status: "available" },
    measurementAttempts: 1,
    metricsStatus: "ok",
    naturalResponseBytes: 10_065.5 + orderIndex,
    orderIndex,
    payloadPolicy: "natural",
    responseMode: benchmarkCase.responseMode,
    requests: 10_000,
    requestsPerSecond: 1_000 - orderIndex * 10,
    responseByteProfile: responseByteProfile(orderIndex),
    responseBytes: 10_065.5 + orderIndex,
    round,
    serverCpuMillisecondsPerRequest: 0.25 + orderIndex / 100,
    serverMemory: {
      loadDeltaPeakRssBytes: peakRssBytes - startupRssBytes,
      peakDuringLoad: { rssBytes: peakRssBytes, status: "available" },
      postSettle: { rssBytes: postSettleRssBytes, status: "available" },
      postWarmup: { rssBytes: postWarmupRssBytes, status: "available" },
      retainedRssBytes: postSettleRssBytes - startupRssBytes,
      startup: { rssBytes: startupRssBytes, status: "available" },
    },
    serverMetrics: { peakRssBytes, status: "available" },
    streaming: benchmarkCase.streaming,
    throughputBytesPerSecond: 10_000_000,
    warmup: {
      durationSeconds: DEFAULT_PROTOCOL.warmupSeconds,
      requests: 1_000,
      status: "ok",
    },
  };
}

function report() {
  const cases = OFFICIAL_CASES.map((benchmarkCase) => ({
    ...benchmarkCase,
    status: "complete",
  }));
  const rawRounds = Array.from(
    { length: DEFAULT_PROTOCOL.rounds },
    (_, round) => deterministicOrder(cases, round).map((benchmarkCase, index) =>
      rawRound(benchmarkCase, round, index)
    ),
  ).flat();
  const summaries = cases.map((benchmarkCase) => {
    const rounds = rawRounds.filter(({ caseId }) =>
      caseId === benchmarkCase.id
    );
    const profile = summarizeResponseByteProfiles(
      rounds.map((round) => round.responseByteProfile),
    );
    return {
      caseId: benchmarkCase.id,
      headline: true,
      inputPolicy: "request-timestamped-input",
      label: benchmarkCase.label,
      naturalResponseBytes: profile.dynamic.mean,
      payloadPolicy: "natural",
      renderer: benchmarkCase.renderer,
      responseMode: benchmarkCase.responseMode,
      responseByteProfile: profile,
      responseBytes: profile.dynamic.mean,
      streaming: benchmarkCase.streaming,
      transport: benchmarkCase.transport,
      workerCount: 1,
      ...summarizeRounds(rounds),
    };
  });
  return {
    builds: OFFICIAL_BUILD_IDS.map((id) => ({ id, status: "ok" })),
    capabilities: {
      asyncDataBoundary: ASYNC_DATA_BOUNDARY_CAPABILITY,
    },
    cases,
    config: {
      build: true,
      caseFilters: [],
      connections: DEFAULT_PROTOCOL.connections,
      durationSeconds: DEFAULT_PROTOCOL.durationSeconds,
      loadWorkers: DEFAULT_PROTOCOL.loadWorkers,
      quick: false,
      responseMode: "progressive",
      rounds: DEFAULT_PROTOCOL.rounds,
      runtimeMode: "official",
      saturationConnections: [...DEFAULT_PROTOCOL.saturationConnections],
      saturationDurationSeconds: DEFAULT_PROTOCOL.saturationDurationSeconds,
      scalingCores: [1],
      serverCpu: 0,
      warmupSeconds: DEFAULT_PROTOCOL.warmupSeconds,
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
      expectedCaseCount: 16,
      id: "official-ssr-matrix",
      naturalResponseBytes: { policy: "natural" },
      summaries,
    },
    policies: {
      finalHtmlCacheInHeadline: false,
      headlineInput: "request-timestamped-input",
      headlineMode: "dynamic",
      payload: "natural",
      responseMode: "progressive",
      workersPerCase: 1,
    },
    rawRounds,
    ...runtimeEvidence(),
    saturation: cases.map((benchmarkCase) => {
      const samples = DEFAULT_PROTOCOL.saturationConnections.map(
        (connections, index) => ({
        connections,
        durationSeconds: DEFAULT_PROTOCOL.saturationDurationSeconds,
        errors: 0,
        latencyP50Ms: 10,
        latencyP95Ms: 20,
        latencyP95Status: "histogram-10us",
        latencyP99Ms: 30,
        loadGenerator: { status: "available" },
        measurementAttempts: 1,
        non2xx: 0,
        requests: 1_000,
        requestsPerSecond: 100 + index * 4,
        serverMetrics: { status: "available" },
        throughputBytesPerSecond: 1_000_000,
        timeouts: 0,
        }),
      );
      return {
        affinity: { cpuIndex: 0, status: "applied" },
        analysis: analyzeSaturation(samples),
        caseId: benchmarkCase.id,
        samples,
      };
    }),
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

function setReportResponseMode(report, responseMode) {
  const expectedCases = new Map(
    createCaseMatrix({ responseMode }).map((entry) => [entry.id, entry]),
  );
  report.config.responseMode = responseMode;
  report.policies.responseMode = responseMode;
  for (const collection of [
    report.cases,
    report.rawRounds,
    report.summaries,
    report.matrix.summaries,
  ]) {
    for (const entry of collection) {
      const expected = expectedCases.get(entry.id ?? entry.caseId);
      entry.responseMode = responseMode;
      if (expected !== undefined) {
        if ("renderer" in entry) {
          entry.renderer = expected.renderer;
        }
        entry.streaming = expected.streaming;
      }
    }
  }
  report.capabilities = responseMode === "progressive"
    ? { asyncDataBoundary: ASYNC_DATA_BOUNDARY_CAPABILITY }
    : {};
}

function windowsPartialReport() {
  const value = report();
  const serverMetrics = () => ({
    intervalMilliseconds: PROCESS_METRICS_INTERVAL_MILLISECONDS,
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
    metricsStatus: "ok",
    serverCpuMillisecondsPerRequest: null,
    serverMemory: {
      loadDeltaPeakRssBytes: null,
      peakDuringLoad: serverMetrics(),
      postSettle: serverMetrics(),
      postWarmup: serverMetrics(),
      retainedRssBytes: null,
      startup: serverMetrics(),
    },
    serverMetrics: serverMetrics(),
  }));
  value.saturation = value.cases.map((benchmarkCase) => {
    const samples = value.config.saturationConnections.map(
      (connections, index) => ({
      connections,
      durationSeconds: DEFAULT_PROTOCOL.saturationDurationSeconds,
      errors: 0,
      latencyP50Ms: 10,
      latencyP95Ms: 20,
      latencyP95Status: "histogram-10us",
      latencyP99Ms: 30,
      loadGenerator: { status: "available" },
      measurementAttempts: 1,
      non2xx: 0,
      requests: 1_000,
      requestsPerSecond: 100 + index * 4,
      serverMetrics: serverMetrics(),
      throughputBytesPerSecond: 1_000_000,
      timeouts: 0,
      }),
    );
    return {
      affinity: { cpuIndex: 0, status: "applied" },
      analysis: analyzeSaturation(samples),
      caseId: benchmarkCase.id,
      samples,
    };
  });
  return value;
}

function setAt(target, path, value) {
  const segments = path.split(".");
  let current = target;
  for (const segment of segments.slice(0, -1)) {
    current[segment] ??= {};
    current = current[segment];
  }
  current[segments.at(-1)] = value;
}

function browserMetrics(index, round) {
  const metrics = {};
  for (const [metricIndex, path] of METRIC_PATHS.entries()) {
    const bytes = path.startsWith("document.")
      || path.startsWith("javascript.") && path.endsWith("Bytes")
      || path.startsWith("memory.");
    const count = path.endsWith("Count");
    const value = bytes
      ? (32 + index + round + metricIndex / 100) * 1024 * 1024
      : 80 + index * 5 + round + metricIndex / 100;
    setAt(
      metrics,
      path,
      availableMetric(
        value,
        bytes ? "bytes" : count ? "count" : "milliseconds",
        "test",
      ),
    );
  }
  return metrics;
}

function browserReport(ssrReport = report()) {
  const browserCases = createBrowserCases();
  const rawRounds = browserCases.flatMap((browserCase, index) =>
    Array.from({ length: 10 }, (_, round) => ({
      appId: browserCase.appId,
      browserVersion: "151.0.0.0",
      fullHydration: {
        atMs: 50,
        framework: browserCase.hydration.framework,
        status: "hydrated",
      },
      headline: false,
      metrics: browserMetrics(index, round),
      navigationTiming: { nextHopProtocol: "h2" },
      order: index,
      paint: {
        finalizedAtMs: 50,
        interactionStartedAtMs: 60,
        label: "pre-interaction LCP",
      },
      processMemory: {
        garbageCollection: {
          completedPasses: 2,
          requestedPasses: 2,
          status: "available",
        },
      },
      productId: browserCase.productId,
      readiness: { clientMode: browserCase.clientMode },
      requestState: {
        itemCount: 100,
        requestTimestamp: "2026-08-25T00:00:00.000000Z",
        status: "validated",
      },
      round,
      route: browserCase.primaryRoute,
      runtime: {
        id: browserCase.sourceCase.runtimeId,
        version: browserCase.sourceCase.runtimeId === "rust"
          ? "native"
          : RUNTIME_PINS.runtimes[browserCase.sourceCase.runtimeId].version,
      },
      status: "ok",
    }))
  );
  return {
    apps: browserCases.map((browserCase) => ({
      appId: browserCase.appId,
      browserOutcome: browserCase.browserOutcome,
      browserTierSsr: browserCase.browserTierSsr,
      clientMode: browserCase.clientMode,
      frameworkVersions: { test: "1.0.0" },
      headline: false,
      hydration: browserCase.hydration,
      id: browserCase.id,
      initialStateSource: browserCase.initialStateSource,
      label: browserCase.label,
      lazyHydration: browserCase.lazyHydration,
      primaryRoute: browserCase.primaryRoute,
      productId: browserCase.productId,
      readinessDefinition: browserCase.readinessDefinition,
      routing: browserCase.routing,
      runtime: {
        id: browserCase.sourceCase.runtimeId,
        version: browserCase.sourceCase.runtimeId === "rust"
          ? "native"
          : RUNTIME_PINS.runtimes[browserCase.sourceCase.runtimeId].version,
      },
      sourceSsrCaseId: browserCase.sourceSsrCaseId,
      tier: BROWSER_TIER,
    })),
    browser: {
      cachePolicy:
        "fresh browser process and context start empty; same-navigation resource reuse remains enabled",
      contextIsolation:
        "fresh foreground Chromium process, context, and page per product round",
      cpuThrottling: "none",
      engine: "chromium",
      headless: false,
      launchArguments: BROWSER_LAUNCH_ARGUMENTS,
      networkThrottling: "none",
      processPerSample: true,
      processWarmup:
        "two unmeasured foreground animation frames before each product navigation",
      transportProtocol: "h2",
      version: "151.0.0.0",
    },
    builds: OFFICIAL_BROWSER_BUILD_IDS.map((id) => ({
      id,
      status: "ok",
    })),
    cleanup: {
      processRegistryEmpty: true,
      status: "verified",
    },
    environment: ssrReport.versions?.webuiDependency === undefined
      ? {}
      : {
        webuiDependency:
          structuredClone(ssrReport.versions.webuiDependency),
      },
    fixture: {
      hash: { ...ssrReport.fixture.hash },
    },
    mode: "official",
    rawRounds,
    roundOrder: Array.from(
      { length: 10 },
      () => browserCases.map(({ productId }) => productId),
    ),
    roundsPerApp: 10,
    ...runtimeEvidence(),
    schema: BROWSER_REPORT_SCHEMA,
    snapshotIntegrity: {
      fixtureHashAfter: ssrReport.fixture.hash.value,
      fixtureHashBefore: ssrReport.fixture.hash.value,
      sharedStateHashAfter: SHARED_STATE_DIGEST,
      sharedStateHashBefore: SHARED_STATE_DIGEST,
      status: "verified",
    },
    sourceRevision: { ...ssrReport.sourceRevision },
    summaries: browserCases.map((browserCase) => ({
      appId: browserCase.appId,
      productId: browserCase.productId,
      ...aggregateAppRounds(
        rawRounds.filter(
          ({ productId }) => productId === browserCase.productId,
        ),
      ),
    })),
    tier: {
      headline: false,
      id: BROWSER_TIER,
    },
    viewport: {
      height: 900,
      width: 1_440,
    },
  };
}

test("exports only the compact homepage benchmark DTO", () => {
  const summary = buildBenchmarkSummary(report());
  assert.deepEqual(Object.keys(summary), ["benchmarks", "benchmarksJson"]);
  assert.equal(summary.benchmarks.rows.length, 16);
  assert.equal(summary.benchmarks.rows[0].rank, "1");
  assert.equal(
    summary.benchmarks.rows.filter(({ primary }) => primary).length,
    6,
  );
  assert.deepEqual(JSON.parse(summary.benchmarksJson), summary.benchmarks);
  assert.equal("rawRounds" in summary, false);
  assert.equal(summary.benchmarks.responseMode, "progressive");
  assert.deepEqual(
    summary.benchmarks.asyncDataBoundary,
    ASYNC_DATA_BOUNDARY_CAPABILITY,
  );
});

test("accepts clean source-checkout evidence with its exact build plans", () => {
  const value = report();
  value.versions = {
    webuiDependency: {
      checkout: "../webui",
      commit: "c".repeat(40),
      kind: "checkout",
      packageArtifacts: null,
      version: "0.0.28",
      workingTreeDirty: false,
    },
  };
  value.builds = OFFICIAL_SOURCE_BUILD_IDS.map((id) => ({ id, status: "ok" }));
  const browser = browserReport(value);
  browser.builds = OFFICIAL_SOURCE_BROWSER_BUILD_IDS.map((id) => ({
    id,
    status: "ok",
  }));
  assert.equal(
    buildBenchmarkSummary(value, browser).benchmarks.rows.length,
    16,
  );

  value.versions.webuiDependency.workingTreeDirty = true;
  assert.throws(
    () => buildBenchmarkSummary(value),
    /clean, complete, unfiltered canonical official report/u,
  );
});

test("labels an explicit complete-suite report and refuses to merge browser evidence into it", () => {
  const value = report();
  setReportResponseMode(value, "complete");
  const summary = buildBenchmarkSummary(value);
  assert.equal(summary.benchmarks.responseMode, "complete");
  assert.equal(summary.benchmarks.asyncDataBoundary, null);
  assert.match(summary.benchmarks.title, /one complete response/u);
  assert.throws(
    () => buildBenchmarkSummary(value, browserReport(value)),
    /Do not merge browser-derived progressive UX evidence/u,
  );
});

test("accepts complete Windows reports with intentional process telemetry gaps", () => {
  const summary = buildBenchmarkSummary(windowsPartialReport());
  assert.equal(summary.benchmarks.rows.length, 16);
  assert.equal(summary.benchmarks.hasUnavailable, false);
  const telemetry =
    summary.benchmarks.rows[0].metrics.requestsPerSecond.serverTelemetry;
  assert.equal(telemetry.available, false);
  assert.equal(telemetry.status, "unavailable");
  assert.equal(
    telemetry.reason,
    WINDOWS_PROCESS_METRICS_UNAVAILABLE_REASON,
  );
  assert.equal(telemetry.peakRssBytes.available, false);
  assert.equal(telemetry.cpuMillisecondsPerRequest.available, false);
});

test("publishes fixed-load saturation warnings without hiding them", () => {
  const value = windowsPartialReport();
  const [entry] = value.saturation;
  entry.samples[1].requestsPerSecond =
    entry.samples[0].requestsPerSecond * 1.2;
  entry.analysis = analyzeSaturation(entry.samples);
  const summary = buildBenchmarkSummary(value);
  assert.equal(entry.analysis.status, "server-unsaturated");
  assert.equal(summary.benchmarks.saturationWarnings.length, 1);
  assert.equal(
    summary.benchmarks.saturationWarnings[0].caseId,
    entry.caseId,
  );
  assert.match(summary.benchmarks.metricSummary, /lower bounds/u);
  assert.match(
    summary.benchmarks.rows.find(({ caseId }) => caseId === entry.caseId)
      .activeDetail,
    /saturation warning/u,
  );
  assert.equal(summary.benchmarks.selectedMetricLabel, "64-connection RPS");
});

test("publishes disclosed fixed-load warnings on non-Windows hosts", () => {
  const value = report();
  value.status = "partial";
  value.machine = {
    osPlatform: "linux",
    processPlatform: "linux",
  };
  const [entry] = value.saturation;
  entry.samples[1].requestsPerSecond =
    entry.samples[0].requestsPerSecond * 1.2;
  entry.analysis = analyzeSaturation(entry.samples);
  const summary = buildBenchmarkSummary(value);
  assert.equal(entry.analysis.status, "server-unsaturated");
  assert.equal(summary.benchmarks.saturationWarnings.length, 1);
});

test("combines matching official browser outcomes", () => {
  const ssrReport = report();
  const summary = buildBenchmarkSummary(ssrReport, browserReport(ssrReport));
  assert.deepEqual(
    summary.benchmarks.metrics.map(({ id }) => id),
    [
      "requestsPerSecond",
      "firstContentfulPaintMs",
      "largestContentfulPaintMs",
      "requestToFullHydrationMs",
      "initialJavascriptBytes",
      "hydrationJavascriptBytes",
      "featureJavascriptBytes",
      "routeJavascriptBytes",
      "routeNavigationMs",
      "jsHeapUsedBytes",
      "rendererPrivateBytes",
    ],
  );
  assert.equal(summary.benchmarks.rows.length, 16);
  assert.equal(
    summary.benchmarks.rows.every(
      (row) => Object.keys(row.metrics).length === 11,
    ),
    true,
  );
});

test("combines complete and progressive throughput with only essential browser metrics", () => {
  const progressive = report();
  const complete = structuredClone(progressive);
  setReportResponseMode(complete, "complete");
  const summary = buildBenchmarkSummary(
    progressive,
    browserReport(progressive),
    complete,
  );
  assert.deepEqual(
    summary.benchmarks.metrics.map(({ id }) => id),
    [
      "noStreamingRequestsPerSecond",
      "streamingRequestsPerSecond",
      "largestContentfulPaintMs",
      "jsHeapUsedBytes",
      "rendererPrivateBytes",
    ],
  );
  assert.equal(summary.benchmarks.selectedMetric, "noStreamingRequestsPerSecond");
  assert.equal(summary.benchmarks.selectedMetricLabel, "No Streaming RPS");
  assert.equal(summary.benchmarks.responseMode, "comparison");
  assert.deepEqual(summary.benchmarks.responseModes, [
    "complete",
    "progressive",
  ]);
  assert.equal(
    summary.benchmarks.rows.every((row) =>
      Object.keys(row.metrics).length === 5
    ),
    true,
  );
  const row = summary.benchmarks.rows[0];
  assert.equal(
    row.metrics.noStreamingRequestsPerSecond.serverTelemetry
      .peakRssBytes.available,
    true,
  );
  assert.equal(
    row.metrics.streamingRequestsPerSecond.serverTelemetry
      .cpuMillisecondsPerRequest.available,
    true,
  );
  assert.equal(
    "serverTelemetry" in row.metrics.rendererPrivateBytes,
    false,
  );
  assert.deepEqual(
    JSON.parse(summary.benchmarksJson),
    summary.benchmarks,
  );

  complete.machine = { cpuModel: "different host" };
  assert.throws(
    () => buildBenchmarkSummary(
      progressive,
      browserReport(progressive),
      complete,
    ),
    /matching progressive and complete official reports/u,
  );
});

test("rejects mismatched or noncanonical browser evidence", async (t) => {
  const scenarios = [
    ["dirty source", (value) => {
      value.sourceRevision.workingTreeDirty = true;
    }],
    ["mismatched fixture", (value) => {
      value.fixture.hash.value = "c".repeat(64);
      value.sourceRevision.sourceDigest = "c".repeat(64);
    }],
    ["headless mode", (value) => {
      value.browser.headless = true;
    }],
    ["CPU throttling", (value) => {
      value.browser.cpuThrottling = "4x";
    }],
    ["missing required build", (value) => {
      value.builds.pop();
    }],
    ["mismatched WebUI dependency", (value) => {
      value.environment.webuiDependency = {
        commit: "d".repeat(40),
        kind: "checkout",
        packageArtifacts: null,
        version: "0.0.28",
        workingTreeDirty: false,
      };
    }],
    ["self-asserted runtime version", (value) => {
      value.runtimeVerification.runtimes[0].expectedVersion = "0.0.0";
      value.runtimeVerification.runtimes[0].version = "0.0.0";
    }],
    ["self-asserted runtime identity", (value) => {
      const productId = "webui-rust-actix";
      const app = value.apps.find((candidate) =>
        candidate.productId === productId
      );
      app.runtime = {
        id: "node",
        version: RUNTIME_PINS.runtimes.node.version,
      };
      for (const round of value.rawRounds.filter((candidate) =>
        candidate.productId === productId
      )) {
        round.runtime = {
          id: "node",
          version: RUNTIME_PINS.runtimes.node.version,
        };
      }
    }],
    ["missing shared-state digest", (value) => {
      delete value.snapshotIntegrity.sharedStateHashBefore;
      delete value.snapshotIntegrity.sharedStateHashAfter;
    }],
    ["wrong FCP units", (value) => {
      for (const round of value.rawRounds) {
        metricAt(round.metrics, "timings.firstContentfulPaintMs").unit =
          "seconds";
      }
      for (const summary of value.summaries) {
        metricAt(summary.metrics, "timings.firstContentfulPaintMs").unit =
          "seconds";
      }
    }],
  ];
  for (const [name, mutate] of scenarios) {
    await t.test(name, () => {
      const ssrReport = report();
      const value = structuredClone(browserReport(ssrReport));
      mutate(value);
      assert.throws(
        () => buildBenchmarkSummary(ssrReport, value),
        /canonical methodology/u,
      );
    });
  }
});

test("refuses dirty or incomplete benchmark evidence", () => {
  const dirty = report();
  dirty.sourceRevision.workingTreeDirty = true;
  assert.throws(
    () => buildBenchmarkSummary(dirty),
    /clean, complete, unfiltered canonical official report/u,
  );
});

test("rejects noncanonical or stale complete reports", async (t) => {
  const scenarios = [
    ["noncanonical duration", (value) => {
      value.config.durationSeconds = 1;
    }],
    ["noncanonical state count", (value) => {
      value.fixture.stateVariants = 1;
    }],
    ["failed build", (value) => {
      value.builds[0].status = "failed";
    }],
    ["missing required build", (value) => {
      value.builds.pop();
    }],
    ["self-asserted runtime version", (value) => {
      value.runtimeVerification.runtimes[0].expectedVersion = "0.0.0";
      value.runtimeVerification.runtimes[0].version = "0.0.0";
    }],
    ["summary not derived from raw rounds", (value) => {
      const requestsPerSecond =
        value.matrix.summaries[0].requestsPerSecond;
      value.matrix.summaries[0].requestsPerSecond = {
        ...requestsPerSecond,
        median: requestsPerSecond.median + 1,
      };
    }],
    ["incomplete saturation evidence", (value) => {
      value.saturation[0].samples = [];
    }],
    ["stale saturation conclusion", (value) => {
      value.saturation[0].samples.at(-1).requestsPerSecond = 5_000;
    }],
    ["unapplied affinity", (value) => {
      value.rawRounds[0].affinity.status = "unavailable";
    }],
    ["nonrandomized order", (value) => {
      value.rawRounds = Array.from(
        { length: DEFAULT_PROTOCOL.rounds },
        (_, round) => value.cases.map((benchmarkCase, orderIndex) =>
          rawRound(benchmarkCase, round, orderIndex)
        ),
      ).flat();
    }],
  ];
  for (const [name, mutate] of scenarios) {
    await t.test(name, () => {
      const value = report();
      mutate(value);
      assert.throws(
        () => buildBenchmarkSummary(value),
        /clean, complete, unfiltered canonical official report/u,
      );
    });
  }
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
    ["unexpected process-metric interval", (value) => {
      value.rawRounds[0].serverMetrics.intervalMilliseconds = 1;
    }],
    ["unexpected process-metric field", (value) => {
      value.rawRounds[0].serverMetrics.detail = "unexpected";
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
    ["stale saturation failure", (value) => {
      value.saturation[0].analysis = {
        ...value.saturation[0].analysis,
        status: "server-unsaturated",
      };
    }],
  ];
  for (const [name, mutate] of scenarios) {
    await t.test(name, () => {
      const value = windowsPartialReport();
      mutate(value);
      assert.throws(
        () => buildBenchmarkSummary(value),
        /partial reports are allowed only for documented process telemetry or disclosed fixed-load saturation warnings/u,
      );
    });
  }
});
