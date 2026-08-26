// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { createHash } from "node:crypto";
import { createCaseMatrix } from "../../todo/runner/lib/cases.mjs";
import { createBuildPlan } from "../../todo/runner/lib/builds.mjs";
import { metricAt } from "../../todo/browser/metrics.mjs";
import { assertBrowserReport } from "../../todo/browser/schema.mjs";
import { TODO_STATE_VARIANTS } from "../../todo/shared/state.mjs";
import { loadRuntimePins } from "../../todo/servers/verify-runtimes.mjs";

const MEBIBYTE = 1024 * 1024;
const OFFICIAL_ROUNDS = 7;
const VIEWPORT = Object.freeze({ height: 900, width: 1_440 });
const browserLaunchArguments = Object.freeze([
  "--disable-backgrounding-occluded-windows",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-features=CalculateNativeWinOcclusion",
  "--enable-precise-memory-info",
  "--enable-blink-features=DeclarativeCSSModules",
  "--process-per-tab",
]);
const officialCases = createCaseMatrix();
const officialBuildIds = Object.freeze(
  createBuildPlan(officialCases, {
    browser: true,
    localWebui: false,
  }).map(({ id }) => id),
);
const officialCaseIds = Object.freeze(
  officialCases.map(({ id }) => id),
);
const officialRuntimeIds = new Map(
  officialCases.map(({ id, runtimeId }) => [id, runtimeId]),
);
const requiredRuntimeIds = Object.freeze([
  ...new Set(
    officialCases
      .map(({ runtimeId }) => runtimeId)
      .filter((runtimeId) => runtimeId !== "rust"),
  ),
]);
const runtimePins = loadRuntimePins();
const sharedStateDigest = createHash("sha256")
  .update(JSON.stringify(TODO_STATE_VARIANTS))
  .digest("hex");

const metricDefinitions = Object.freeze([
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
  }),
]);

function formatNumber(value) {
  const [whole, fraction] = value.toFixed(2).replace(/\.?0+$/u, "").split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = sign ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return fraction === undefined
    ? `${sign}${grouped}`
    : `${sign}${grouped}.${fraction}`;
}

function formatMetricValue(value, definition) {
  const normalized = definition.unit === "MiB" ? value / MEBIBYTE : value;
  if (normalized > 0 && normalized < 0.01) {
    return "<0.01";
  }
  return formatNumber(normalized);
}

function hasExactIds(values, expectedIds, selectId) {
  if (!Array.isArray(values) || values.length !== expectedIds.length) {
    return false;
  }
  const ids = values.map(selectId);
  return ids.every((id) => typeof id === "string")
    && new Set(ids).size === expectedIds.length
    && expectedIds.every((id) => ids.includes(id));
}

function arraysEqual(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function hasGreenRuntimeEvidence(report) {
  const verification = report.runtimeVerification;
  const policy = report.runtimePolicy;
  return verification?.schema === "webui.ssr-todo-runtime-pins/v1"
    && verification.mode === "official"
    && verification.status === "ok"
    && hasExactIds(
      verification.runtimes,
      requiredRuntimeIds,
      (runtime) => runtime?.runtimeId,
    )
    && verification.runtimes.every((runtime) =>
      runtime.required === true
      && runtime.installed === true
      && runtime.versionMatches === true
      && runtime.status === "available"
      && runtime.code === null
      && runtime.error === null
      && runtime.expectedVersion
        === runtimePins.runtimes[runtime.runtimeId].version
      && runtime.version === runtimePins.runtimes[runtime.runtimeId].version
    )
    && policy?.status === "ok"
    && hasExactIds(
      policy.decisions,
      requiredRuntimeIds,
      (decision) => decision?.runtimeId,
    )
    && policy.decisions.every((decision) =>
      decision.status === "available"
      && decision.code === null
      && decision.reason === null
    );
}

function hasPinnedRoundRuntimes(report) {
  const apps = new Map(
    report.apps.map((app) => [app.productId, app]),
  );
  return report.rawRounds.every((round) => {
    const runtimeId = officialRuntimeIds.get(round.productId);
    const expectedVersion = runtimeId === "rust"
      ? "native"
      : runtimePins.runtimes[runtimeId]?.version;
    return typeof expectedVersion === "string"
      && apps.get(round.productId)?.runtime?.id === runtimeId
      && round.runtime?.id === runtimeId
      && round.runtime.version === expectedVersion
      && apps.get(round.productId).runtime.version === expectedVersion;
  });
}

function hasCanonicalBrowserMethodology(report) {
  const browser = report.browser;
  return browser?.engine === "chromium"
    && browser.cachePolicy
      === "fresh browser process and context start empty; same-navigation resource reuse remains enabled"
    && browser.contextIsolation
      === "fresh foreground Chromium process, context, and page per product round"
    && browser.cpuThrottling === "none"
    && browser.headless === false
    && arraysEqual(browser.launchArguments, browserLaunchArguments)
    && browser.networkThrottling === "none"
    && browser.processPerSample === true
    && browser.processWarmup
      === "two unmeasured foreground animation frames before each product navigation"
    && browser.transportProtocol === "h2"
    && typeof browser.version === "string"
    && browser.version.length > 0
    && browser.version !== "unavailable"
    && report.viewport?.width === VIEWPORT.width
    && report.viewport?.height === VIEWPORT.height;
}

function hasExportMetricUnits(report) {
  return report.summaries.every((summary) =>
    metricDefinitions.every((definition) => {
      const metric = metricAt(summary.metrics, definition.path);
      return metric?.status === "unavailable"
        || (
          metric?.status === "available"
          && metric.unit === definition.sourceUnit
        );
    })
  );
}

function hasMatchingEvidence(ssrReport, browserReport) {
  return browserReport.mode === "official"
    && browserReport.roundsPerApp === OFFICIAL_ROUNDS
    && browserReport.sourceRevision?.workingTreeDirty === false
    && browserReport.sourceRevision.commit
      === ssrReport.sourceRevision.commit
    && browserReport.sourceRevision.sourceDigest
      === ssrReport.sourceRevision.sourceDigest
    && browserReport.fixture?.hash?.value === ssrReport.fixture?.hash?.value
    && hasCanonicalBrowserMethodology(browserReport)
    && browserReport.cleanup?.status === "verified"
    && browserReport.cleanup?.processRegistryEmpty === true
    && hasExactIds(
      browserReport.builds,
      officialBuildIds,
      ({ id }) => id,
    )
    && browserReport.builds.every(({ status }) => status === "ok")
    && hasGreenRuntimeEvidence(browserReport)
    && browserReport.snapshotIntegrity?.status === "verified"
    && browserReport.snapshotIntegrity.fixtureHashBefore
      === ssrReport.fixture.hash.value
    && browserReport.snapshotIntegrity.fixtureHashAfter
      === ssrReport.fixture.hash.value
    && browserReport.snapshotIntegrity.sharedStateHashBefore
      === sharedStateDigest
    && browserReport.snapshotIntegrity.sharedStateHashAfter
      === sharedStateDigest
    && Array.isArray(browserReport.rawRounds)
    && browserReport.rawRounds.length
      === officialCaseIds.length * OFFICIAL_ROUNDS
    && browserReport.rawRounds.every(({ status }) => status === "ok")
    && hasPinnedRoundRuntimes(browserReport)
    && hasExactIds(
      browserReport.apps,
      officialCaseIds,
      ({ productId }) => productId,
    )
    && hasExactIds(
      browserReport.summaries,
      officialCaseIds,
      ({ productId }) => productId,
    )
    && browserReport.summaries.every(
      (summary) =>
        summary.status === "ok"
        && summary.attemptedRounds === OFFICIAL_ROUNDS
        && summary.successfulRounds === OFFICIAL_ROUNDS,
    )
    && hasExportMetricUnits(browserReport);
}

function unavailableMetric(metric) {
  const reasons = Array.isArray(metric?.reasons)
    ? metric.reasons.filter((reason) => typeof reason === "string")
    : [];
  return {
    available: false,
    detail: reasons.join("; ") || "No supported measurement",
    value: null,
    valueDisplay: "Unavailable",
  };
}

function metricValue(summary, definition) {
  const metric = metricAt(summary?.metrics, definition.path);
  if (metric?.status !== "available") {
    return unavailableMetric(metric);
  }
  const { mad, median, p95 } = metric.statistics;
  const unavailable = metric.unavailableSamples > 0
    ? ` · ${metric.unavailableSamples} unavailable`
    : "";
  return {
    available: true,
    detail:
      `${metric.availableSamples} isolated runs · MAD ${formatMetricValue(mad, definition)} ${definition.unit} · p95 ${formatMetricValue(p95, definition)} ${definition.unit}${unavailable}`,
    value: median,
    valueDisplay: formatMetricValue(median, definition),
  };
}

function metricWinnerStatement(report, definition) {
  const labels = new Map(
    report.apps.map(({ label, productId }) => [productId, label]),
  );
  const ranked = report.summaries
    .map((summary) => ({
      label: labels.get(summary.productId) ?? summary.productId,
      metric: metricAt(summary.metrics, definition.path),
    }))
    .filter(({ metric }) => metric?.status === "available")
    .map(({ label, metric }) => ({
      label,
      mad: metric.statistics.mad,
      value: metric.statistics.median,
    }))
    .sort(
      (left, right) =>
        left.value - right.value
        || left.label.localeCompare(right.label),
    );
  const [leader, runnerUp] = ranked;
  if (!leader) {
    return `${definition.label} is unavailable for every product row.`;
  }
  if (!runnerUp || runnerUp.value <= 0) {
    return `${leader.label} records the only available ${definition.label} measurement.`;
  }
  const gap = runnerUp.value - leader.value;
  if (gap <= Number.EPSILON) {
    return `${leader.label} and ${runnerUp.label} have the same median; the measured ordering is tied.`;
  }
  const percentage = gap / runnerUp.value * 100;
  const combinedMad = leader.mad + runnerUp.mad;
  return gap > combinedMad
    ? `${leader.label} records the lowest median, ${percentage.toFixed(1)}% below ${runnerUp.label}; the ${formatMetricValue(gap, definition)} ${definition.unit} gap exceeds their combined ${formatMetricValue(combinedMad, definition)} ${definition.unit} MAD.`
    : `${leader.label} records the lowest median, ${percentage.toFixed(1)}% below ${runnerUp.label}; the ${formatMetricValue(gap, definition)} ${definition.unit} gap is within their combined ${formatMetricValue(combinedMad, definition)} ${definition.unit} MAD, so the measured ordering overlaps run noise.`;
}

function methodology(report) {
  return `Chromium ${report.browser.version} · ${formatNumber(report.viewport.width)}×${formatNumber(report.viewport.height)} viewport · ${report.roundsPerApp} randomized cold-cache navigations · fresh foreground process/context/page per sample · native occlusion throttling disabled · no CPU or network throttling`;
}

export function createBrowserSummaryEvidence(ssrReport, browserReport) {
  if (browserReport === null) {
    return null;
  }
  assertBrowserReport(browserReport);
  if (!hasMatchingEvidence(ssrReport, browserReport)) {
    throw new Error(
      "Browser summary export requires a clean, complete, matching seven-round headed official report with canonical methodology",
    );
  }
  const method = methodology(browserReport);
  const metricsByCase = new Map(
    browserReport.summaries.map((summary) => [
      summary.productId,
      Object.fromEntries(
        metricDefinitions.map((definition) => [
          definition.id,
          metricValue(summary, definition),
        ]),
      ),
    ]),
  );
  const metrics = metricDefinitions.map((definition) => ({
    available: browserReport.summaries.some(
      (summary) =>
        metricAt(summary.metrics, definition.path)?.status === "available",
    ),
    description: definition.description,
    direction: definition.direction,
    directionLabel: definition.directionLabel,
    id: definition.id,
    label: definition.label,
    methodology: method,
    selected: false,
    summary: metricWinnerStatement(browserReport, definition),
    unit: definition.unit,
  }));
  return Object.freeze({
    description:
      `Compare ${officialCaseIds.length} product paths by single-core server throughput or cold-navigation browser cost without collapsing unlike measurements into one score.`,
    metrics: Object.freeze(metrics),
    metricsByCase,
  });
}
