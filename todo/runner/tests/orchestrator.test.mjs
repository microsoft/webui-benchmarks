// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import {
  canSkipUnavailableCase,
  metricsStatus,
  unsupportedReason,
} from "../lib/orchestrator.mjs";

const LOCAL_QUICK = Object.freeze({
  quick: true,
  runtimeMode: "local",
});

test("local quick mode skips only first-round launch unavailability", () => {
  assert.equal(
    canSkipUnavailableCase(LOCAL_QUICK, {
      round: 0,
      serverStarted: false,
    }),
    true,
  );
  assert.equal(
    canSkipUnavailableCase(LOCAL_QUICK, {
      round: 0,
      serverStarted: true,
    }),
    false,
  );
  assert.equal(
    canSkipUnavailableCase(LOCAL_QUICK, {
      round: 1,
      serverStarted: false,
    }),
    false,
  );
});

test("official and non-quick runs fail launch unavailability", () => {
  assert.equal(
    canSkipUnavailableCase(
      { quick: true, runtimeMode: "official" },
      { round: 0, serverStarted: false },
    ),
    false,
  );
  assert.equal(
    canSkipUnavailableCase(
      { quick: false, runtimeMode: "local" },
      { round: 0, serverStarted: false },
    ),
    false,
  );
});

test("unsupported native runtime reports its addon failure", () => {
  assert.equal(
    unsupportedReason(
      {
        addonCapability: {
          code: "native-addon-load-failed",
          message: "Deno could not load the native addon.",
        },
      },
      "generic",
    ),
    "Deno could not load the native addon.",
  );
});

test("unavailable memory telemetry does not invalidate RPS evidence", () => {
  assert.equal(
    metricsStatus({
      latencyP95Status: "histogram-10us",
      loadGenerator: { status: "available" },
      serverMetrics: { status: "unavailable" },
    }),
    "ok",
  );
});
