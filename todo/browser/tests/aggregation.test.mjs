// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateAppRounds,
  aggregateMetric,
  availableMetric,
  unavailableMetric,
} from "../metrics.mjs";

test("aggregates median, p95, MAD, and raw samples", () => {
  const result = aggregateMetric(
    [10, 20, 30, 40, 50].map((value) =>
      availableMetric(value, "milliseconds", "test")
    ),
  );
  assert.equal(result.status, "available");
  assert.deepEqual(result.samples, [10, 20, 30, 40, 50]);
  assert.equal(result.statistics.median, 30);
  assert.equal(result.statistics.p95, 50);
  assert.equal(result.statistics.mad, 10);
  assert.equal(result.availableSamples, 5);
});

test("preserves explicit unavailable metrics without zero-shaped data", () => {
  const result = aggregateMetric([
    unavailableMetric(
      "renderer RSS is not exposed",
      "bytes",
      "Chromium CDP",
    ),
    unavailableMetric(
      "renderer RSS is not exposed",
      "bytes",
      "Chromium CDP",
    ),
  ]);
  assert.equal(result.status, "unavailable");
  assert.equal(result.availableSamples, 0);
  assert.deepEqual(result.reasons, ["renderer RSS is not exposed"]);
  assert.equal(Object.hasOwn(result, "statistics"), false);
  assert.equal(Object.hasOwn(result, "samples"), false);
});

test("rejects non-finite available metric values", () => {
  assert.throws(
    () => availableMetric(Number.NaN, "bytes", "test"),
    /finite numbers/u,
  );
});

test("summaries expose external, inline, and total JavaScript bytes", () => {
  const round = (externalBytes, inlineBytes, inlineCount) => ({
    metrics: {
      javascript: {
        externalTransferBytes: availableMetric(
          externalBytes,
          "bytes",
          "test",
        ),
        inlineBytes: availableMetric(inlineBytes, "bytes", "test"),
        inlineCount: availableMetric(inlineCount, "count", "test"),
        transferBytes: availableMetric(
          externalBytes + inlineBytes,
          "bytes",
          "test",
        ),
      },
    },
    status: "ok",
  });
  const summary = aggregateAppRounds([
    round(100, 20, 1),
    round(200, 40, 2),
    { reason: "navigation failed", status: "unavailable" },
  ]);
  assert.equal(
    summary.metrics.javascript.externalTransferBytes.statistics.median,
    150,
  );
  assert.equal(
    summary.metrics.javascript.inlineBytes.statistics.median,
    30,
  );
  assert.equal(
    summary.metrics.javascript.inlineCount.statistics.median,
    1.5,
  );
  assert.equal(
    summary.metrics.javascript.transferBytes.statistics.median,
    180,
  );
  assert.equal(
    summary.metrics.javascript.transferBytes.unavailableSamples,
    1,
  );
});
