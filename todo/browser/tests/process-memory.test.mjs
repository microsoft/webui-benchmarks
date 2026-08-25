// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import {
  parseLinuxProcStatus,
  parseLinuxSmapsRollup,
  parseMacProcessMemory,
  parseWindowsProcessMemory,
  sampleRendererProcessMemory,
} from "../process-memory.mjs";

test("parses Windows private and working-set bytes", () => {
  assert.deepEqual(parseWindowsProcessMemory("123456,789012"), {
    privateBytes: 123_456,
    workingSetBytes: 789_012,
  });
});

test("parses Linux RSS and private rollup bytes", () => {
  assert.deepEqual(
    parseLinuxProcStatus("Name:\tchrome\nVmRSS:\t 1200 kB\n"),
    { workingSetBytes: 1_228_800 },
  );
  assert.deepEqual(
    parseLinuxSmapsRollup(
      "Private_Clean: 100 kB\nPrivate_Dirty: 250 kB\n"
        + "Private_Hugetlb: 10 kB\n",
    ),
    { privateBytes: 368_640 },
  );
});

test("parses macOS ps RSS kibibytes", () => {
  assert.deepEqual(parseMacProcessMemory("2048\n"), {
    workingSetBytes: 2_097_152,
  });
});

test("unsupported process memory is explicit and never zero-shaped", async () => {
  const sample = await sampleRendererProcessMemory(123, {
    platform: "unsupported-test",
  });
  assert.equal(sample.privateBytes.status, "unavailable");
  assert.equal(sample.workingSetBytes.status, "unavailable");
  assert.equal(Object.hasOwn(sample.privateBytes, "value"), false);
  assert.equal(Object.hasOwn(sample.workingSetBytes, "value"), false);
});
