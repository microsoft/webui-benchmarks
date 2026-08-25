// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import {
  median,
  medianAbsoluteDeviation,
  percentile,
  summarizeResponseByteProfiles,
  summarizeRounds,
  summarizeSeries,
} from "../lib/statistics.mjs";

test("statistics report median, p95, and median absolute deviation", () => {
  assert.equal(median([9, 1, 5]), 5);
  assert.equal(median([9, 1, 5, 3]), 4);
  assert.equal(percentile([1, 2, 3, 4, 5], 0.95), 5);
  assert.equal(medianAbsoluteDeviation([1, 1, 2, 2, 4, 6, 9]), 1);
  assert.deepEqual(summarizeSeries([4, 1, 3, 2]), {
    count: 4,
    mad: 1,
    max: 4,
    median: 2.5,
    min: 1,
    p95: 4,
  });
});

test("round summaries retain all required throughput and latency series", () => {
  const summary = summarizeRounds([
    {
      latencyP50Ms: 1,
      latencyP95Ms: 3,
      requestsPerSecond: 100,
      throughputBytesPerSecond: 1_000,
    },
    {
      latencyP50Ms: 2,
      latencyP95Ms: 5,
      requestsPerSecond: 200,
      throughputBytesPerSecond: 2_000,
    },
  ]);
  assert.equal(summary.requestsPerSecond.median, 150);
  assert.equal(summary.latencyP95Ms.p95, 5);
  assert.equal(summary.throughputBytesPerSecond.mad, 500);
});

test("statistics reject empty and non-finite samples", () => {
  assert.throws(() => median([]), /At least one/);
  assert.throws(() => summarizeSeries([Number.NaN]), /finite/);
  assert.throws(() => percentile([1], 1.1), /between 0 and 1/);
});

test("response-byte summaries derive from every timestamped round", () => {
  const summary = summarizeResponseByteProfiles([
    {
      cachedRouteContract: 50,
      dynamic: { byVariant: [100, 200] },
    },
    {
      cachedRouteContract: 50,
      dynamic: { byVariant: [102, 198] },
    },
    {
      cachedRouteContract: 50,
      dynamic: { byVariant: [101, 202] },
    },
  ]);
  assert.deepEqual(summary, {
    cachedRouteContract: 50,
    dynamic: {
      byVariant: [101, 200],
      maximum: 202,
      mean: 150.5,
      minimum: 100,
    },
  });
});
