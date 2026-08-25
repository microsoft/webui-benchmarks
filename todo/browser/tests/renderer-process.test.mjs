// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import {
  captureRendererProcessTime,
  selectRendererProcess,
} from "../renderer-process.mjs";

test("attributes the renderer with the largest navigation CPU delta", () => {
  const selected = selectRendererProcess(
    [
      { cpuTime: 1, id: 101, type: "renderer" },
      { cpuTime: 2, id: 202, type: "renderer" },
      { cpuTime: 3, id: 303, type: "browser" },
    ],
    [
      { cpuTime: 1.1, id: 101, type: "renderer" },
      { cpuTime: 2.8, id: 202, type: "renderer" },
      { cpuTime: 3.1, id: 303, type: "browser" },
    ],
  );
  assert.equal(selected.status, "selected");
  assert.equal(selected.pid, 202);
  assert.equal(
    selected.candidates.find(({ pid }) => pid === 202).selected,
    true,
  );
});

test("attributes a renderer created by navigation", () => {
  const selected = selectRendererProcess([], [
    { cpuTime: 0.25, id: 404, type: "renderer" },
  ]);
  assert.equal(selected.status, "selected");
  assert.equal(selected.pid, 404);
  assert.equal(selected.candidates[0].beforeCpuSeconds, null);
});

test("matches the page ProcessTime instead of a busier blank renderer", () => {
  const selected = selectRendererProcess(
    [
      { cpuTime: 0.05, id: 101, type: "renderer" },
      { cpuTime: 0.05, id: 202, type: "renderer" },
    ],
    [
      { cpuTime: 0.44, id: 101, type: "renderer" },
      { cpuTime: 0.18, id: 202, type: "renderer" },
    ],
    0.1801,
  );
  assert.equal(selected.status, "selected");
  assert.equal(selected.pid, 202);
  assert.match(selected.strategy, /ProcessTime/u);
});

test("reports renderer attribution unavailable without positive CPU evidence", () => {
  const selected = selectRendererProcess(
    [{ cpuTime: 1, id: 101, type: "renderer" }],
    [{ cpuTime: 1, id: 101, type: "renderer" }],
  );
  assert.equal(selected.status, "unavailable");
  assert.equal(Object.hasOwn(selected, "pid"), false);
  assert.match(selected.reason, /CPU time/u);
});

test("rejects ProcessTime when no renderer is a close match", () => {
  const unmatched = selectRendererProcess(
    [],
    [
      { cpuTime: 0.4, id: 101, type: "renderer" },
      { cpuTime: 0.5, id: 202, type: "renderer" },
    ],
    0.1,
  );
  assert.equal(unmatched.status, "unavailable");
  assert.match(unmatched.reason, /closely match/u);
});

test("reads the current page renderer ProcessTime metric", async () => {
  const captured = await captureRendererProcessTime({
    async send(command) {
      assert.equal(command, "Performance.getMetrics");
      return {
        metrics: [
          { name: "TaskDuration", value: 1 },
          { name: "ProcessTime", value: 0.25 },
        ],
      };
    },
  });
  assert.deepEqual(captured, {
    source: "page CDP Performance.getMetrics ProcessTime",
    status: "available",
    value: 0.25,
  });
});
