// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { summarizeSeries } from "../runner/lib/statistics.mjs";

export function availableMetric(value, unit, source) {
  if (!Number.isFinite(value)) {
    throw new TypeError("Available metric values must be finite numbers");
  }
  return Object.freeze({
    source,
    status: "available",
    unit,
    value,
  });
}

export function unavailableMetric(reason, unit, source) {
  if (typeof reason !== "string" || reason.length === 0) {
    throw new TypeError("Unavailable metrics require a reason");
  }
  return Object.freeze({
    reason,
    source,
    status: "unavailable",
    unit,
  });
}

export function metricFromOptional(value, unit, source, reason) {
  return Number.isFinite(value)
    ? availableMetric(value, unit, source)
    : unavailableMetric(reason, unit, source);
}

function metricAt(value, path) {
  let current = value;
  for (const segment of path.split(".")) {
    current = current?.[segment];
  }
  return current;
}

function setAt(target, path, value) {
  const segments = path.split(".");
  let current = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    current[segment] ??= {};
    current = current[segment];
  }
  current[segments.at(-1)] = value;
}

export const METRIC_PATHS = Object.freeze([
  "document.responseBytes",
  "document.sourceSsrResponseBytes",
  "javascript.externalTransferBytes",
  "javascript.inlineBytes",
  "javascript.inlineCount",
  "javascript.transferBytes",
  "javascript.requestCount",
  "timings.domContentLoadedMs",
  "timings.browserPreRequestMs",
  "timings.firstContentfulPaintMs",
  "timings.firstContentfulPaintAfterResponseMs",
  "timings.frameworkFirstByteMs",
  "timings.fullHydrationMs",
  "timings.largestContentfulPaintMs",
  "timings.loadMs",
  "timings.responseDownloadMs",
  "timings.requestToFirstByteMs",
  "timings.requestToFullHydrationMs",
  "timings.responseStartToFullHydrationMs",
  "timings.readinessMs",
  "timings.hydrationMs",
  "timings.timeToFirstByteMs",
  "longTasks.count",
  "longTasks.totalDurationMs",
  "longTasks.maximumDurationMs",
  "dom.retainedNodeCount",
  "dom.shadowRootCount",
  "dom.liveElementCount",
  "dom.documentCount",
  "dom.eventListenerCount",
  "memory.jsHeapUsedBytes",
  "memory.jsHeapTotalBytes",
  "memory.jsHeapRetainedDeltaBytes",
  "memory.rendererBytes",
  "memory.rendererPrivateBytes",
  "memory.rendererWorkingSetBytes",
  "interactions.totalDurationMs",
  "interactions.steps.filterPendingMs",
  "interactions.steps.filterCompletedMs",
  "interactions.steps.filterAllMs",
  "interactions.steps.selectSentinelMs",
  "interactions.steps.toggleCompletionMs",
  "interactions.steps.clearCompletedMs",
]);

export function aggregateMetric(metrics) {
  const available = metrics.filter((metric) => metric?.status === "available");
  const unavailable = metrics.filter(
    (metric) => metric?.status === "unavailable",
  );
  if (available.length === 0) {
    const reasons = [
      ...new Set(
        unavailable.map(({ reason }) => reason).filter(
          (reason) => typeof reason === "string",
        ),
      ),
    ];
    return Object.freeze({
      availableSamples: 0,
      reasons: Object.freeze(
        reasons.length === 0 ? ["No successful samples"] : reasons,
      ),
      status: "unavailable",
      unavailableSamples: unavailable.length,
    });
  }
  const units = new Set(available.map(({ unit }) => unit));
  if (units.size !== 1) {
    throw new Error("Cannot aggregate metrics with different units");
  }
  const values = available.map(({ value }) => value);
  return Object.freeze({
    availableSamples: available.length,
    samples: Object.freeze(values),
    statistics: summarizeSeries(values),
    status: "available",
    unavailableSamples: unavailable.length,
    unit: available[0].unit,
  });
}

export function aggregateAppRounds(rounds) {
  const successful = rounds.filter((round) => round.status === "ok");
  const metrics = {};
  for (const path of METRIC_PATHS) {
    setAt(
      metrics,
      path,
      aggregateMetric(
        rounds.map((round) =>
          round.status === "ok"
            ? metricAt(round.metrics, path)
            : {
                reason: round.reason ?? "Browser measurement failed",
                status: "unavailable",
              }
        ),
      ),
    );
  }
  const unavailableReasons = [
    ...new Set(
      rounds
        .filter((round) => round.status !== "ok")
        .map((round) => round.reason),
    ),
  ];
  return Object.freeze({
    attemptedRounds: rounds.length,
    metrics: Object.freeze(metrics),
    status: successful.length === 0 ? "unavailable" : "ok",
    successfulRounds: successful.length,
    unavailableReasons: Object.freeze(unavailableReasons),
  });
}

export { metricAt };
