// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

function assertSamples(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new RangeError("At least one numeric sample is required");
  }
  for (const value of values) {
    if (!Number.isFinite(value)) {
      throw new TypeError("Statistics samples must be finite numbers");
    }
  }
}

function sortedCopy(values) {
  assertSamples(values);
  return [...values].sort((left, right) => left - right);
}

export function median(values) {
  const sorted = sortedCopy(values);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function percentile(values, quantile) {
  if (!Number.isFinite(quantile) || quantile < 0 || quantile > 1) {
    throw new RangeError("quantile must be between 0 and 1");
  }
  const sorted = sortedCopy(values);
  const rank = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return sorted[rank];
}

export function medianAbsoluteDeviation(values) {
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
}

export function summarizeSeries(values) {
  const sorted = sortedCopy(values);
  return Object.freeze({
    count: sorted.length,
    mad: medianAbsoluteDeviation(sorted),
    max: sorted[sorted.length - 1],
    median: median(sorted),
    min: sorted[0],
    p95: percentile(sorted, 0.95),
  });
}

export function summarizeRounds(rounds) {
  if (!Array.isArray(rounds) || rounds.length === 0) {
    throw new RangeError("At least one successful benchmark round is required");
  }
  const memorySamples = rounds
    .map((round) => round.serverMetrics)
    .filter((metrics) =>
      metrics?.status === "available" && Number.isFinite(metrics.peakRssBytes)
    )
    .map((metrics) => metrics.peakRssBytes);
  return Object.freeze({
    latencyP50Ms: summarizeSeries(rounds.map((round) => round.latencyP50Ms)),
    latencyP95Ms: summarizeSeries(rounds.map((round) => round.latencyP95Ms)),
    requestsPerSecond: summarizeSeries(
      rounds.map((round) => round.requestsPerSecond),
    ),
    serverMemory: Object.freeze({
      availableRounds: memorySamples.length,
      peakRssBytes: memorySamples.length === 0
        ? null
        : summarizeSeries(memorySamples),
      status: memorySamples.length === rounds.length
        ? "available"
        : memorySamples.length === 0
          ? "unavailable"
          : "partial",
      unavailableRounds: rounds.length - memorySamples.length,
    }),
    throughputBytesPerSecond: summarizeSeries(
      rounds.map((round) => round.throughputBytesPerSecond),
    ),
  });
}

export function summarizeResponseByteProfiles(profiles) {
  if (!Array.isArray(profiles) || profiles.length === 0) {
    throw new RangeError("At least one response-byte profile is required");
  }
  const variantCount = profiles[0].dynamic.byVariant.length;
  const cachedRouteContract = profiles[0].cachedRouteContract;
  if (
    profiles.some((profile) =>
      profile.cachedRouteContract !== cachedRouteContract
      || profile.dynamic.byVariant.length !== variantCount
    )
  ) {
    throw new Error("Response-byte profiles must share one variant contract");
  }
  const allValues = profiles.flatMap((profile) => profile.dynamic.byVariant);
  assertSamples(allValues);
  const byVariant = Array.from(
    { length: variantCount },
    (_, index) => median(
      profiles.map((profile) => profile.dynamic.byVariant[index]),
    ),
  );
  return Object.freeze({
    cachedRouteContract,
    dynamic: Object.freeze({
      byVariant: Object.freeze(byVariant),
      maximum: Math.max(...allValues),
      mean: allValues.reduce((total, value) => total + value, 0)
        / allValues.length,
      minimum: Math.min(...allValues),
    }),
  });
}
