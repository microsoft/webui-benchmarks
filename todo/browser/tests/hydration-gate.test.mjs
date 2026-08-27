// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import { createCaseMatrix } from "../../runner/lib/cases.mjs";
import {
  assertHydrationGate,
  hydrationGateFailures,
} from "../hydration-gate.mjs";
import { CANONICAL_INTERACTION_STEP_IDS } from "../interactions.mjs";

function successfulRound(productId) {
  const available = { status: "available", unit: "milliseconds", value: 1 };
  const transferred = { status: "available", unit: "bytes", value: 1 };
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
          activityEvents: 48,
          activitySentinel: "activity-0026",
          activityVisibleAfterFilter: 16,
          initialCompleted: 25,
          initialPending: 75,
          remainingAfterClear: 74,
          selectedSentinel: "todo-0050",
          settingsDensity: "compact",
          settingsSaved: true,
          workItemsAfterReturn: 100,
          totalBeforeClear: 100,
          workspaceArchived: 1,
          workspaceAfterClear: 74,
          workspaceExportRows: 1,
          workspaceFacets: {
            assignment: "unassigned",
            priority: "low",
            status: "pending",
          },
          workspaceFinalResults: 100,
          workspaceSavedViews: 1,
          workspaceSchedule: "weekly",
          workspaceSearchResult: 1,
          workspaceSelectedSentinel: "todo-0050",
          workspaceViews: ["board", "insights"],
        },
        steps: Object.fromEntries(
          CANONICAL_INTERACTION_STEP_IDS.map((name) => [name, available]),
        ),
        totalDurationMs: available,
      },
      javascript: {
        features: {
          exportTransferBytes: transferred,
          insightsTransferBytes: transferred,
          savedViewTransferBytes: transferred,
          scheduleTransferBytes: transferred,
          searchTransferBytes: transferred,
        },
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

test("rejects an eagerly bundled workspace feature", () => {
  const report = successfulReport();
  report.rawRounds[0].metrics.javascript.features.scheduleTransferBytes = {
    status: "available",
    unit: "bytes",
    value: 0,
  };
  assert.throws(
    () => assertHydrationGate(report),
    /Schedule must load a non-empty JavaScript feature chunk/u,
  );
});
