// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import {
  BROWSER_REPORT_SCHEMA,
  BROWSER_TIER,
} from "../apps.mjs";
import { METRIC_PATHS } from "../metrics.mjs";
import { validateBrowserReport } from "../schema.mjs";

function unavailableMetrics() {
  const metrics = {};
  for (const path of METRIC_PATHS) {
    const segments = path.split(".");
    let current = metrics;
    for (let index = 0; index < segments.length - 1; index += 1) {
      current[segments[index]] ??= {};
      current = current[segments[index]];
    }
    current[segments.at(-1)] = {
      availableSamples: 0,
      reasons: ["fixture intentionally unavailable"],
      status: "unavailable",
      unavailableSamples: 1,
    };
  }
  return metrics;
}

function reportFixture() {
  return {
    apps: [
      {
        appId: "react",
        frameworkVersions: { react: "19.2.4" },
        headline: false,
        initialStateSource: "browser-wrapper",
        label: "React",
        lazyHydration: {
          reason: "fixture has no native viewport hydration",
          status: "unavailable",
        },
        primaryRoute: "dynamic",
        productId: "react",
        readinessDefinition: "client hydrated",
        routing: {
          clientNavigation: "supported",
          journey: ["/dynamic", "/activity", "/settings", "/dynamic"],
          router: "react-router",
        },
        tier: BROWSER_TIER,
      },
    ],
    browser: { transportProtocol: "h2", version: "Chromium test" },
    fixture: {
      hash: { algorithm: "sha256", value: "a".repeat(64) },
    },
    mode: "quick",
    rawRounds: [
      {
        appId: "react",
        headline: false,
        productId: "react",
        reason: "fixture intentionally unavailable",
        round: 0,
        route: "dynamic",
        status: "unavailable",
      },
    ],
    roundOrder: [["react"]],
    roundsPerApp: 1,
    schema: BROWSER_REPORT_SCHEMA,
    sourceRevision: {
      commit: "b".repeat(40),
      sourceDigest: "a".repeat(64),
      workingTreeDirty: true,
    },
    snapshotIntegrity: { status: "verified" },
    summaries: [{
      appId: "react",
      attemptedRounds: 1,
      metrics: unavailableMetrics(),
      productId: "react",
      status: "unavailable",
      successfulRounds: 0,
    }],
    tier: { headline: false, id: BROWSER_TIER },
    viewport: { height: 900, width: 1_440 },
  };
}

test("accepts an explicit unavailable quick report", () => {
  const validation = validateBrowserReport(reportFixture());
  assert.equal(validation.valid, true, validation.errors.join("\n"));
});

test("accepts an explicit progressive response mode and rejects any other value", () => {
  const explicit = reportFixture();
  explicit.responseMode = "progressive";
  assert.equal(validateBrowserReport(explicit).valid, true);
  const unsupported = reportFixture();
  unsupported.responseMode = "complete";
  const validation = validateBrowserReport(unsupported);
  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.some((error) => error.includes("progressive")),
  );
});

test("rejects browser evidence that could alter headline scoring", () => {
  const report = reportFixture();
  report.apps[0].headline = true;
  report.rawRounds[0].headline = true;
  const validation = validateBrowserReport(report);
  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.some((error) => error.includes("non-headline")),
  );
});

test("rejects unavailable rounds shaped like successful metrics", () => {
  const report = reportFixture();
  report.rawRounds[0].metrics = {};
  const validation = validateBrowserReport(report);
  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.some((error) =>
      error.includes("must not be success-shaped")
    ),
  );
});

test("enforces exactly ten official rounds", () => {
  const report = reportFixture();
  report.mode = "official";
  report.roundsPerApp = 9;
  const validation = validateBrowserReport(report);
  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.some((error) => error.includes("exactly 10")),
  );
});

test("rejects filtered or unavailable official evidence", () => {
  const report = reportFixture();
  report.mode = "official";
  report.roundsPerApp = 10;
  const validation = validateBrowserReport(report);
  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.some((error) =>
      error.includes("complete ordered product matrix")
    ),
  );
  assert.ok(
    validation.errors.some((error) =>
      error.includes("official result must be successful")
    ),
  );
});

test("allows filtered refresh evidence but still requires ten successful rounds", () => {
  const report = reportFixture();
  report.mode = "refresh";
  report.roundsPerApp = 10;
  const validation = validateBrowserReport(report);
  assert.equal(validation.valid, false);
  assert.equal(
    validation.errors.some((error) =>
      error.includes("complete ordered product matrix")
    ),
    false,
  );
  assert.ok(
    validation.errors.some((error) =>
      error.includes("refresh result must be successful")
    ),
  );
});
