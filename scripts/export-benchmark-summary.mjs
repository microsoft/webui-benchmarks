// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { OFFICIAL_CASE_COUNT } from "../todo/runner/lib/cases.mjs";
import { assertReportSchema } from "../todo/runner/lib/schema.mjs";
import { isMainModule } from "../todo/servers/lib/cli.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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

function renderRows(rows) {
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
      metrics: { requestsPerSecond: metric },
      primary: row.caseId.startsWith("webui-"),
      rank: String(displayedRank),
    };
  });
}

export function buildBenchmarkSummary(report) {
  assertReportSchema(report);
  if (
    report.status !== "ok"
    || report.config?.quick !== false
    || report.config?.rounds !== 7
    || report.config?.runtimeMode !== "official"
    || report.sourceRevision?.workingTreeDirty !== false
    || report.cases?.length !== OFFICIAL_CASE_COUNT
    || report.cases?.some(({ status }) => status !== "complete")
  ) {
    throw new Error(
      "Summary export requires a clean, complete seven-round official report",
    );
  }
  const rows = matrixRows(report);
  const summary = winnerStatement(rows);
  const method = methodology(report);
  const benchmarks = {
    description:
      "Compare the complete product matrix by single-core server throughput.",
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
    ],
    rows: renderRows(rows),
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

export async function exportBenchmarkSummary(inputPath, outputPath) {
  const report = JSON.parse(await readFile(inputPath, "utf8"));
  const summary = buildBenchmarkSummary(report);
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
      "Usage: node scripts/export-benchmark-summary.mjs --input <report.json> [--output <benchmark-summary.json>]\n",
    );
    return null;
  }
  const input = option(argv, "--input");
  if (input === undefined) {
    throw new Error("--input is required");
  }
  const inputPath = resolve(repositoryRoot, input);
  const outputPath = resolve(
    repositoryRoot,
    option(argv, "--output") ?? defaultOutputPath,
  );
  await exportBenchmarkSummary(inputPath, outputPath);
  process.stdout.write(`${outputPath}\n`);
  return outputPath;
}

if (isMainModule(import.meta.url)) {
  await main();
}
