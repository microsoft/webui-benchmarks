// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import { createCaseMatrix } from "../../runner/lib/cases.mjs";
import {
  assertHydrationGate,
  hydrationGateFailures,
} from "../hydration-gate.mjs";

function successfulRound(productId) {
  const available = { status: "available", unit: "milliseconds", value: 1 };
  return {
    fullHydration: {
      atMs: 10,
      framework: productId,
      status: "hydrated",
    },
    metrics: {
      interactions: {
        evidence: {
          completedBeforeClear: 26,
          initialCompleted: 25,
          initialPending: 75,
          remainingAfterClear: 74,
          selectedSentinel: "todo-0050",
          totalBeforeClear: 100,
        },
        steps: Object.fromEntries(
          [
            "clearCompletedMs",
            "filterAllMs",
            "filterCompletedMs",
            "filterPendingMs",
            "selectSentinelMs",
            "toggleCompletionMs",
          ].map((name) => [name, available]),
        ),
        totalDurationMs: available,
      },
      timings: {
        requestToFullHydrationMs: available,
      },
    },
    productId,
    readiness: {
      hydration: { status: productId.startsWith("webui") ? "deferred" : "supported" },
      status: "ready",
    },
    status: "ok",
  };
}

function successfulReport() {
  return {
    rawRounds: createCaseMatrix().map(({ id }) => successfulRound(id)),
  };
}

test("accepts one hydrated interactive round for every product", () => {
  const report = successfulReport();
  assert.deepEqual(hydrationGateFailures(report), []);
  assert.doesNotThrow(() => assertHydrationGate(report));
});

test("rejects a product without completed interactions", () => {
  const report = successfulReport();
  report.rawRounds[0].metrics.interactions.totalDurationMs = {
    reason: "interaction failed",
    status: "unavailable",
  };
  assert.throws(
    () => assertHydrationGate(report),
    /canonical interaction sequence did not complete/u,
  );
});
