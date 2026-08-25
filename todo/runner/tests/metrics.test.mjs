// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import { startProcessMetrics } from "../lib/metrics.mjs";

test("Windows load measurement never runs synchronous process probes", () => {
  const metrics = startProcessMetrics(123, { platform: "win32" });
  assert.deepEqual(metrics.finish(), {
    reason:
      "Windows process sampling is disabled because synchronous PowerShell probes perturb load measurements",
    status: "unavailable",
  });
});

test("injected nonblocking samplers remain testable on Windows", async () => {
  let cpuMilliseconds = 0;
  const metrics = startProcessMetrics(123, {
    intervalMilliseconds: 1,
    platform: "win32",
    read() {
      cpuMilliseconds += 1;
      return { cpuMilliseconds, rssBytes: 1024 };
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const result = metrics.finish();
  assert.equal(result.status, "available");
  assert.ok(result.samples >= 2);
});
