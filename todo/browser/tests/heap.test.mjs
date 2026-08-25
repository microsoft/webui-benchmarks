// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import { collectStableHeap } from "../measurement.mjs";

test("forces repeated garbage collection before sampling JavaScript heap", async () => {
  const calls = [];
  const heap = await collectStableHeap({
    async send(method) {
      calls.push(method);
      if (method === "Runtime.getHeapUsage") {
        return { totalSize: 2_000, usedSize: 1_000 };
      }
      return {};
    },
  });
  assert.deepEqual(calls, [
    "HeapProfiler.enable",
    "HeapProfiler.collectGarbage",
    "HeapProfiler.collectGarbage",
    "HeapProfiler.collectGarbage",
    "Runtime.getHeapUsage",
  ]);
  assert.equal(heap.status, "available");
  assert.equal(heap.completedPasses, 3);
  assert.equal(heap.usedSize, 1_000);
});

test("does not publish a zero heap when forced GC fails", async () => {
  const heap = await collectStableHeap({
    async send(method) {
      if (method === "HeapProfiler.collectGarbage") {
        throw new Error("unsupported");
      }
      return {};
    },
  });
  assert.equal(heap.status, "unavailable");
  assert.equal(Object.hasOwn(heap, "usedSize"), false);
  assert.match(heap.reason, /garbage collection failed/iu);
});
