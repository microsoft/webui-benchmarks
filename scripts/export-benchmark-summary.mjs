// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  createCaseMatrix,
  OFFICIAL_CASE_COUNT,
} from "../todo/runner/lib/cases.mjs";
import {
  PROCESS_METRICS_INTERVAL_MILLISECONDS,
  WINDOWS_PROCESS_METRICS_UNAVAILABLE_REASON,
} from "../todo/runner/lib/metrics.mjs";
import { analyzeSaturation } from "../todo/runner/lib/load.mjs";
import { DEFAULT_PROTOCOL } from "../todo/runner/lib/options.mjs";
import { deterministicOrder } from "../todo/runner/lib/order.mjs";
import { assertReportSchema } from "../todo/runner/lib/schema.mjs";
import {
  summarizeResponseByteProfiles,
  summarizeRounds,
} from "../todo/runner/lib/statistics.mjs";
import { TODO_STATE_VARIANTS } from "../todo/shared/state.mjs";
import { isMainModule } from "../todo/servers/lib/cli.mjs";
import { loadRuntimePins } from "../todo/servers/verify-runtimes.mjs";
import {
  createBrowserSummaryEvidence,
  expectedOfficialBuildIds,
} from "./lib/browser-benchmark-summary.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const officialCases = createCaseMatrix();
const officialCaseIds = Object.freeze(
  officialCases.map((benchmarkCase) => benchmarkCase.id),
);
const requiredRuntimeIds = Object.freeze([
  ...new Set(
    officialCases
      .map((benchmarkCase) => benchmarkCase.runtimeId)
      .filter((runtimeId) => runtimeId !== "rust"),
  ),
]);
const summaryStatisticFields = Object.freeze([
  "count",
  "mad",
  "max",
  "median",
  "min",
  "p95",
]);
const windowsSaturationReason = "Server process metrics were unavailable";
const unsaturatedReason =
  "Throughput was still increasing at the largest connection count";
const mebibyte = 1024 * 1024;
const runtimePins = loadRuntimePins();
const defaultOutputPath = resolve(
  repositoryRoot,
  "results",
  "benchmark-summary.json",
);

function requiredNumber(value, path) {
  if (!Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`);
  }
  return value;
}

function requiredString(value, path) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
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

function arraysEqual(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function numbersEqual(left, right) {
  const scale = Math.max(Math.abs(left), Math.abs(right), 1);
  return Number.isFinite(left)
    && Number.isFinite(right)
    && Math.abs(left - right) <= scale * 1e-12;
}

function statisticsEqual(actual, expected) {
  return summaryStatisticFields.every((field) =>
    numbersEqual(actual?.[field], expected?.[field])
  );
}

function responseByteProfilesEqual(actual, expected) {
  return numbersEqual(
    actual?.cachedRouteContract,
    expected.cachedRouteContract,
  )
    && numbersEqual(actual?.dynamic?.maximum, expected.dynamic.maximum)
    && numbersEqual(actual?.dynamic?.mean, expected.dynamic.mean)
    && numbersEqual(actual?.dynamic?.minimum, expected.dynamic.minimum)
    && Array.isArray(actual?.dynamic?.byVariant)
    && actual.dynamic.byVariant.length === expected.dynamic.byVariant.length
    && actual.dynamic.byVariant.every((value, index) =>
      numbersEqual(value, expected.dynamic.byVariant[index])
    );
}

function hasCanonicalProtocol(report) {
  const expectedBuildIds = expectedOfficialBuildIds(report);
  const config = report.config;
  return expectedBuildIds !== null
    && config?.build === true
    && config.connections === DEFAULT_PROTOCOL.connections
    && config.durationSeconds === DEFAULT_PROTOCOL.durationSeconds
    && config.loadWorkers === DEFAULT_PROTOCOL.loadWorkers
    && config.rounds === DEFAULT_PROTOCOL.rounds
    && arraysEqual(
      config.saturationConnections,
      DEFAULT_PROTOCOL.saturationConnections,
    )
    && config.saturationDurationSeconds
      === DEFAULT_PROTOCOL.saturationDurationSeconds
    && config.warmupSeconds === DEFAULT_PROTOCOL.warmupSeconds
    && arraysEqual(config.scalingCores, [1])
    && config.serverCpu === 0
    && hasExactIds(report.builds, expectedBuildIds, ({ id }) => id)
    && report.builds.every(({ status }) => status === "ok");
}

function summaryMatchesRawRounds(summary, rounds) {
  const statistics = summarizeRounds(rounds);
  const responseByteProfile = summarizeResponseByteProfiles(
    rounds.map((round) => round.responseByteProfile),
  );
  return [
    "latencyP50Ms",
    "latencyP95Ms",
    "requestsPerSecond",
    "throughputBytesPerSecond",
  ].every((field) => statisticsEqual(summary?.[field], statistics[field]))
    && responseByteProfilesEqual(
      summary?.responseByteProfile,
      responseByteProfile,
    )
    && numbersEqual(
      summary?.naturalResponseBytes,
      responseByteProfile.dynamic.mean,
    )
    && numbersEqual(
      summary?.responseBytes,
      responseByteProfile.dynamic.mean,
    );
}

function hasDerivedSummaries(report) {
  const collections = [report.summaries, report.matrix?.summaries];
  return officialCaseIds.every((caseId) => {
    const rounds = report.rawRounds.filter((round) =>
      round.caseId === caseId
    );
    return collections.every((summaries) => {
      const summary = summaries.find((candidate) =>
        candidate.caseId === caseId
      );
      return summaryMatchesRawRounds(summary, rounds);
    });
  });
}

function isCompleteSaturationSample(sample, connection) {
  return sample?.connections === connection
    && sample.durationSeconds === DEFAULT_PROTOCOL.saturationDurationSeconds
    && sample.errors === 0
    && sample.non2xx === 0
    && sample.timeouts === 0
    && sample.latencyP95Status === "histogram-10us"
    && sample.loadGenerator?.status === "available"
    && Number.isInteger(sample.measurementAttempts)
    && sample.measurementAttempts >= 1
    && [
      sample.latencyP50Ms,
      sample.latencyP95Ms,
      sample.latencyP99Ms,
      sample.requests,
      sample.requestsPerSecond,
      sample.throughputBytesPerSecond,
    ].every(Number.isFinite);
}

function saturationAnalysisMatches(entry) {
  const expected = analyzeSaturation(entry.samples);
  return [
    "status",
    "reason",
    "plateauStatus",
    "peakConnections",
  ].every((field) => entry.analysis?.[field] === expected[field])
    && [
      "peakRequestsPerSecond",
      "gain",
    ].every((field) =>
      expected[field] === undefined
        ? entry.analysis?.[field] === undefined
        : numbersEqual(entry.analysis?.[field], expected[field])
    );
}

function hasCompleteSaturationEvidence(report) {
  if (
    !hasExactIds(
      report.saturation,
      officialCaseIds,
      (entry) => entry?.caseId,
    )
  ) {
    return false;
  }
  return report.saturation.every((entry) =>
    entry.affinity?.status === "applied"
    && Array.isArray(entry.samples)
    && entry.samples.length === DEFAULT_PROTOCOL.saturationConnections.length
    && entry.samples.every((sample, index) =>
      isCompleteSaturationSample(
        sample,
        DEFAULT_PROTOCOL.saturationConnections[index],
      )
      && (
        report.status !== "ok"
        || sample.serverMetrics?.status === "available"
      )
    )
    && saturationAnalysisMatches(entry)
    && (
      report.status !== "ok"
      || entry.analysis?.status === "saturated"
    )
  );
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

function hasCompleteStatistic(statistic, rounds) {
  return statistic?.count === rounds
    && summaryStatisticFields
      .filter((field) => field !== "count")
      .every((field) => Number.isFinite(statistic[field]));
}

function hasCompleteResponseBytes(value, stateVariants) {
  const dynamic = value?.dynamic;
  return Number.isFinite(value?.cachedRouteContract)
    && Number.isFinite(dynamic?.maximum)
    && Number.isFinite(dynamic?.mean)
    && Number.isFinite(dynamic?.minimum)
    && Array.isArray(dynamic?.byVariant)
    && dynamic.byVariant.length === stateVariants
    && dynamic.byVariant.every(Number.isFinite);
}

function isCompleteSummary(summary, rounds, stateVariants) {
  return ["label", "renderer", "transport"].every((field) =>
    typeof summary?.[field] === "string" && summary[field].length > 0
  )
    && [
      summary?.latencyP50Ms,
    summary?.latencyP95Ms,
    summary?.requestsPerSecond,
      summary?.throughputBytesPerSecond,
    ].every((statistic) => hasCompleteStatistic(statistic, rounds))
    && Number.isFinite(summary?.naturalResponseBytes)
    && Number.isFinite(summary?.responseBytes)
    && hasCompleteResponseBytes(summary?.responseByteProfile, stateVariants);
}

function hasCompleteSummaries(report) {
  const rounds = report.config?.rounds;
  const stateVariants = report.fixture?.stateVariants;
  const summaryCollections = [
    report.summaries,
    report.matrix?.summaries,
  ];
  return summaryCollections.every((summaries) =>
    hasExactIds(summaries, officialCaseIds, (summary) => summary?.caseId)
    && summaries.every((summary) =>
      isCompleteSummary(summary, rounds, stateVariants)
    )
  );
}

function isCompleteRawRound(round, stateVariants) {
  return round?.headline === true
    && round.inputPolicy === "request-timestamped-input"
    && round.payloadPolicy === "natural"
    && round.affinity?.cpuIndex === 0
    && round.affinity?.status === "applied"
    && round.latencyP95Status === "histogram-10us"
    && round.loadGenerator?.status === "available"
    && Number.isInteger(round.measurementAttempts)
    && round.measurementAttempts >= 1
    && round.warmup?.status === "ok"
    && round.warmup.durationSeconds === DEFAULT_PROTOCOL.warmupSeconds
    && Number.isFinite(round.warmup.requests)
    && [
      round.latencyP50Ms,
      round.latencyP95Ms,
      round.latencyP99Ms,
      round.naturalResponseBytes,
      round.requests,
      round.requestsPerSecond,
      round.responseBytes,
      round.throughputBytesPerSecond,
    ].every(Number.isFinite)
    && hasCompleteResponseBytes(round.responseByteProfile, stateVariants);
}

function hasCompleteRawRounds(report) {
  const rounds = report.config?.rounds;
  const expectedKeys = new Set(
    officialCaseIds.flatMap((caseId) =>
      Array.from(
        { length: rounds },
        (_, round) => `${caseId}\0${round}`,
      )
    ),
  );
  if (
    !Array.isArray(report.rawRounds)
    || report.rawRounds.length !== expectedKeys.size
  ) {
    return false;
  }
  const orderIndexes = Array.from({ length: rounds }, () => new Set());
  const expectedOrders = Array.from(
    { length: rounds },
    (_, round) =>
      deterministicOrder(officialCases, round).map(({ id }) => id),
  );
  for (const rawRound of report.rawRounds) {
    const key = `${rawRound?.caseId}\0${rawRound?.round}`;
    const round = rawRound?.round;
    const orderIndex = rawRound?.orderIndex;
    if (
      !expectedKeys.delete(key)
      || !Number.isInteger(round)
      || round < 0
      || round >= rounds
      || !Number.isInteger(orderIndex)
      || orderIndex < 0
      || orderIndex >= OFFICIAL_CASE_COUNT
      || orderIndexes[round].has(orderIndex)
      || expectedOrders[round][orderIndex] !== rawRound.caseId
      || !isCompleteRawRound(rawRound, report.fixture?.stateVariants)
    ) {
      return false;
    }
    orderIndexes[round].add(orderIndex);
  }
  return expectedKeys.size === 0
    && orderIndexes.every((indexes) => indexes.size === OFFICIAL_CASE_COUNT);
}

function isWindowsProcessMetricsUnavailable(serverMetrics) {
  const keys = serverMetrics === null || typeof serverMetrics !== "object"
    ? []
    : Object.keys(serverMetrics);
  return serverMetrics !== null
    && typeof serverMetrics === "object"
    && !Array.isArray(serverMetrics)
    && keys.length >= 2
    && keys.length <= 3
    && keys.every((key) =>
      ["intervalMilliseconds", "reason", "status"].includes(key)
    )
    && serverMetrics.status === "unavailable"
    && serverMetrics.reason === WINDOWS_PROCESS_METRICS_UNAVAILABLE_REASON
    && (
      serverMetrics.intervalMilliseconds === undefined
      || serverMetrics.intervalMilliseconds
        === PROCESS_METRICS_INTERVAL_MILLISECONDS
    );
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

function isWindowsReport(report) {
  return report.machine?.osPlatform === "win32"
    && report.machine?.processPlatform === "win32";
}

function hasExpectedProcessMetrics(report, serverMetrics) {
  return isWindowsReport(report)
    ? isWindowsProcessMetricsUnavailable(serverMetrics)
    : serverMetrics?.status === "available";
}

function hasOnlyDocumentedSaturationResults(report) {
  const connections = report.config?.saturationConnections;
  if (
    !Array.isArray(connections)
    || connections.length === 0
    || !hasExactIds(
      report.saturation,
      officialCaseIds,
      (entry) => entry?.caseId,
    )
  ) {
    return false;
  }
  return report.saturation.every((entry) =>
    (
      isWindowsReport(report)
      && entry.analysis?.status === "process-metrics-unavailable"
      && entry.analysis.plateauStatus === "saturated"
      && entry.analysis.reason === windowsSaturationReason
      && Number.isFinite(entry.analysis.peakConnections)
      && Number.isFinite(entry.analysis.peakRequestsPerSecond)
      || !isWindowsReport(report)
      && entry.analysis?.status === "saturated"
      && Number.isFinite(entry.analysis.peakConnections)
      && Number.isFinite(entry.analysis.peakRequestsPerSecond)
      || entry.analysis?.status === "server-unsaturated"
      && entry.analysis.reason === unsaturatedReason
      && Number.isFinite(entry.analysis.gain)
      && entry.analysis.gain > 0.05
    )
    && Array.isArray(entry.samples)
    && entry.samples.length === connections.length
    && entry.samples.every((sample, index) =>
      sample.connections === connections[index]
      && sample.latencyP95Status === "histogram-10us"
      && sample.loadGenerator?.status === "available"
      && hasExpectedProcessMetrics(report, sample.serverMetrics)
    )
  );
}

function isDocumentedPartialReport(report) {
  const windows = isWindowsReport(report);
  const hasSaturationWarning = report.saturation.some(
    ({ analysis }) => analysis.status === "server-unsaturated",
  );
  return report.status === "partial"
    && (windows || hasSaturationWarning)
    && hasGreenRuntimeEvidence(report)
    && report.rawRounds.every((round) =>
      (windows
        ? round.metricsStatus === "ok"
          && isWindowsProcessMetricsUnavailable(round.serverMetrics)
        : round.metricsStatus === "ok"
          && round.serverMetrics?.status === "available")
      && round.latencyP95Status === "histogram-10us"
      && round.loadGenerator?.status === "available"
    )
    && hasOnlyDocumentedSaturationResults(report);
}

function isCanonicalOfficialReport(report) {
  return hasCanonicalProtocol(report)
    && report.config?.quick === false
    && report.config?.rounds === DEFAULT_PROTOCOL.rounds
    && report.config?.runtimeMode === "official"
    && Array.isArray(report.config?.caseFilters)
    && report.config.caseFilters.length === 0
    && report.fixture?.stateVariants === TODO_STATE_VARIANTS.length
    && report.sourceRevision?.workingTreeDirty === false
    && hasGreenRuntimeEvidence(report)
    && hasExactIds(report.cases, officialCaseIds, (benchmarkCase) =>
      benchmarkCase?.id
    )
    && report.cases.every(({ status }) => status === "complete")
    && hasCompleteSummaries(report)
    && hasCompleteRawRounds(report)
    && hasDerivedSummaries(report)
    && hasCompleteSaturationEvidence(report);
}

function unavailableTelemetryMetric(unit, reason) {
  return {
    available: false,
    detail: reason,
    statistics: null,
    unit,
    value: null,
    valueDisplay: "Unavailable",
  };
}

function telemetryMetric(statistics, unit, scale, reason) {
  if (statistics === null) {
    return unavailableTelemetryMetric(unit, reason);
  }
  const scaled = (value) => value / scale;
  return {
    available: true,
    detail: `${statistics.count} measured round${
      statistics.count === 1 ? "" : "s"
    } · MAD ${formatNumber(scaled(statistics.mad))} ${unit} · p95 ${
      formatNumber(scaled(statistics.p95))
    } ${unit}`,
    statistics,
    unit,
    value: statistics.median,
    valueDisplay: formatNumber(scaled(statistics.median)),
  };
}

function telemetryReasons(rounds) {
  return [
    ...new Set(
      rounds.flatMap((round) => [
        round.serverMetrics,
        round.serverMemory?.startup,
        round.serverMemory?.postWarmup,
        round.serverMemory?.peakDuringLoad,
        round.serverMemory?.postSettle,
      ])
        .filter((measurement) =>
          measurement?.status === "unavailable"
          && typeof measurement.reason === "string"
          && measurement.reason.length > 0
        )
        .map(({ reason }) => reason),
    ),
  ];
}

function serverTelemetry(report, caseId) {
  const rounds = report.rawRounds.filter((round) => round.caseId === caseId);
  const summary = summarizeRounds(rounds);
  const reasons = telemetryReasons(rounds);
  const reason = reasons.length === 1 ? reasons[0] : null;
  const memory = summary.serverMemory;
  return {
    available: memory.status === "available",
    availableRounds: memory.availableRounds,
    cpuMillisecondsPerRequest: telemetryMetric(
      summary.serverCpuMillisecondsPerRequest,
      "ms/req",
      1,
      reason,
    ),
    loadDeltaPeakRssBytes: telemetryMetric(
      memory.loadDeltaPeakRssBytes,
      "MiB",
      mebibyte,
      reason,
    ),
    peakRssBytes: telemetryMetric(
      memory.peakRssBytes,
      "MiB",
      mebibyte,
      reason,
    ),
    postSettleRssBytes: telemetryMetric(
      memory.postSettleRssBytes,
      "MiB",
      mebibyte,
      reason,
    ),
    postWarmupRssBytes: telemetryMetric(
      memory.postWarmupRssBytes,
      "MiB",
      mebibyte,
      reason,
    ),
    reason,
    reasons,
    retainedRssBytes: telemetryMetric(
      memory.retainedRssBytes,
      "MiB",
      mebibyte,
      reason,
    ),
    startupRssBytes: telemetryMetric(
      memory.startupRssBytes,
      "MiB",
      mebibyte,
      reason,
    ),
    status: memory.status,
    unavailableRounds: memory.unavailableRounds,
  };
}

function matrixRows(report) {
  const summaries = report.matrix?.summaries;
  if (
    !Array.isArray(summaries)
    || summaries.length !== OFFICIAL_CASE_COUNT
  ) {
    throw new Error(
      `Official matrix must contain ${OFFICIAL_CASE_COUNT} summaries`,
    );
  }
  return summaries.map((summary, index) => ({
    caseId: requiredString(summary.caseId, `summaries[${index}].caseId`),
    label: requiredString(summary.label, `summaries[${index}].label`),
    madRequestsPerSecond: requiredNumber(
      summary.requestsPerSecond?.mad,
      `summaries[${index}].requestsPerSecond.mad`,
    ),
    maximumResponseBytes: requiredNumber(
      summary.responseByteProfile?.dynamic?.maximum,
      `summaries[${index}].responseByteProfile.dynamic.maximum`,
    ),
    medianP95LatencyMs: requiredNumber(
      summary.latencyP95Ms?.median,
      `summaries[${index}].latencyP95Ms.median`,
    ),
    medianRequestsPerSecond: requiredNumber(
      summary.requestsPerSecond?.median,
      `summaries[${index}].requestsPerSecond.median`,
    ),
    minimumResponseBytes: requiredNumber(
      summary.responseByteProfile?.dynamic?.minimum,
      `summaries[${index}].responseByteProfile.dynamic.minimum`,
    ),
    renderer: requiredString(
      summary.renderer,
      `summaries[${index}].renderer`,
    ),
    serverTelemetry: serverTelemetry(report, summary.caseId),
    transport: requiredString(
      summary.transport,
      `summaries[${index}].transport`,
    ),
  }));
}

function winnerStatement(rows) {
  const ranked = [...rows].sort(
    (left, right) =>
      right.medianRequestsPerSecond - left.medianRequestsPerSecond,
  );
  const [leader, runnerUp] = ranked;
  if (!leader || !runnerUp || runnerUp.medianRequestsPerSecond <= 0) {
    throw new Error("Official matrix needs at least two positive rows");
  }
  const gap =
    leader.medianRequestsPerSecond - runnerUp.medianRequestsPerSecond;
  if (gap <= Number.EPSILON) {
    return `${leader.label} and ${runnerUp.label} have the same median; the measured ordering is tied.`;
  }
  const percentage = gap / runnerUp.medianRequestsPerSecond * 100;
  const combinedMad =
    leader.madRequestsPerSecond + runnerUp.madRequestsPerSecond;
  let statement = gap > combinedMad
    ? `${leader.label} records the highest median, ${percentage.toFixed(1)}% ahead of ${runnerUp.label}; the ${formatNumber(gap)} req/s gap exceeds their combined ${formatNumber(combinedMad)} req/s MAD.`
    : `${leader.label} records the highest median, ${percentage.toFixed(1)}% above ${runnerUp.label}; the ${formatNumber(gap)} req/s gap is within their combined ${formatNumber(combinedMad)} req/s MAD, so the measured ordering overlaps run noise.`;
  if (
    leader.caseId.startsWith("webui-")
    && runnerUp.caseId.startsWith("webui-")
  ) {
    const external = ranked.find(({ caseId }) => !caseId.startsWith("webui-"));
    if (!external || external.medianRequestsPerSecond <= 0) {
      throw new Error("Official matrix has no positive non-WebUI comparison");
    }
    const externalGap =
      leader.medianRequestsPerSecond - external.medianRequestsPerSecond;
    const externalPercentage =
      externalGap / external.medianRequestsPerSecond * 100;
    const externalMad =
      leader.madRequestsPerSecond + external.madRequestsPerSecond;
    statement += ` Against the fastest non-WebUI row, ${external.label}, ${leader.label} is ${externalPercentage.toFixed(1)}% higher; the ${formatNumber(externalGap)} req/s gap ${externalGap > externalMad ? "exceeds" : "is within"} their combined ${formatNumber(externalMad)} req/s MAD.`;
  }
  return statement;
}

function methodology(report) {
  const variants = requiredNumber(
    report.fixture?.stateVariants,
    "fixture.stateVariants",
  );
  const connections = requiredNumber(
    report.config?.connections,
    "config.connections",
  );
  const workers = requiredNumber(
    report.config?.loadWorkers,
    "config.loadWorkers",
  );
  const rounds = requiredNumber(report.config?.rounds, "config.rounds");
  const duration = requiredNumber(
    report.config?.durationSeconds,
    "config.durationSeconds",
  );
  const roundLabel = rounds === 1 ? "measured round" : "randomized rounds";
  return `100 todos · 13 component types · ${variants} warm structural variants · current UTC state materialized per request · ${connections} connections from ${workers} load workers · 1 server process/worker pinned to 1 CPU · ${rounds} × ${duration} s ${roundLabel} · dynamic SSR · natural bytes`;
}

function saturationWarnings(report, rows) {
  const labels = new Map(rows.map(({ caseId, label }) => [caseId, label]));
  return report.saturation
    .filter(({ analysis }) => analysis.status === "server-unsaturated")
    .map(({ analysis, caseId }) => ({
      caseId,
      gainPercent: analysis.gain * 100,
      label: labels.get(caseId) ?? caseId,
      measuredConnections: report.config.connections,
      probeConnections: report.config.saturationConnections.at(-1),
      reason: analysis.reason,
    }));
}

function renderRows(rows, browserEvidence, warnings) {
  const warningsByCase = new Map(
    warnings.map((warning) => [warning.caseId, warning]),
  );
  const ordered = [...rows].sort(
    (left, right) =>
      right.medianRequestsPerSecond - left.medianRequestsPerSecond
      || left.label.localeCompare(right.label),
  );
  const maximum = ordered[0]?.medianRequestsPerSecond;
  if (!Number.isFinite(maximum) || maximum <= 0) {
    throw new Error("Official matrix chart has no positive rows");
  }
  let previousDisplay = "";
  let displayedRank = 0;
  return ordered.map((row, index) => {
    const valueDisplay = formatNumber(row.medianRequestsPerSecond);
    if (valueDisplay !== previousDisplay) {
      displayedRank = index + 1;
      previousDisplay = valueDisplay;
    }
    const warning = warningsByCase.get(row.caseId);
    const warningDetail = warning === undefined
      ? ""
      : ` · saturation warning: the 128-connection probe was ${
          warning.gainPercent.toFixed(1)
        }% faster`;
    const detail = `${row.renderer} · ${row.transport} · MAD ${formatNumber(row.madRequestsPerSecond)} req/s · p95 ${formatNumber(row.medianP95LatencyMs)} ms · ${formatNumber(row.minimumResponseBytes)}-${formatNumber(row.maximumResponseBytes)} B natural${warningDetail}`;
    const metric = {
      available: true,
      detail,
      serverTelemetry: row.serverTelemetry,
      value: row.medianRequestsPerSecond,
      valueDisplay,
    };
    return {
      activeAvailable: true,
      activeDetail: detail,
      activeUnit: "req/s",
      activeValueDisplay: valueDisplay,
      activeWidth:
        `${(row.medianRequestsPerSecond / maximum * 100).toFixed(1)}%`,
      caseId: row.caseId,
      label: row.label,
      metrics: {
        requestsPerSecond: metric,
        ...(browserEvidence?.metricsByCase.get(row.caseId) ?? {}),
      },
      primary: row.caseId.startsWith("webui-"),
      rank: String(displayedRank),
    };
  });
}

function buildSingleBenchmarkSummary(report, browserReport = null) {
  assertReportSchema(report);
  if (
    !isCanonicalOfficialReport(report)
    || (
      report.status !== "ok"
      && !isDocumentedPartialReport(report)
    )
  ) {
    throw new Error(
      "Summary export requires a clean, complete, unfiltered canonical official report; partial reports are allowed only for documented process telemetry or disclosed fixed-load saturation warnings",
    );
  }
  const responseMode = report.policies?.responseMode ?? "progressive";
  if (responseMode === "complete" && browserReport !== null) {
    throw new Error(
      "Do not merge browser-derived progressive UX evidence into a complete-suite (buffered, one-response) summary; export them as separate result files",
    );
  }
  const browserEvidence = createBrowserSummaryEvidence(report, browserReport);
  const rows = matrixRows(report);
  const warnings = saturationWarnings(report, rows);
  const warningSummary = warnings.length === 0
    ? ""
    : ` Fixed ${report.config.connections}-connection results are retained for ${
        warnings.map(({ label }) => label).join(", ")
      }; their 128-connection saturation probes were still rising, so those throughput values are lower bounds.`;
  const summary = `${winnerStatement(rows)}${warningSummary}`;
  const method = methodology(report);
  const rpsLabel = `${report.config.connections}-connection RPS`;
  const benchmarks = {
    asyncDataBoundary:
      report.capabilities?.asyncDataBoundary ?? null,
    description:
      browserEvidence?.description
      ?? (responseMode === "complete"
        ? "Compare the complete product matrix by single-core completion throughput: every product publishes exactly one fully collected HTML response."
        : "Compare the complete product matrix by single-core server throughput."),
    hasUnavailable: false,
    link: "/webui/guide/concepts/performance/",
    methodology: method,
    metricSummary: summary,
    metrics: [
      {
        available: true,
        description:
          "Dynamic SSR throughput from one timeboxed 20-second measured round.",
        direction: "higher",
        directionLabel: "higher is better",
        id: "requestsPerSecond",
        label: rpsLabel,
        methodology: method,
        selected: true,
        summary,
        unit: "req/s",
      },
      ...(browserEvidence?.metrics ?? []),
    ],
    rows: renderRows(rows, browserEvidence, warnings),
    responseMode,
    saturationWarnings: warnings,
    selectedMetric: "requestsPerSecond",
    selectedMetricDescription:
      "Dynamic SSR throughput from one timeboxed 20-second measured round.",
    selectedMetricLabel: rpsLabel,
    title: responseMode === "complete"
      ? "Same workload, one complete response. Choose the metric."
      : "Same workload. Choose the metric.",
  };
  return {
    benchmarks,
    benchmarksJson: JSON.stringify(benchmarks),
  };
}

function matchingResponseModeReports(progressiveReport, completeReport) {
  const fields = [
    "connections",
    "durationSeconds",
    "loadWorkers",
    "rounds",
    "runtimeMode",
    "saturationDurationSeconds",
    "serverCpu",
    "warmupSeconds",
  ];
  const machineFields = [
    "architecture",
    "cpuCount",
    "cpuModel",
    "hostname",
    "osPlatform",
    "osRelease",
    "processPlatform",
    "totalMemoryBytes",
  ];
  return progressiveReport.policies?.responseMode === "progressive"
    && completeReport.policies?.responseMode === "complete"
    && progressiveReport.sourceRevision?.commit
      === completeReport.sourceRevision?.commit
    && progressiveReport.fixture?.stateVariants
      === completeReport.fixture?.stateVariants
    && fields.every((field) =>
      progressiveReport.config?.[field] === completeReport.config?.[field]
    )
    && machineFields.every((field) =>
      progressiveReport.machine?.[field] === completeReport.machine?.[field]
    )
    && arraysEqual(
      progressiveReport.config?.saturationConnections,
      completeReport.config?.saturationConnections,
    )
    && arraysEqual(
      progressiveReport.config?.scalingCores,
      completeReport.config?.scalingCores,
    )
    && JSON.stringify(progressiveReport.versions?.webuiDependency ?? null)
      === JSON.stringify(completeReport.versions?.webuiDependency ?? null);
}

function combinedBenchmarkSummary(progressive, complete) {
  const progressiveRps = progressive.benchmarks.metrics.find(
    ({ id }) => id === "requestsPerSecond",
  );
  const completeRps = complete.benchmarks.metrics.find(
    ({ id }) => id === "requestsPerSecond",
  );
  if (progressiveRps === undefined || completeRps === undefined) {
    throw new Error("Both response modes must include requests-per-second data");
  }
  const browserMetricIds = new Set([
    "largestContentfulPaintMs",
    "jsHeapUsedBytes",
    "rendererPrivateBytes",
  ]);
  const browserMetrics = progressive.benchmarks.metrics.filter(({ id }) =>
    browserMetricIds.has(id)
  );
  if (browserMetrics.length !== browserMetricIds.size) {
    throw new Error("Combined benchmark summary requires LCP, JS heap, and renderer private bytes");
  }

  const progressiveRows = new Map(
    progressive.benchmarks.rows.map((row) => [row.caseId, row]),
  );
  const rows = complete.benchmarks.rows.map((completeRow) => {
    const progressiveRow = progressiveRows.get(completeRow.caseId);
    if (progressiveRow === undefined) {
      throw new Error(`Progressive summary is missing ${completeRow.caseId}`);
    }
    return {
      ...completeRow,
      metrics: {
        noStreamingRequestsPerSecond:
          completeRow.metrics.requestsPerSecond,
        streamingRequestsPerSecond:
          progressiveRow.metrics.requestsPerSecond,
        ...Object.fromEntries(
          browserMetrics.map(({ id }) => [id, progressiveRow.metrics[id]]),
        ),
      },
    };
  });
  const metrics = [
    {
      ...completeRps,
      description:
        "Dynamic SSR throughput when each framework sends one fully collected HTML response without progressive boundaries.",
      id: "noStreamingRequestsPerSecond",
      label: "No Streaming RPS",
      selected: true,
    },
    {
      ...progressiveRps,
      description:
        "Dynamic SSR throughput while native progressive or streaming boundaries remain enabled.",
      id: "streamingRequestsPerSecond",
      label: "Streaming RPS",
      selected: false,
    },
    ...browserMetrics.map((metric) => ({ ...metric, selected: false })),
  ];
  const benchmarks = {
    ...progressive.benchmarks,
    description:
      "Compare the same product workload in complete and progressive response modes, then inspect the three browser cost metrics that matter most.",
    hasUnavailable: rows.some(({ metrics: rowMetrics }) =>
      metrics.some(({ id }) => !rowMetrics[id]?.available)
    ),
    methodology: completeRps.methodology,
    metricSummary: completeRps.summary,
    metrics,
    responseMode: "comparison",
    responseModes: ["complete", "progressive"],
    rows,
    saturationWarnings: {
      noStreaming: complete.benchmarks.saturationWarnings,
      streaming: progressive.benchmarks.saturationWarnings,
    },
    selectedMetric: "noStreamingRequestsPerSecond",
    selectedMetricDescription:
      "Dynamic SSR throughput when each framework sends one fully collected HTML response without progressive boundaries.",
    selectedMetricLabel: "No Streaming RPS",
    title: "Complete response or streaming boundaries. Choose the metric.",
  };
  return {
    benchmarks,
    benchmarksJson: JSON.stringify(benchmarks),
  };
}

export function buildBenchmarkSummary(
  report,
  browserReport = null,
  completeReport = null,
) {
  const progressive = buildSingleBenchmarkSummary(report, browserReport);
  if (completeReport === null) {
    return progressive;
  }
  const complete = buildSingleBenchmarkSummary(completeReport);
  if (!matchingResponseModeReports(report, completeReport)) {
    throw new Error(
      "Combined benchmark summary requires matching progressive and complete official reports",
    );
  }
  return combinedBenchmarkSummary(progressive, complete);
}

export async function exportBenchmarkSummary(
  inputPath,
  outputPath,
  browserInputPath = undefined,
  completeInputPath = undefined,
) {
  const report = JSON.parse(await readFile(inputPath, "utf8"));
  const browserReport = browserInputPath === undefined
    ? null
    : JSON.parse(await readFile(browserInputPath, "utf8"));
  const completeReport = completeInputPath === undefined
    ? null
    : JSON.parse(await readFile(completeInputPath, "utf8"));
  const summary = buildBenchmarkSummary(
    report,
    browserReport,
    completeReport,
  );
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return summary;
}

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help")) {
    process.stdout.write(
      "Usage: node scripts/export-benchmark-summary.mjs --input <progressive-report.json> [--complete-input <complete-report.json>] [--browser-input <browser-report.json>] [--output <benchmark-summary.json>]\n",
    );
    return null;
  }
  const input = option(argv, "--input");
  if (input === undefined) {
    throw new Error("--input is required");
  }
  const inputPath = resolve(repositoryRoot, input);
  const browserInput = option(argv, "--browser-input");
  const browserInputPath = browserInput === undefined
    ? undefined
    : resolve(repositoryRoot, browserInput);
  const completeInput = option(argv, "--complete-input");
  const completeInputPath = completeInput === undefined
    ? undefined
    : resolve(repositoryRoot, completeInput);
  const outputPath = resolve(
    repositoryRoot,
    option(argv, "--output") ?? defaultOutputPath,
  );
  await exportBenchmarkSummary(
    inputPath,
    outputPath,
    browserInputPath,
    completeInputPath,
  );
  process.stdout.write(`${outputPath}\n`);
  return outputPath;
}

if (isMainModule(import.meta.url)) {
  await main();
}
