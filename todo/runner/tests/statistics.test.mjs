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
      serverCpuMillisecondsPerRequest: 2,
      serverMemory: {
        loadDeltaPeakRssBytes: 4_000,
        postSettle: { rssBytes: 12_000, status: "available" },
        postWarmup: { rssBytes: 11_000, status: "available" },
        retainedRssBytes: 2_000,
        startup: { rssBytes: 10_000, status: "available" },
      },
      serverMetrics: { peakRssBytes: 10_000, status: "available" },
      throughputBytesPerSecond: 1_000,
    },
    {
      latencyP50Ms: 2,
      latencyP95Ms: 5,
      requestsPerSecond: 200,
      serverCpuMillisecondsPerRequest: 4,
      serverMemory: {
        loadDeltaPeakRssBytes: 8_000,
        postSettle: { rssBytes: 24_000, status: "available" },
        postWarmup: { rssBytes: 22_000, status: "available" },
        retainedRssBytes: 4_000,
        startup: { rssBytes: 20_000, status: "available" },
      },
      serverMetrics: { peakRssBytes: 20_000, status: "available" },
      throughputBytesPerSecond: 2_000,
    },
  ]);
  assert.equal(summary.requestsPerSecond.median, 150);
  assert.equal(summary.latencyP95Ms.p95, 5);
  assert.equal(summary.throughputBytesPerSecond.mad, 500);
  assert.equal(summary.serverMemory.status, "available");
  assert.equal(summary.serverMemory.peakRssBytes.median, 15_000);
  assert.equal(summary.serverMemory.loadDeltaPeakRssBytes.median, 6_000);
  assert.equal(summary.serverMemory.retainedRssBytes.median, 3_000);
  assert.equal(summary.serverCpuMillisecondsPerRequest.median, 3);
});

test("round summaries disclose unavailable server memory samples", () => {
  const summary = summarizeRounds([
    {
      latencyP50Ms: 1,
      latencyP95Ms: 3,
      requestsPerSecond: 100,
      serverMetrics: { peakRssBytes: 10_000, status: "available" },
      throughputBytesPerSecond: 1_000,
    },
    {
      latencyP50Ms: 2,
      latencyP95Ms: 5,
      requestsPerSecond: 200,
      serverMetrics: { status: "unavailable" },
      throughputBytesPerSecond: 2_000,
    },
  ]);
  assert.deepEqual(summary.serverMemory, {
    availableRounds: 1,
    loadDeltaPeakRssBytes: null,
    peakRssBytes: {
      count: 1,
      mad: 0,
      max: 10_000,
      median: 10_000,
      min: 10_000,
      p95: 10_000,
    },
    postSettleRssBytes: null,
    postWarmupRssBytes: null,
    retainedRssBytes: null,
    startupRssBytes: null,
    status: "partial",
    unavailableRounds: 1,
  });
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
