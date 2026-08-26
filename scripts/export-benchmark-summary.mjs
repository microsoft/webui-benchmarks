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
import { createBuildPlan } from "../todo/runner/lib/builds.mjs";
import {
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
} from "./lib/browser-benchmark-summary.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const officialCases = createCaseMatrix();
const officialBuildIds = Object.freeze(
  createBuildPlan(officialCases, { localWebui: false }).map(({ id }) => id),
);
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
  const config = report.config;
  return config?.build === true
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
    && hasExactIds(report.builds, officialBuildIds, ({ id }) => id)
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
  return serverMetrics !== null
    && typeof serverMetrics === "object"
    && !Array.isArray(serverMetrics)
    && Object.keys(serverMetrics).length === 2
    && serverMetrics.status === "unavailable"
    && serverMetrics.reason === WINDOWS_PROCESS_METRICS_UNAVAILABLE_REASON;
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

function hasOnlyWindowsSaturationWarnings(report) {
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
    entry.analysis?.status === "process-metrics-unavailable"
    && entry.analysis.plateauStatus === "saturated"
    && entry.analysis.reason === windowsSaturationReason
    && Number.isFinite(entry.analysis.peakConnections)
    && Number.isFinite(entry.analysis.peakRequestsPerSecond)
    && Array.isArray(entry.samples)
    && entry.samples.length === connections.length
    && entry.samples.every((sample, index) =>
      sample.connections === connections[index]
      && sample.latencyP95Status === "histogram-10us"
      && sample.loadGenerator?.status === "available"
      && isWindowsProcessMetricsUnavailable(sample.serverMetrics)
    )
  );
}

function isDocumentedWindowsPartialReport(report) {
  return report.status === "partial"
    && report.machine?.osPlatform === "win32"
    && report.machine?.processPlatform === "win32"
    && hasGreenRuntimeEvidence(report)
    && report.rawRounds.every((round) =>
      round.metricsStatus === "metrics-unavailable"
      && round.latencyP95Status === "histogram-10us"
      && round.loadGenerator?.status === "available"
      && isWindowsProcessMetricsUnavailable(round.serverMetrics)
    )
    && hasOnlyWindowsSaturationWarnings(report);
}

function isCanonicalOfficialReport(report) {
  return hasCanonicalProtocol(report)
    && report.config?.quick === false
    && report.config?.rounds === 7
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
  return `100 todos · 12 component types · ${variants} warm structural variants · current UTC state materialized per request · ${connections} connections from ${workers} load workers · 1 server process/worker pinned to 1 CPU · ${rounds} × ${duration} s randomized rounds · dynamic SSR · natural bytes`;
}

function renderRows(rows, browserEvidence) {
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
    const detail = `${row.renderer} · ${row.transport} · MAD ${formatNumber(row.madRequestsPerSecond)} req/s · p95 ${formatNumber(row.medianP95LatencyMs)} ms · ${formatNumber(row.minimumResponseBytes)}-${formatNumber(row.maximumResponseBytes)} B natural`;
    const metric = {
      available: true,
      detail,
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

export function buildBenchmarkSummary(report, browserReport = null) {
  assertReportSchema(report);
  if (
    !isCanonicalOfficialReport(report)
    || (
      report.status !== "ok"
      && !isDocumentedWindowsPartialReport(report)
    )
  ) {
    throw new Error(
      "Summary export requires a clean, complete, unfiltered seven-round official report; partial reports are allowed only for documented Windows process telemetry unavailability",
    );
  }
  const browserEvidence = createBrowserSummaryEvidence(report, browserReport);
  const rows = matrixRows(report);
  const summary = winnerStatement(rows);
  const method = methodology(report);
  const benchmarks = {
    description:
      browserEvidence?.description
      ?? "Compare the complete product matrix by single-core server throughput.",
    hasUnavailable: false,
    link: "/webui/guide/concepts/performance/",
    methodology: method,
    metricSummary: summary,
    metrics: [
      {
        available: true,
        description:
          "Median dynamic SSR throughput across seven randomized ten-second rounds.",
        direction: "higher",
        directionLabel: "higher is better",
        id: "requestsPerSecond",
        label: "Single-core RPS",
        methodology: method,
        selected: true,
        summary,
        unit: "req/s",
      },
      ...(browserEvidence?.metrics ?? []),
    ],
    rows: renderRows(rows, browserEvidence),
    selectedMetric: "requestsPerSecond",
    selectedMetricDescription:
      "Median dynamic SSR throughput across seven randomized ten-second rounds.",
    selectedMetricLabel: "Single-core RPS",
    title: "Same workload. Choose the metric.",
  };
  return {
    benchmarks,
    benchmarksJson: JSON.stringify(benchmarks),
  };
}

export async function exportBenchmarkSummary(
  inputPath,
  outputPath,
  browserInputPath = undefined,
) {
  const report = JSON.parse(await readFile(inputPath, "utf8"));
  const browserReport = browserInputPath === undefined
    ? null
    : JSON.parse(await readFile(browserInputPath, "utf8"));
  const summary = buildBenchmarkSummary(report, browserReport);
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
      "Usage: node scripts/export-benchmark-summary.mjs --input <report.json> [--browser-input <browser-report.json>] [--output <benchmark-summary.json>]\n",
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
  const outputPath = resolve(
    repositoryRoot,
    option(argv, "--output") ?? defaultOutputPath,
  );
  await exportBenchmarkSummary(inputPath, outputPath, browserInputPath);
  process.stdout.write(`${outputPath}\n`);
  return outputPath;
}

if (isMainModule(import.meta.url)) {
  await main();
}
