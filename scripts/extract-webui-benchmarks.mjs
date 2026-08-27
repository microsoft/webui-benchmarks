// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isMainModule } from "../todo/servers/lib/cli.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const primaryWebuiCaseId = "webui-rust-actix";
const webuiCaseIdPattern = /^webui(?:-|$)/u;

function objectAt(value, path) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value;
}

function stringAt(value, path) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty string`);
  }
  return value;
}

function metricValue(row, metricId) {
  const value = row.metrics[metricId];
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
  ) {
    return {
      available: false,
      detail: "No supported measurement",
      value: null,
      valueDisplay: "Unavailable",
    };
  }
  return value;
}

function resultDisplay(metric, value) {
  return `${value.valueDisplay}${metric.unit ? ` ${metric.unit}` : ""}`;
}

function metricSummary(rows, metric) {
  const ranked = rows
    .map((row) => ({ row, value: metricValue(row, metric.id) }))
    .filter(({ value }) =>
      value.available === true && Number.isFinite(value.value)
    )
    .sort((left, right) => {
      const difference = metric.direction === "higher"
        ? right.value.value - left.value.value
        : left.value.value - right.value.value;
      return difference === 0
        ? left.row.label.localeCompare(right.row.label)
        : difference;
    });
  const [leader, runnerUp] = ranked;
  if (!leader) {
    return `No WebUI row has an available ${metric.label} measurement.`;
  }
  const best = metric.direction === "higher" ? "highest" : "lowest";
  if (!runnerUp) {
    return `${leader.row.label} records the only available ${metric.label} among WebUI rows at ${resultDisplay(metric, leader.value)}.`;
  }
  if (leader.value.valueDisplay === runnerUp.value.valueDisplay) {
    return `${leader.row.label} and ${runnerUp.row.label} share the ${best} ${metric.label} among WebUI rows at ${resultDisplay(metric, leader.value)}.`;
  }
  const gap = metric.direction === "higher"
    ? leader.value.value - runnerUp.value.value
    : runnerUp.value.value - leader.value.value;
  const comparison = metric.direction === "higher" ? "ahead of" : "below";
  if (runnerUp.value.value > 0 && gap > 0) {
    const percentage = gap / runnerUp.value.value * 100;
    return `${leader.row.label} records the ${best} ${metric.label} among WebUI rows at ${resultDisplay(metric, leader.value)}, ${percentage.toFixed(1)}% ${comparison} ${runnerUp.row.label}.`;
  }
  return `${leader.row.label} records the ${best} ${metric.label} among WebUI rows at ${resultDisplay(metric, leader.value)}; ${runnerUp.row.label} is next at ${resultDisplay(metric, runnerUp.value)}.`;
}

function rankedRows(rows, metric) {
  const ranked = rows.map((row) => ({ ...row }));
  ranked.sort((left, right) => {
    const leftMetric = metricValue(left, metric.id);
    const rightMetric = metricValue(right, metric.id);
    if (leftMetric.available !== rightMetric.available) {
      return leftMetric.available ? -1 : 1;
    }
    if (!leftMetric.available || !rightMetric.available) {
      return left.label.localeCompare(right.label);
    }
    const difference = metric.direction === "higher"
      ? rightMetric.value - leftMetric.value
      : leftMetric.value - rightMetric.value;
    return difference === 0
      ? left.label.localeCompare(right.label)
      : difference;
  });

  const maximum = Math.max(
    0,
    ...ranked
      .map((row) => metricValue(row, metric.id))
      .filter((value) => value.available && Number.isFinite(value.value))
      .map((value) => value.value),
  );
  let previousDisplay = "";
  let displayedRank = 0;
  return ranked.map((row, index) => {
    const active = metricValue(row, metric.id);
    if (active.valueDisplay !== previousDisplay) {
      displayedRank = index + 1;
      previousDisplay = active.valueDisplay;
    }
    const width = active.available
        && Number.isFinite(active.value)
        && active.value > 0
        && maximum > 0
      ? active.value / maximum * 100
      : 0;
    return {
      ...row,
      activeAvailable: active.available === true,
      activeDetail: active.detail,
      activeUnit: active.available === true ? metric.unit : "",
      activeValueDisplay: active.valueDisplay,
      activeWidth: `${width.toFixed(1)}%`,
      rank: String(displayedRank),
    };
  });
}

function webuiDescription(description, count) {
  if (typeof description === "string") {
    const filtered = description.replace(
      /^Compare \d+ product paths\b/u,
      `Compare ${count} WebUI product ${count === 1 ? "path" : "paths"}`,
    );
    if (filtered !== description) {
      return filtered;
    }
  }
  return `Compare ${count} WebUI product ${count === 1 ? "path" : "paths"} across the published benchmark metrics.`;
}

export function buildWebuiBenchmarkSummary(summary, { all = false } = {}) {
  const source = objectAt(summary, "summary");
  const benchmarks = objectAt(source.benchmarks, "summary.benchmarks");
  if (!Array.isArray(benchmarks.rows)) {
    throw new TypeError("summary.benchmarks.rows must be an array");
  }
  if (!Array.isArray(benchmarks.metrics)) {
    throw new TypeError("summary.benchmarks.metrics must be an array");
  }
  const selectedMetricId = stringAt(
    benchmarks.selectedMetric,
    "summary.benchmarks.selectedMetric",
  );
  const webuiRows = benchmarks.rows.filter((candidate, index) => {
    const row = objectAt(candidate, `summary.benchmarks.rows[${index}]`);
    const caseId = stringAt(
      row.caseId,
      `summary.benchmarks.rows[${index}].caseId`,
    );
    stringAt(row.label, `summary.benchmarks.rows[${index}].label`);
    objectAt(row.metrics, `summary.benchmarks.rows[${index}].metrics`);
    return webuiCaseIdPattern.test(caseId);
  });
  const rows = all
    ? webuiRows
    : webuiRows.filter(({ caseId }) => caseId === primaryWebuiCaseId);
  if (rows.length === 0) {
    throw new Error(
      all
        ? "Benchmark summary contains no WebUI rows"
        : `Benchmark summary contains no ${primaryWebuiCaseId} row`,
    );
  }
  const retainedCaseIds = new Set(rows.map(({ caseId }) => caseId));
  const saturationWarnings = Array.isArray(benchmarks.saturationWarnings)
    ? benchmarks.saturationWarnings.filter(
      ({ caseId }) => retainedCaseIds.has(caseId),
    )
    : [];
  const saturationCaveat = saturationWarnings.length === 0
    ? ""
    : ` Fixed-load results for ${
      saturationWarnings.map(({ label }) => label).join(", ")
    } remain lower bounds because their saturation probes were still rising.`;

  const metrics = benchmarks.metrics.map((candidate, index) => {
    const metric = objectAt(
      candidate,
      `summary.benchmarks.metrics[${index}]`,
    );
    const id = stringAt(
      metric.id,
      `summary.benchmarks.metrics[${index}].id`,
    );
    stringAt(metric.label, `summary.benchmarks.metrics[${index}].label`);
    if (metric.direction !== "higher" && metric.direction !== "lower") {
      throw new TypeError(
        `summary.benchmarks.metrics[${index}].direction must be higher or lower`,
      );
    }
    const filteredMetric = {
      ...metric,
      available: rows.some((row) => {
        const value = metricValue(row, id);
        return value.available === true && Number.isFinite(value.value);
      }),
      selected: id === selectedMetricId,
    };
    return {
      ...filteredMetric,
      summary: `${
        metricSummary(rows, filteredMetric)
      }${id === "requestsPerSecond" ? saturationCaveat : ""}`,
    };
  });
  const selectedMetric = metrics.find(({ id }) => id === selectedMetricId);
  if (selectedMetric === undefined) {
    throw new Error(
      `Selected metric ${JSON.stringify(selectedMetricId)} is not defined`,
    );
  }
  const filteredRows = rankedRows(rows, selectedMetric);
  const filteredBenchmarks = {
    ...benchmarks,
    description: webuiDescription(benchmarks.description, filteredRows.length),
    hasUnavailable: filteredRows.some((row) => !row.activeAvailable),
    methodology: selectedMetric.methodology,
    metricSummary: selectedMetric.summary,
    metrics,
    rows: filteredRows,
    saturationWarnings,
    selectedMetricDescription: selectedMetric.description,
    selectedMetricLabel: selectedMetric.label,
  };
  return {
    benchmarks: filteredBenchmarks,
    benchmarksJson: JSON.stringify(filteredBenchmarks),
  };
}

export async function extractWebuiBenchmarks(
  inputPath,
  outputPath,
  options = {},
) {
  const summary = JSON.parse(await readFile(inputPath, "utf8"));
  const filtered = buildWebuiBenchmarkSummary(summary, options);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(filtered, null, 2)}\n`, "utf8");
  return filtered;
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
      "Usage: node scripts/extract-webui-benchmarks.mjs --input <benchmark-summary.json> [--output <webui.json>] [--all]\n",
    );
    return null;
  }
  const input = option(argv, "--input");
  if (input === undefined) {
    throw new Error("--input is required");
  }
  const inputPath = resolve(repositoryRoot, input);
  const output = option(argv, "--output");
  const outputPath = output === undefined
    ? resolve(dirname(inputPath), "webui.json")
    : resolve(repositoryRoot, output);
  await extractWebuiBenchmarks(inputPath, outputPath, {
    all: argv.includes("--all"),
  });
  process.stdout.write(`${outputPath}\n`);
  return outputPath;
}

if (isMainModule(import.meta.url)) {
  await main();
}
