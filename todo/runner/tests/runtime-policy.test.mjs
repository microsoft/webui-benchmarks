// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateRuntimePolicy,
  runtimeDecision,
} from "../lib/runtime-policy.mjs";

const mismatch = {
  expectedVersion: "1.2.3",
  installed: true,
  runtimeId: "example",
  version: "1.2.2",
  versionMatches: false,
};

test("local quick mode reports absent or mismatched runtimes as skipped", () => {
  assert.deepEqual(
    runtimeDecision(mismatch, { quick: true, runtimeMode: "local" }),
    {
      code: "runtime-version-mismatch",
      reason: "example expected 1.2.3, observed 1.2.2",
      runtimeId: "example",
      status: "skipped",
    },
  );
  const policy = evaluateRuntimePolicy(
    { runtimes: [mismatch] },
    { quick: true, runtimeMode: "local" },
    ["example"],
  );
  assert.equal(policy.status, "partial");
});

test("official mode fails absent or mismatched pinned runtimes", () => {
  const official = runtimeDecision(mismatch, {
    quick: true,
    runtimeMode: "official",
  });
  assert.equal(official.status, "failed");
  assert.equal(official.code, "runtime-version-mismatch");
});

test("exact runtime pins remain available in every mode", () => {
  const exact = {
    ...mismatch,
    version: "1.2.3",
    versionMatches: true,
  };
  assert.equal(
    runtimeDecision(exact, { quick: false, runtimeMode: "official" }).status,
    "available",
  );
});
