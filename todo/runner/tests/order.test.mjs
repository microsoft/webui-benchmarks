// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import { deterministicOrder } from "../lib/order.mjs";

test("round ordering is deterministic, randomized, and non-mutating", () => {
  const cases = Array.from({ length: 12 }, (_, index) => `case-${index}`);
  const original = [...cases];
  const first = deterministicOrder(cases, 3);
  const repeated = deterministicOrder(cases, 3);
  const nextRound = deterministicOrder(cases, 4);

  assert.deepEqual(first, repeated);
  assert.notDeepEqual(first, nextRound);
  assert.deepEqual(cases, original);
  assert.deepEqual([...first].sort(), [...cases].sort());
});
