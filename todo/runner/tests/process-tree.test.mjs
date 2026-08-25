// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import { ProcessRegistry } from "../lib/process-tree.mjs";

test("process registry stops children once in reverse launch order", async () => {
  const registry = new ProcessRegistry();
  const stopped = [];
  const first = registry.register({
    async stop() {
      stopped.push("first");
    },
  });
  registry.register({
    async stop() {
      stopped.push("second");
    },
  });
  registry.register({
    async stop() {
      stopped.push("third");
    },
  });
  assert.equal(registry.size, 3);
  registry.release(first);
  assert.equal(registry.size, 2);

  await Promise.all([registry.stopAll(), registry.stopAll()]);
  assert.deepEqual(stopped, ["third", "second"]);
  assert.equal(registry.size, 0);
  await registry.stopAll();
  assert.deepEqual(stopped, ["third", "second"]);
});

test("process registry aggregates cleanup failures after trying every child", async () => {
  const registry = new ProcessRegistry();
  const stopped = [];
  registry.register({
    async stop() {
      stopped.push("first");
    },
  });
  registry.register({
    async stop() {
      stopped.push("second");
      throw new Error("cleanup failed");
    },
  });
  await assert.rejects(registry.stopAll(), AggregateError);
  assert.deepEqual(stopped, ["second", "first"]);
});
