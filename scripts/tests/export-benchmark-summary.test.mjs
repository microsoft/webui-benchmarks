// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import { createCaseMatrix } from "../../todo/runner/lib/cases.mjs";
import {
  WINDOWS_PROCESS_METRICS_UNAVAILABLE_REASON,
} from "../../todo/runner/lib/metrics.mjs";
import {
  BROWSER_REPORT_SCHEMA,
  BROWSER_TIER,
  createBrowserCases,
  frameworkVersionsForApp,
} from "../../todo/browser/apps.mjs";
import {
  METRIC_PATHS,
  aggregateAppRounds,
  availableMetric,
} from "../../todo/browser/metrics.mjs";
import { buildBenchmarkSummary } from "../export-benchmark-summary.mjs";

const WINDOWS_SATURATION_REASON = "Server process metrics were unavailable";
const SSR_BUILD_IDS = Object.freeze([
  "webui",
  "webui-shadowdom",
  "webui-fast",
  "preact",
  "react",
  "solid",
  "vue",
  "state-pool",
  "rust-actix",
  "full-stack-next",
  "full-stack-nuxt",
  "full-stack-sveltekit",
  "full-stack-astro",
]);
const BROWSER_BUILD_IDS = Object.freeze([
  ...SSR_BUILD_IDS.slice(0, 9),
  "tls-material",
  ...SSR_BUILD_IDS.slice(9),
]);

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

function frameworkVersions() {
  return {
    actixWeb: "=4.14.0",
    controlled: {
      "@microsoft/fast-element": "3.0.1",
      "@vue/server-renderer": "3.5.41",
      preact: "10.29.8",
      "preact-render-to-string": "6.7.0",
      react: "19.2.8",
      "react-dom": "19.2.8",
      "solid-js": "1.9.14",
      vue: "3.5.41",
    },
    fullStack: {
      astro: {
        "@astrojs/node": "9.5.1",
        "@astrojs/preact": "4.1.3",
        astro: "5.16.6",
        preact: "10.29.8",
      },
      next: {
        next: "16.3.0",
        react: "19.2.8",
        "react-dom": "19.2.8",
      },
      nuxt: {
        nuxt: "4.2.2",
        vue: "3.5.41",
      },
      sveltekit: {
        "@sveltejs/adapter-node": "5.5.2",
        "@sveltejs/kit": "2.48.5",
        svelte: "5.56.9",
        vite: "7.2.7",
      },
    },
    webui: "0.0.25",
  };
}

function combinedSsrReport() {
  const value = report();
  value.builds = SSR_BUILD_IDS.map((id) => ({ id, status: "ok" }));
  value.fixture.hash.files = ["todo/shared/state.mjs"];
  value.versions = {
    frameworks: frameworkVersions(),
    runtimes: {
      bun: {
        expected: "1.3.14",
        observed: "1.3.14",
        versionMatches: true,
      },
      deno: {
        expected: "2.9.5",
        observed: "2.9.5",
        versionMatches: true,
      },
      node: {
        expected: "22.23.1",
        observed: "22.23.1",
        versionMatches: true,
      },
    },
    tools: {
      cargo: "cargo 1.98.0",
      node: "v22.23.1",
      rustc: "rustc 1.98.0",
    },
    webuiDependency: {
      cargo: "=0.0.25",
      kind: "release",
      npm: "0.0.25",
      version: "0.0.25",
    },
  };
  return value;
}

function setAt(target, path, value) {
  const segments = path.split(".");
  let current = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    current[segments[index]] ??= {};
    current = current[segments[index]];
  }
  current[segments.at(-1)] = value;
}

function metricUnit(path) {
  if (
    path.endsWith("Bytes")
    || path.includes("memory.")
    || path.includes("responseBytes")
  ) {
    return "bytes";
  }
  if (
    path.endsWith("Count")
    || path.includes("Count")
  ) {
    return "count";
  }
  return "milliseconds";
}

function rawBrowserMetrics(caseIndex, round) {
  const metrics = {};
  for (const [metricIndex, path] of METRIC_PATHS.entries()) {
    let value = 10 + caseIndex + round + metricIndex / 100;
    if (path === "timings.firstContentfulPaintMs") {
      value = 80 + caseIndex * 3 + round;
    } else if (path === "timings.largestContentfulPaintMs") {
      value = 100 + caseIndex * 4 + round;
    } else if (path === "memory.jsHeapUsedBytes") {
      value = 2_000_000 + caseIndex * 100_000 + round * 1_000;
    } else if (path === "memory.rendererPrivateBytes") {
      value = 40_000_000 + caseIndex * 1_000_000 + round * 10_000;
    }
    setAt(
      metrics,
      path,
      availableMetric(value, metricUnit(path), "synthetic browser fixture"),
    );
  }
  metrics.interactions.evidence = {
    completedBeforeClear: 26,
    initialCompleted: 25,
    initialPending: 75,
    remainingAfterClear: 74,
    selectedSentinel: "todo-0050",
    totalBeforeClear: 100,
  };
  return metrics;
}

function requestTimestamp(index) {
  const value = new Date(Date.UTC(2026, 7, 25, 0, 10, index));
  return value.toISOString().replace("Z", "000Z");
}

function browserRuntimeVersion(ssrReport, runtimeId) {
  return runtimeId === "rust"
    ? "native"
    : ssrReport.versions.runtimes[runtimeId].observed;
}

function browserReport(ssrReport) {
  const browserCases = createBrowserCases();
  const apps = browserCases.map((browserCase) => ({
    appId: browserCase.appId,
    browserOutcome: browserCase.browserOutcome,
    browserTierSsr: browserCase.browserTierSsr,
    clientMode: browserCase.clientMode,
    frameworkVersions: frameworkVersionsForApp(
      browserCase.appId,
      ssrReport.versions.frameworks,
    ),
    headline: false,
    hydration: browserCase.hydration,
    id: browserCase.id,
    initialStateSource: browserCase.initialStateSource,
    label: browserCase.label,
    lazyHydration: browserCase.lazyHydration,
    primaryRoute: browserCase.primaryRoute,
    productId: browserCase.productId,
    readinessDefinition: browserCase.readinessDefinition,
    runtime: {
      id: browserCase.sourceCase.runtimeId,
      version: browserRuntimeVersion(
        ssrReport,
        browserCase.sourceCase.runtimeId,
      ),
    },
    sourceSsrCaseId: browserCase.sourceSsrCaseId,
    tier: BROWSER_TIER,
  }));
  const rawRounds = [];
  const roundOrder = [];
  for (let round = 0; round < 7; round += 1) {
    roundOrder.push(browserCases.map(({ productId }) => productId));
    for (const [order, browserCase] of browserCases.entries()) {
      const index = round * browserCases.length + order;
      const runtimeId = browserCase.sourceCase.runtimeId;
      rawRounds.push({
        appId: browserCase.appId,
        browserVersion: "149.0.7827.55",
        diagnostics: [],
        fullHydration: {
          atMs: 50 + order,
          framework: browserCase.hydration.framework,
          status: "hydrated",
        },
        headline: false,
        metrics: rawBrowserMetrics(order, round),
        navigationTiming: {
          nextHopProtocol: "h2",
          requestStartMs: 1,
          responseEndMs: 2,
          responseStartMs: 1.5,
          serverTiming: {},
        },
        order,
        paint: {
          finalizedAtMs: 30,
          interactionStartedAtMs: 31,
          label: "pre-interaction LCP",
        },
        processMemory: {
          garbageCollection: {
            completedPasses: 3,
            reason: null,
            requestedPasses: 3,
            status: "available",
          },
        },
        productId: browserCase.productId,
        readiness: {
          clientMode: browserCase.clientMode,
          hydration: { status: "supported" },
          readyAtMs: 40,
          status: "ready",
        },
        requestState: {
          itemCount: 100,
          requestTimestamp: requestTimestamp(index),
          status: "validated",
        },
        round,
        route: "dynamic",
        runtime: {
          id: runtimeId,
          version: browserRuntimeVersion(ssrReport, runtimeId),
        },
        semanticValidation: browserCase.appId === "solid"
          ? { status: "validated", variantId: "variant-01", variantIndex: 0 }
          : { status: "not-applicable" },
        server: {
          command: "C:\\raw-host\\server.exe --secret-output",
          workerCount: 1,
        },
        status: "ok",
      });
    }
  }
  const summaries = apps.map((app) => ({
    appId: app.appId,
    productId: app.productId,
    ...aggregateAppRounds(
      rawRounds.filter(({ productId }) => productId === app.productId),
    ),
  }));
  const runtimeVerification = {
    mode: "official",
    runtimes: ["node", "bun", "deno"].map((runtimeId) => {
      const version = ssrReport.versions.runtimes[runtimeId].observed;
      return {
        expectedVersion: version,
        installed: true,
        required: true,
        runtimeId,
        status: "available",
        version,
        versionMatches: true,
      };
    }),
    schema: "webui.ssr-todo-runtime-pins/v1",
    status: "ok",
  };
  return {
    apps,
    browser: {
      cachePolicy:
        "fresh browser process and context start empty; same-navigation resource reuse remains enabled",
      contextIsolation:
        "fresh foreground Chromium process, context, and page per product round",
      cpuThrottling: "none",
      engine: "chromium",
      headless: false,
      launchArguments: [
        "--disable-features=CalculateNativeWinOcclusion",
        "--enable-precise-memory-info",
        "--process-per-tab",
      ],
      networkThrottling: "none",
      processPerSample: true,
      transportProtocol: "h2",
      version: "149.0.7827.55",
    },
    builds: BROWSER_BUILD_IDS.map((id) => ({ id, status: "ok" })),
    cleanup: { processRegistryEmpty: true, status: "verified" },
    createdAt: "2026-08-25T00:30:00.000Z",
    environment: {
      machine: { hostname: "raw-browser-host" },
      tools: structuredClone(ssrReport.versions.tools),
    },
    fixture: { hash: structuredClone(ssrReport.fixture.hash) },
    mode: "official",
    rawRounds,
    roundOrder,
    roundsPerApp: 7,
    runtimePolicy: { status: "ok" },
    runtimeVerification,
    schema: BROWSER_REPORT_SCHEMA,
    seed: "webui-ssr-todo-browser-outcomes",
    snapshotIntegrity: {
      fixtureHashAfter: ssrReport.fixture.hash.value,
      fixtureHashBefore: ssrReport.fixture.hash.value,
      sharedStateHashAfter: "c".repeat(64),
      sharedStateHashBefore: "c".repeat(64),
      status: "verified",
    },
    sourceRevision: structuredClone(ssrReport.sourceRevision),
    summaries,
    tier: {
      headline: false,
      id: BROWSER_TIER,
      statement: "Secondary browser outcomes only.",
    },
    viewport: { height: 900, width: 1_440 },
  };
}

function combinedReports() {
  const ssr = combinedSsrReport();
  return { browser: browserReport(ssr), ssr };
}

function replaceSummary(browser, productId) {
  const index = browser.summaries.findIndex(
    (summary) => summary.productId === productId,
  );
  const rounds = browser.rawRounds.filter(
    (round) => round.productId === productId,
  );
  browser.summaries[index] = {
    appId: browser.summaries[index].appId,
    productId,
    ...aggregateAppRounds(rounds),
  };
}

function makeMetricUnavailable(browser, productId, path) {
  for (const round of browser.rawRounds) {
    if (round.productId === productId) {
      setAt(round.metrics, path, {
        reason: "The platform does not expose this metric",
        source: "synthetic browser fixture",
        status: "unavailable",
        unit: metricUnit(path),
      });
    }
  }
  replaceSummary(browser, productId);
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

test("exports a combined fourteen-row five-metric homepage DTO", () => {
  const { browser, ssr } = combinedReports();
  const summary = buildBenchmarkSummary(ssr, browser);
  assert.deepEqual(Object.keys(summary), ["benchmarks", "benchmarksJson"]);
  assert.deepEqual(
    summary.benchmarks.metrics.map(({ id }) => id),
    [
      "requestsPerSecond",
      "firstContentfulPaintMs",
      "largestContentfulPaintMs",
      "jsHeapUsedBytes",
      "rendererPrivateBytes",
    ],
  );
  assert.equal(summary.benchmarks.rows.length, 14);
  assert.ok(
    summary.benchmarks.rows.some(
      ({ caseId }) => caseId === "webui-fast-rust-actix",
    ),
  );
  assert.equal(
    summary.benchmarks.rows.every(
      ({ metrics }) => Object.keys(metrics).length === 5,
    ),
    true,
  );
  assert.equal(
    summary.benchmarks.rows.find(
      ({ caseId }) => caseId === "webui-fast-rust-actix",
    ).primary,
    true,
  );
  assert.deepEqual(JSON.parse(summary.benchmarksJson), summary.benchmarks);
  assert.match(summary.benchmarks.description, /without collapsing/u);
  assert.match(
    summary.benchmarks.metrics[1].methodology,
    /Chromium 149\.0\.7827\.55/u,
  );
});

test("rejects mismatched source, digest, and fixture identities", async (t) => {
  const scenarios = [
    ["source commit", (browser) => {
      browser.sourceRevision.commit = "c".repeat(40);
    }],
    ["source digest", (browser) => {
      const digest = "d".repeat(64);
      browser.sourceRevision.sourceDigest = digest;
      browser.fixture.hash.value = digest;
      browser.snapshotIntegrity.fixtureHashBefore = digest;
      browser.snapshotIntegrity.fixtureHashAfter = digest;
    }],
    ["fixture files", (browser) => {
      browser.fixture.hash.files.push("todo/shared/unmatched.mjs");
    }],
  ];
  for (const [name, mutate] of scenarios) {
    await t.test(name, () => {
      const { browser, ssr } = combinedReports();
      mutate(browser);
      assert.throws(
        () => buildBenchmarkSummary(ssr, browser),
        /source commits|source digests|fixture file identities/u,
      );
    });
  }
});

test("rejects incomplete builds and mismatched tool or runtime versions", async (t) => {
  const scenarios = [
    ["SSR builds", ({ ssr }) => {
      ssr.builds.pop();
    }],
    ["browser builds", ({ browser }) => {
      browser.builds.pop();
    }],
    ["build tools", ({ browser }) => {
      browser.environment.tools.node = "v22.23.2";
    }],
    ["framework version", ({ browser }) => {
      const react = browser.apps.find(({ productId }) => productId === "react");
      react.frameworkVersions = {
        ...react.frameworkVersions,
        react: "19.2.7",
      };
    }],
    ["runtime version", ({ browser }) => {
      const node = browser.runtimeVerification.runtimes.find(
        ({ runtimeId }) => runtimeId === "node",
      );
      node.version = "22.23.2";
    }],
  ];
  for (const [name, mutate] of scenarios) {
    await t.test(name, () => {
      const reports = combinedReports();
      mutate(reports);
      assert.throws(
        () => buildBenchmarkSummary(reports.ssr, reports.browser),
        /build.*evidence|build tool versions|framework versions|runtime version/u,
      );
    });
  }
});

test("rejects noncanonical SSR and browser order or membership", async (t) => {
  const scenarios = [
    ["SSR order", ({ ssr }) => {
      [ssr.cases[0], ssr.cases[1]] = [ssr.cases[1], ssr.cases[0]];
    }],
    ["browser app order", ({ browser }) => {
      [browser.apps[0], browser.apps[1]] = [
        browser.apps[1],
        browser.apps[0],
      ];
    }],
    ["browser summary order", ({ browser }) => {
      [browser.summaries[0], browser.summaries[1]] = [
        browser.summaries[1],
        browser.summaries[0],
      ];
    }],
    ["browser membership", ({ browser }) => {
      browser.apps.pop();
    }],
  ];
  for (const [name, mutate] of scenarios) {
    await t.test(name, () => {
      const reports = combinedReports();
      mutate(reports);
      assert.throws(
        () => buildBenchmarkSummary(reports.ssr, reports.browser),
        /official report|complete ordered product matrix|ordered seven-round official browser evidence|summaries must reference/u,
      );
    });
  }
});

test("rejects incomplete and duplicate browser rounds", async (t) => {
  await t.test("missing round", () => {
    const { browser, ssr } = combinedReports();
    browser.rawRounds.pop();
    assert.throws(
      () => buildBenchmarkSummary(ssr, browser),
      /exactly 7 raw rounds|aggregate samples must match/u,
    );
  });
  await t.test("duplicate round", () => {
    const { browser, ssr } = combinedReports();
    browser.rawRounds[1] = structuredClone(browser.rawRounds[0]);
    assert.throws(
      () => buildBenchmarkSummary(ssr, browser),
      /duplicates|exactly 7 raw rounds/u,
    );
  });
});

test("rejects dirty, quick, and filtered browser evidence", async (t) => {
  const scenarios = [
    ["dirty", (browser) => {
      browser.sourceRevision.workingTreeDirty = true;
    }],
    ["quick", (browser) => {
      browser.mode = "quick";
    }],
    ["filtered", (browser) => {
      browser.apps.pop();
      browser.summaries.pop();
      const removed = browser.roundOrder[0].at(-1);
      browser.rawRounds = browser.rawRounds.filter(
        ({ productId }) => productId !== removed,
      );
      browser.roundOrder = browser.roundOrder.map((order) => order.slice(0, -1));
    }],
  ];
  for (const [name, mutate] of scenarios) {
    await t.test(name, () => {
      const { browser, ssr } = combinedReports();
      mutate(browser);
      assert.throws(
        () => buildBenchmarkSummary(ssr, browser),
        /official|ordered product matrix|source snapshot|quick mode/u,
      );
    });
  }
});

test("rejects failed hydration, interaction, semantic, or freshness gates", async (t) => {
  const scenarios = [
    ["hydration", (browser) => {
      browser.rawRounds[0].readiness.status = "error";
    }],
    ["interaction", (browser) => {
      browser.rawRounds[0].metrics.interactions.evidence.selectedSentinel =
        "todo-0001";
    }],
    ["semantic", (browser) => {
      const round = browser.rawRounds.find(({ productId }) =>
        productId === "solid"
      );
      round.semanticValidation.status = "failed";
    }],
    ["request freshness", (browser) => {
      browser.rawRounds[0].requestState.requestTimestamp =
        "2026-08-20T00:00:00.000000Z";
    }],
    ["capture freshness", (browser) => {
      browser.createdAt = "2026-08-27T01:00:00.000Z";
    }],
  ];
  for (const [name, mutate] of scenarios) {
    await t.test(name, () => {
      const { browser, ssr } = combinedReports();
      mutate(browser);
      assert.throws(
        () => buildBenchmarkSummary(ssr, browser),
        /hydration and readiness|interaction evidence|semantic validation|fresh request state|within 24 hours/u,
      );
    });
  }
});

test("rejects malformed, non-finite, and wrong-unit browser metrics", async (t) => {
  await t.test("non-finite raw metric", () => {
    const { browser, ssr } = combinedReports();
    const metric =
      browser.rawRounds[0].metrics.timings.firstContentfulPaintMs;
    browser.rawRounds[0].metrics.timings.firstContentfulPaintMs = {
      ...metric,
      value: Number.NaN,
    };
    assert.throws(
      () => buildBenchmarkSummary(ssr, browser),
      /available value must be finite|aggregate samples must match/u,
    );
  });
  await t.test("non-finite aggregate metric", () => {
    const { browser, ssr } = combinedReports();
    const metric =
      browser.summaries[0].metrics.timings.firstContentfulPaintMs;
    browser.summaries[0].metrics.timings.firstContentfulPaintMs = {
      ...metric,
      statistics: {
        ...metric.statistics,
        median: Number.POSITIVE_INFINITY,
      },
    };
    assert.throws(
      () => buildBenchmarkSummary(ssr, browser),
      /seven finite official samples/u,
    );
  });
  await t.test("wrong publication unit", () => {
    const { browser, ssr } = combinedReports();
    for (const round of browser.rawRounds) {
      round.metrics.timings.firstContentfulPaintMs = {
        ...round.metrics.timings.firstContentfulPaintMs,
        unit: "seconds",
      };
    }
    for (const summary of browser.summaries) {
      summary.metrics.timings.firstContentfulPaintMs = {
        ...summary.metrics.timings.firstContentfulPaintMs,
        unit: "seconds",
      };
    }
    assert.throws(
      () => buildBenchmarkSummary(ssr, browser),
      /seven finite official samples/u,
    );
  });
});

test("preserves explicit unavailable browser metrics without a zero value", () => {
  const { browser, ssr } = combinedReports();
  makeMetricUnavailable(
    browser,
    "webui-fast-rust-actix",
    "memory.rendererPrivateBytes",
  );
  const summary = buildBenchmarkSummary(ssr, browser);
  const fast = summary.benchmarks.rows.find(
    ({ caseId }) => caseId === "webui-fast-rust-actix",
  );
  assert.deepEqual(fast.metrics.rendererPrivateBytes, {
    available: false,
    detail: "Unavailable across all 7 isolated runs",
    value: null,
    valueDisplay: "Unavailable",
  });
  assert.notEqual(fast.metrics.rendererPrivateBytes.value, 0);
  assert.match(
    summary.benchmarks.metrics.find(
      ({ id }) => id === "rendererPrivateBytes",
    ).summary,
    /1 row reports this metric as unavailable/u,
  );
});

test("excludes raw machine, process, and evidence metadata", () => {
  const { browser, ssr } = combinedReports();
  ssr.machine = { hostname: "forbidden-ssr-host" };
  browser.environment.machine.hostname = "forbidden-browser-host";
  browser.rawRounds[0].diagnostics = ["forbidden-process-output"];
  browser.rawRounds[0].server.command = "C:\\forbidden\\raw-server.exe";
  const summary = buildBenchmarkSummary(ssr, browser);
  const serialized = JSON.stringify(summary);
  for (
    const forbidden of [
      "forbidden-ssr-host",
      "forbidden-browser-host",
      "forbidden-process-output",
      "raw-server.exe",
      "rawRounds",
      "sourceRevision",
      "requestTimestamp",
    ]
  ) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("keeps SSR-only export behavior compatible", () => {
  const summary = buildBenchmarkSummary(report());
  assert.deepEqual(
    summary.benchmarks.metrics.map(({ id }) => id),
    ["requestsPerSecond"],
  );
  assert.equal(
    Object.keys(summary.benchmarks.rows[0].metrics).length,
    1,
  );
  assert.equal(
    summary.benchmarks.description,
    "Compare the complete product matrix by single-core server throughput.",
  );
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
