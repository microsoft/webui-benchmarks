// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import {
  PROCESS_METRICS_INTERVAL_MILLISECONDS,
  snapshotProcessMemory,
  startProcessMetrics,
  WINDOWS_PROCESS_METRICS_UNAVAILABLE_REASON,
} from "../lib/metrics.mjs";

test("Windows load measurement never runs synchronous process probes", async () => {
  const metrics = startProcessMetrics(123, { platform: "win32" });
  assert.deepEqual(await metrics.finish(), {
    intervalMilliseconds: PROCESS_METRICS_INTERVAL_MILLISECONDS,
    reason: WINDOWS_PROCESS_METRICS_UNAVAILABLE_REASON,
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
  const result = await metrics.finish();
  assert.equal(result.status, "available");
  assert.ok(result.samples >= 2);
});

test("memory snapshots degrade to unavailable without affecting callers", async () => {
  assert.deepEqual(
    await snapshotProcessMemory(123, {
      read: async () => {
        throw new Error("probe failed");
      },
    }),
    { reason: "probe failed", status: "unavailable" },
  );
});
