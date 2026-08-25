// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import { resolveRuntimeExecutable } from "../lib/runtime-executable.mjs";

test("resolves pinned Bun and Deno package binaries", () => {
  assert.match(resolveRuntimeExecutable("bun"), /bun(?:\.exe)?$/iu);
  assert.match(resolveRuntimeExecutable("deno"), /deno(?:\.exe)?$/iu);
});

test("uses the active Node executable", () => {
  assert.equal(resolveRuntimeExecutable("node"), process.execPath);
});
