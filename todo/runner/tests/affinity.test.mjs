// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import { applyProcessAffinity } from "../lib/affinity.mjs";

test("affinity applies one equal Linux CPU to a server process", () => {
  const calls = [];
  const result = applyProcessAffinity(123, 2, {
    cpuCount: 8,
    platform: "linux",
    run(command, args) {
      calls.push({ args, command });
      return { status: 0 };
    },
  });
  assert.deepEqual(result, { cpuIndex: 2, status: "applied" });
  assert.deepEqual(calls, [{
    args: ["--all-tasks", "--cpu-list", "--pid", "2", "123"],
    command: "taskset",
  }]);
});

test("affinity reserves a contiguous Linux CPU range when coreCount > 1", () => {
  const calls = [];
  const result = applyProcessAffinity(123, 4, {
    coreCount: 2,
    cpuCount: 8,
    platform: "linux",
    run(command, args) {
      calls.push({ args, command });
      return { status: 0 };
    },
  });
  assert.deepEqual(result, { coreCount: 2, cpuIndex: 4, status: "applied" });
  assert.deepEqual(calls, [{
    args: ["--all-tasks", "--cpu-list", "--pid", "4-5", "123"],
    command: "taskset",
  }]);
});

test("affinity reserves a contiguous Windows CPU mask when coreCount > 1", () => {
  const calls = [];
  const result = applyProcessAffinity(123, 4, {
    coreCount: 2,
    cpuCount: 8,
    platform: "win32",
    run(command, args) {
      calls.push({ args, command });
      return { status: 0 };
    },
  });
  assert.deepEqual(result, { coreCount: 2, cpuIndex: 4, status: "applied" });
  assert.equal(calls.length, 1);
  assert.match(calls[0].args.at(-1), /\(\(1L -shl 2\) - 1L\) -shl 4/);
});

test("affinity rejects a coreCount range that would not fit on the machine", () => {
  assert.throws(
    () =>
      applyProcessAffinity(123, 7, {
        coreCount: 2,
        cpuCount: 8,
        platform: "linux",
      }),
    /between 0 and 7/,
  );
  assert.throws(
    () =>
      applyProcessAffinity(123, 0, {
        coreCount: 0,
        cpuCount: 8,
        platform: "linux",
      }),
    /positive integer/,
  );
});

test("affinity explicitly reports unsupported platforms and command failure", () => {
  assert.equal(
    applyProcessAffinity(123, 0, {
      cpuCount: 8,
      platform: "darwin",
    }).status,
    "unavailable",
  );
  assert.equal(
    applyProcessAffinity(123, 0, {
      cpuCount: 8,
      platform: "linux",
      run() {
        return { status: 1, stderr: "permission denied" };
      },
    }).status,
    "unavailable",
  );
  assert.throws(
    () =>
      applyProcessAffinity(123, 8, {
        cpuCount: 8,
        platform: "linux",
      }),
    /between 0 and 7/,
  );
});
