// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { BASELINE_ROOT } from "./paths.mjs";

export function saveBaseline(report, name) {
  mkdirSync(BASELINE_ROOT, { recursive: true });
  const destination = resolve(BASELINE_ROOT, `ssr-todo-${name}.json`);
  const partial = `${destination}.partial-${process.pid}`;
  writeFileSync(partial, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  rmSync(destination, { force: true });
  renameSync(partial, destination);
  return destination;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

export function renderHumanReport(report) {
  const lines = [
    `Todo SSR benchmark: ${report.status}`,
    `Fixture: ${report.fixture.hash.value}`,
    `Protocol: ${report.config.rounds} rounds, ${report.config.connections} connections, ${report.config.durationSeconds}s`,
    `Matrix: ${report.matrix.id} (${report.matrix.expectedCaseCount} rows, dynamic SSR, natural response bytes, 1 worker per case)`,
    "",
    `${"case".padEnd(20)} ${"renderer".padEnd(64)} ${"transport".padEnd(24)} ${"req/s".padStart(12)} ${"p95 ms".padStart(9)} ${"bytes".padStart(16)}`,
  ];
  for (const summary of report.matrix.summaries) {
    const bytes = summary.responseByteProfile.dynamic;
    lines.push(
      `${summary.caseId.padEnd(20)} ${summary.renderer.padEnd(64)} ${summary.transport.padEnd(24)} ${formatNumber(summary.requestsPerSecond.median).padStart(12)} ${formatNumber(summary.latencyP95Ms.median).padStart(9)} ${`${formatNumber(bytes.minimum)}-${formatNumber(bytes.maximum)}`.padStart(16)}`,
    );
  }
  if (report.matrix.summaries.length === 0) {
    lines.push("(no successful measurements)");
  }
  lines.push("");
  lines.push(
    `Natural response bytes: ${formatNumber(report.matrix.naturalResponseBytes.minimum)}-${formatNumber(report.matrix.naturalResponseBytes.maximum)} across ${report.matrix.naturalResponseBytes.byCase.length} cases`,
  );
  lines.push("");
  const unavailable = report.cases.filter(
    (benchmarkCase) => benchmarkCase.status !== "complete",
  );
  if (unavailable.length > 0) {
    lines.push("Unavailable cases:");
    for (const benchmarkCase of unavailable) {
      lines.push(
        `- ${benchmarkCase.id}: ${benchmarkCase.status} (${benchmarkCase.reason ?? "no reason"})`,
      );
    }
  }
  const saturationWarnings = report.saturation.filter(
    (entry) => entry.analysis.status !== "saturated",
  );
  if (saturationWarnings.length > 0) {
    lines.push("Saturation/measurement warnings:");
    for (const entry of saturationWarnings) {
      lines.push(
        `- ${entry.caseId}: ${entry.analysis.status} (${entry.analysis.reason ?? "review raw sweep"})`,
      );
    }
  }
  const measurementWarnings = [
    ...new Map(
      report.rawRounds
        .filter((round) => round.metricsStatus !== "ok")
        .map((round) => [
          round.caseId,
          `${round.metricsStatus} (server/load-generator metrics are in rawRounds)`,
        ]),
    ),
  ];
  if (measurementWarnings.length > 0) {
    lines.push("Process/load-generator warnings:");
    for (const [caseId, warning] of measurementWarnings) {
      lines.push(`- ${caseId}: ${warning}`);
    }
  }
  return lines.join("\n");
}
