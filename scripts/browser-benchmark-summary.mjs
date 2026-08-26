// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { isDeepStrictEqual } from "node:util";
import {
  BROWSER_REPORT_SCHEMA,
  OFFICIAL_MINIMUM_ROUNDS,
  PRODUCT_ORDER,
  frameworkVersionsForApp,
} from "../todo/browser/apps.mjs";
import { metricAt } from "../todo/browser/metrics.mjs";
import { validateBrowserReport } from "../todo/browser/schema.mjs";
import { createCaseMatrix } from "../todo/runner/lib/cases.mjs";

const MEBIBYTE = 1_048_576;
const MAX_CAPTURE_PAIR_AGE_MS = 24 * 60 * 60 * 1_000;
const MAX_REQUEST_AGE_MS = 24 * 60 * 60 * 1_000;
const FUTURE_TIMESTAMP_TOLERANCE_MS = 60 * 1_000;
const INTERACTION_STEPS = Object.freeze([
  "filterPendingMs",
  "filterCompletedMs",
  "filterAllMs",
  "selectSentinelMs",
  "toggleCompletionMs",
  "clearCompletedMs",
]);
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
const RUNTIME_IDS = Object.freeze(["node", "bun", "deno"]);
const officialCases = createCaseMatrix();
const officialCasesById = new Map(
  officialCases.map((benchmarkCase) => [benchmarkCase.id, benchmarkCase]),
);

const PUBLICATION_METRICS = Object.freeze([
  Object.freeze({
    description:
      "First contentful paint from navigation start across seven isolated Chromium runs.",
    direction: "lower",
    directionLabel: "lower is better",
    id: "firstContentfulPaintMs",
    label: "FCP",
    path: "timings.firstContentfulPaintMs",
    sourceUnit: "milliseconds",
    unit: "ms",
    valueKind: "milliseconds",
  }),
  Object.freeze({
    description:
      "Pre-interaction largest contentful paint from navigation start across seven isolated Chromium runs.",
    direction: "lower",
    directionLabel: "lower is better",
    id: "largestContentfulPaintMs",
    label: "LCP",
    path: "timings.largestContentfulPaintMs",
    sourceUnit: "milliseconds",
    unit: "ms",
    valueKind: "milliseconds",
  }),
  Object.freeze({
    description:
      "Post-readiness JavaScript heap used after an explicit Chromium garbage collection.",
    direction: "lower",
    directionLabel: "lower is better",
    id: "jsHeapUsedBytes",
    label: "JS Heap",
    path: "memory.jsHeapUsedBytes",
    sourceUnit: "bytes",
    unit: "MiB",
    valueKind: "bytes",
  }),
  Object.freeze({
    description:
      "Private bytes attributed to the isolated Chromium renderer process after readiness.",
    direction: "lower",
    directionLabel: "lower is better",
    id: "rendererPrivateBytes",
    label: "Renderer Private MB",
    path: "memory.rendererPrivateBytes",
    sourceUnit: "bytes",
    unit: "MiB",
    valueKind: "bytes",
  }),
]);

function fail(message) {
  throw new Error(`Combined summary export requires ${message}`);
}

function formatNumber(value) {
  const [whole, fraction] = value.toFixed(2).replace(/\.?0+$/u, "").split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = sign ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return fraction === undefined
    ? `${sign}${grouped}`
    : `${sign}${grouped}.${fraction}`;
}

function formatMebibytes(bytes) {
  const value = bytes / MEBIBYTE;
  const display = formatNumber(value);
  return bytes > 0 && display === "0" ? "<0.01" : display;
}

function formatMetricValue(metric, value) {
  return metric.valueKind === "bytes"
    ? formatMebibytes(value)
    : formatNumber(value);
}

function formatMetricAmount(metric, value) {
  return `${formatMetricValue(metric, value)} ${metric.unit}`;
}

function hasOrderedIds(values, expectedIds, selectId) {
  return Array.isArray(values)
    && values.length === expectedIds.length
    && values.every((value, index) => selectId(value) === expectedIds[index]);
}

function hasSuccessfulBuilds(builds, expectedIds) {
  return hasOrderedIds(builds, expectedIds, (build) => build?.id)
    && builds.every((build) => build.status === "ok");
}

function parseTimestamp(value, path) {
  if (typeof value !== "string") {
    fail(`${path} to be an ISO timestamp`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    fail(`${path} to be an ISO timestamp`);
  }
  return timestamp;
}

function assertSourceIdentity(ssrReport, browserReport) {
  if (
    browserReport.sourceRevision?.commit
      !== ssrReport.sourceRevision?.commit
  ) {
    fail("the SSR and browser source commits to match exactly");
  }
  if (
    browserReport.sourceRevision?.sourceDigest
      !== ssrReport.sourceRevision?.sourceDigest
  ) {
    fail("the SSR and browser source digests to match exactly");
  }
  if (browserReport.fixture?.hash?.value !== ssrReport.fixture?.hash?.value) {
    fail("the SSR and browser fixture hashes to match exactly");
  }
  if (
    !isDeepStrictEqual(
      browserReport.fixture?.hash?.files,
      ssrReport.fixture?.hash?.files,
    )
  ) {
    fail("the SSR and browser fixture file identities to match exactly");
  }
}

function assertCaptureFreshness(ssrReport, browserReport) {
  const ssrCreatedAt = parseTimestamp(ssrReport.createdAt, "SSR createdAt");
  const browserCreatedAt = parseTimestamp(
    browserReport.createdAt,
    "browser createdAt",
  );
  const pairAge = browserCreatedAt - ssrCreatedAt;
  if (pairAge < 0 || pairAge > MAX_CAPTURE_PAIR_AGE_MS) {
    fail(
      "the browser capture to follow the matching SSR capture within 24 hours",
    );
  }
  return browserCreatedAt;
}

function expectedRuntimeVersion(ssrReport, runtimeId) {
  if (runtimeId === "rust") {
    return "native";
  }
  const runtime = ssrReport.versions?.runtimes?.[runtimeId];
  if (
    runtime?.versionMatches !== true
    || typeof runtime.observed !== "string"
    || runtime.observed.length === 0
    || runtime.expected !== runtime.observed
  ) {
    fail(`verified ${runtimeId} version evidence in the SSR report`);
  }
  return runtime.observed;
}

function assertVersionsMatch(ssrReport, browserReport) {
  if (
    !isDeepStrictEqual(
      browserReport.environment?.tools,
      ssrReport.versions?.tools,
    )
  ) {
    fail("the SSR and browser build tool versions to match exactly");
  }
  const verification = browserReport.runtimeVerification;
  if (
    verification?.schema !== "webui.ssr-todo-runtime-pins/v1"
    || verification.mode !== "official"
    || verification.status !== "ok"
    || !hasOrderedIds(
      verification.runtimes,
      RUNTIME_IDS,
      (runtime) => runtime?.runtimeId,
    )
  ) {
    fail("complete pinned browser runtime verification");
  }
  for (const runtime of verification.runtimes) {
    const expected = expectedRuntimeVersion(ssrReport, runtime.runtimeId);
    if (
      runtime.status !== "available"
      || runtime.installed !== true
      || runtime.required !== true
      || runtime.versionMatches !== true
      || runtime.expectedVersion !== expected
      || runtime.version !== expected
    ) {
      fail(`${runtime.runtimeId} to match the verified SSR runtime version`);
    }
  }
  for (const app of browserReport.apps) {
    const benchmarkCase = officialCasesById.get(app.productId);
    if (benchmarkCase === undefined) {
      fail(`known browser product '${app.productId}'`);
    }
    const expectedFrameworks = frameworkVersionsForApp(
      benchmarkCase.appId,
      ssrReport.versions?.frameworks,
    );
    if (!isDeepStrictEqual(app.frameworkVersions, expectedFrameworks)) {
      fail(`${app.productId} framework versions to match the SSR report`);
    }
    const runtimeVersion = expectedRuntimeVersion(
      ssrReport,
      benchmarkCase.runtimeId,
    );
    if (
      app.runtime?.id !== benchmarkCase.runtimeId
      || app.runtime.version !== runtimeVersion
    ) {
      fail(`${app.productId} runtime identity to match the SSR report`);
    }
  }
}

function assertBrowserContract(browserReport) {
  if (
    browserReport.mode !== "official"
    || browserReport.roundsPerApp !== OFFICIAL_MINIMUM_ROUNDS
    || browserReport.sourceRevision?.workingTreeDirty !== false
    || !hasOrderedIds(
      browserReport.apps,
      PRODUCT_ORDER,
      (app) => app?.productId,
    )
    || !hasOrderedIds(
      browserReport.summaries,
      PRODUCT_ORDER,
      (summary) => summary?.productId,
    )
  ) {
    fail(
      "clean, unfiltered, ordered seven-round official browser evidence",
    );
  }
  if (
    !hasSuccessfulBuilds(browserReport.builds, BROWSER_BUILD_IDS)
    || browserReport.cleanup?.status !== "verified"
    || browserReport.cleanup.processRegistryEmpty !== true
  ) {
    fail("complete successful browser build and cleanup evidence");
  }
  const browser = browserReport.browser;
  if (
    browser?.engine !== "chromium"
    || typeof browser.version !== "string"
    || browser.version.length === 0
    || browser.transportProtocol !== "h2"
    || browser.processPerSample !== true
    || typeof browser.headless !== "boolean"
    || browser.cpuThrottling !== "none"
    || browser.networkThrottling !== "none"
    || !Array.isArray(browser.launchArguments)
    || !browser.launchArguments.includes(
      "--disable-features=CalculateNativeWinOcclusion",
    )
    || !browser.launchArguments.includes("--enable-precise-memory-info")
    || !browser.launchArguments.includes("--process-per-tab")
    || browserReport.viewport?.width !== 1_440
    || browserReport.viewport?.height !== 900
  ) {
    fail("the official isolated Chromium runtime contract");
  }
  const snapshot = browserReport.snapshotIntegrity;
  if (
    snapshot?.status !== "verified"
    || snapshot.fixtureHashBefore !== browserReport.fixture?.hash?.value
    || snapshot.fixtureHashAfter !== browserReport.fixture?.hash?.value
    || typeof snapshot.sharedStateHashBefore !== "string"
    || snapshot.sharedStateHashBefore.length !== 64
    || snapshot.sharedStateHashAfter !== snapshot.sharedStateHashBefore
  ) {
    fail("verified unchanged browser fixture and shared-state snapshots");
  }
  for (const app of browserReport.apps) {
    const benchmarkCase = officialCasesById.get(app.productId);
    if (
      app.id !== `browser:${app.productId}`
      || app.label !== benchmarkCase?.label
      || app.sourceSsrCaseId !== app.productId
      || app.appId !== benchmarkCase?.appId
      || app.browserOutcome?.status !== "supported"
      || app.hydration?.status !== "supported"
    ) {
      fail(`${app.productId} to declare supported canonical hydration`);
    }
  }
}

function hasAvailableMetric(metric, unit) {
  return metric?.status === "available"
    && metric.unit === unit
    && Number.isFinite(metric.value);
}

function assertInteractionEvidence(round) {
  const interactions = round.metrics?.interactions;
  if (
    !hasAvailableMetric(interactions?.totalDurationMs, "milliseconds")
    || INTERACTION_STEPS.some((step) =>
      !hasAvailableMetric(interactions?.steps?.[step], "milliseconds")
    )
  ) {
    fail(`${round.productId} round ${round.round} interaction timings`);
  }
  const evidence = interactions.evidence;
  if (
    evidence?.initialCompleted !== 25
    || evidence.initialPending !== 75
    || evidence.totalBeforeClear !== 100
    || evidence.completedBeforeClear !== 26
    || evidence.remainingAfterClear !== 74
    || evidence.selectedSentinel !== "todo-0050"
  ) {
    fail(`${round.productId} round ${round.round} interaction evidence`);
  }
}

function assertRoundGates(browserReport, browserCreatedAt) {
  const appByProductId = new Map(
    browserReport.apps.map((app) => [app.productId, app]),
  );
  const requestTimestamps = new Set();
  for (const round of browserReport.rawRounds) {
    const app = appByProductId.get(round.productId);
    const benchmarkCase = officialCasesById.get(round.productId);
    const expectedAtOrder =
      browserReport.roundOrder?.[round.round]?.[round.order];
    if (
      round.status !== "ok"
      || app === undefined
      || benchmarkCase === undefined
      || round.appId !== app.appId
      || round.browserVersion !== browserReport.browser.version
      || expectedAtOrder !== round.productId
      || round.runtime?.id !== app.runtime.id
      || round.runtime.version !== app.runtime.version
    ) {
      fail(`${round.productId} round ${round.round} canonical identity`);
    }
    if (
      round.readiness?.status !== "ready"
      || round.readiness.clientMode !== app.clientMode
      || !["supported", "deferred"].includes(
        round.readiness.hydration?.status,
      )
      || !Number.isFinite(round.readiness.readyAtMs)
      || round.fullHydration?.status !== "hydrated"
      || !Number.isFinite(round.fullHydration.atMs)
      || typeof round.fullHydration.framework !== "string"
      || round.fullHydration.framework.length === 0
      || !hasAvailableMetric(
        round.metrics?.timings?.requestToFullHydrationMs,
        "milliseconds",
      )
    ) {
      fail(`${round.productId} round ${round.round} hydration and readiness`);
    }
    const semanticStatus = round.semanticValidation?.status;
    if (
      (benchmarkCase.appId === "solid" && semanticStatus !== "validated")
      || (
        benchmarkCase.appId !== "solid"
        && !["not-applicable", "validated"].includes(semanticStatus)
      )
    ) {
      fail(`${round.productId} round ${round.round} semantic validation`);
    }
    assertInteractionEvidence(round);
    const requestTimestamp = parseTimestamp(
      round.requestState?.requestTimestamp,
      `${round.productId} round ${round.round} request timestamp`,
    );
    if (
      round.requestState?.status !== "validated"
      || round.requestState.itemCount !== 100
      || requestTimestamps.has(round.requestState.requestTimestamp)
      || requestTimestamp > browserCreatedAt + FUTURE_TIMESTAMP_TOLERANCE_MS
      || browserCreatedAt - requestTimestamp > MAX_REQUEST_AGE_MS
    ) {
      fail(`${round.productId} round ${round.round} fresh request state`);
    }
    requestTimestamps.add(round.requestState.requestTimestamp);
  }
}

function assertPublicationMetrics(browserReport) {
  for (const definition of PUBLICATION_METRICS) {
    let availableRows = 0;
    for (const summary of browserReport.summaries) {
      const metric = metricAt(summary.metrics, definition.path);
      if (metric?.status === "available") {
        const statistics = metric.statistics;
        if (
          metric.unit !== definition.sourceUnit
          || metric.availableSamples !== OFFICIAL_MINIMUM_ROUNDS
          || metric.unavailableSamples !== 0
          || statistics?.count !== OFFICIAL_MINIMUM_ROUNDS
          || !Number.isFinite(statistics.median)
          || statistics.median <= 0
          || !Number.isFinite(statistics.mad)
          || statistics.mad < 0
          || !Number.isFinite(statistics.p95)
          || statistics.p95 <= 0
        ) {
          fail(
            `${summary.productId} ${definition.id} to contain seven finite official samples`,
          );
        }
        availableRows += 1;
      } else if (
        metric?.status !== "unavailable"
        || metric.availableSamples !== 0
        || metric.unavailableSamples !== OFFICIAL_MINIMUM_ROUNDS
        || !Array.isArray(metric.reasons)
        || metric.reasons.length === 0
      ) {
        fail(
          `${summary.productId} ${definition.id} to be explicitly unavailable`,
        );
      }
    }
    if (availableRows === 0) {
      fail(`at least one available ${definition.id} row`);
    }
  }
}

export function assertCombinedBrowserReport(ssrReport, browserReport) {
  const validation = validateBrowserReport(browserReport);
  if (!validation.valid) {
    throw new Error(
      `Combined summary export requires a valid ${BROWSER_REPORT_SCHEMA} report:\n${validation.errors.join("\n")}`,
    );
  }
  if (!hasSuccessfulBuilds(ssrReport.builds, SSR_BUILD_IDS)) {
    fail("complete successful SSR build evidence");
  }
  assertBrowserContract(browserReport);
  assertSourceIdentity(ssrReport, browserReport);
  assertVersionsMatch(ssrReport, browserReport);
  const browserCreatedAt = assertCaptureFreshness(ssrReport, browserReport);
  assertRoundGates(browserReport, browserCreatedAt);
  assertPublicationMetrics(browserReport);
  return browserReport;
}

function browserMethodology(browserReport) {
  const browser = browserReport.browser;
  return `Chromium ${browser.version} · ${formatNumber(browserReport.viewport.width)}×${formatNumber(browserReport.viewport.height)} viewport · ${browserReport.roundsPerApp} randomized cold-cache navigations · fresh foreground process/context/page per sample · native occlusion throttling disabled · no CPU or network throttling`;
}

function rowMetric(metric, aggregate) {
  if (aggregate.status === "unavailable") {
    return Object.freeze({
      available: false,
      detail:
        `Unavailable across all ${OFFICIAL_MINIMUM_ROUNDS} isolated runs`,
      value: null,
      valueDisplay: "Unavailable",
    });
  }
  const statistics = aggregate.statistics;
  const valueDisplay = formatMetricValue(metric, statistics.median);
  const detail =
    `${statistics.count} isolated runs · MAD ${formatMetricAmount(metric, statistics.mad)} · p95 ${formatMetricAmount(metric, statistics.p95)}`;
  return Object.freeze({
    available: true,
    detail,
    value: statistics.median,
    valueDisplay,
  });
}

function metricSummary(metric, rows) {
  const available = rows
    .filter((row) => row.metric.available)
    .sort((left, right) =>
      left.metric.value - right.metric.value
      || left.label.localeCompare(right.label)
    );
  const unavailableCount = rows.length - available.length;
  const suffix = unavailableCount === 0
    ? ""
    : ` ${unavailableCount} ${unavailableCount === 1 ? "row reports" : "rows report"} this metric as unavailable.`;
  const [leader, runnerUp] = available;
  if (runnerUp === undefined) {
    return `${leader.label} is the only row with an available median.${suffix}`;
  }
  const gap = runnerUp.metric.value - leader.metric.value;
  if (gap <= Number.EPSILON) {
    return `${leader.label} and ${runnerUp.label} have the same median; the measured ordering is tied.${suffix}`;
  }
  const percentage = gap / runnerUp.metric.value * 100;
  const leaderMad = metricAt(leader.aggregate, "statistics.mad");
  const runnerUpMad = metricAt(runnerUp.aggregate, "statistics.mad");
  const combinedMad = leaderMad + runnerUpMad;
  return gap > combinedMad
    ? `${leader.label} records the lowest median, ${percentage.toFixed(1)}% below ${runnerUp.label}; the ${formatMetricAmount(metric, gap)} gap exceeds their combined ${formatMetricAmount(metric, combinedMad)} MAD.${suffix}`
    : `${leader.label} records the lowest median, ${percentage.toFixed(1)}% below ${runnerUp.label}; the ${formatMetricAmount(metric, gap)} gap is within their combined ${formatMetricAmount(metric, combinedMad)} MAD, so the measured ordering overlaps run noise.${suffix}`;
}

export function buildBrowserSummaryExtension(
  ssrReport,
  browserReport,
  ssrRows,
) {
  assertCombinedBrowserReport(ssrReport, browserReport);
  const methodology = browserMethodology(browserReport);
  const summaries = new Map(
    browserReport.summaries.map((summary) => [summary.productId, summary]),
  );
  const metricsByCaseId = new Map(
    ssrRows.map(({ caseId }) => [caseId, {}]),
  );
  const metrics = PUBLICATION_METRICS.map((metric) => {
    const rows = ssrRows.map(({ caseId, label }) => {
      const aggregate = metricAt(summaries.get(caseId)?.metrics, metric.path);
      const value = rowMetric(metric, aggregate);
      metricsByCaseId.get(caseId)[metric.id] = value;
      return { aggregate, label, metric: value };
    });
    return Object.freeze({
      available: rows.some((row) => row.metric.available),
      description: metric.description,
      direction: metric.direction,
      directionLabel: metric.directionLabel,
      id: metric.id,
      label: metric.label,
      methodology,
      selected: false,
      summary: metricSummary(metric, rows),
      unit: metric.unit,
    });
  });
  return Object.freeze({
    description:
      "Compare fourteen product paths by single-core server throughput or cold-navigation browser cost without collapsing unlike measurements into one score.",
    metrics: Object.freeze(metrics),
    metricsByCaseId,
  });
}

export { PUBLICATION_METRICS };
