// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import {
  portableBuildDefinition,
  windowsCommandCandidates,
} from "../lib/builds.mjs";

test("discovers Windows executable and command shims from PATH", () => {
  assert.deepEqual(
    windowsCommandCandidates("pnpm", {
      PATH: "C:\\Tools;D:\\Package Bin",
      PATHEXT: ".EXE;.CMD",
    }),
    [
      "C:\\Tools\\pnpm.EXE",
      "C:\\Tools\\pnpm.CMD",
      "D:\\Package Bin\\pnpm.EXE",
      "D:\\Package Bin\\pnpm.CMD",
    ],
  );
});

test("wraps Windows pnpm shims for managed build processes", () => {
  const definition = Object.freeze({
    args: ["--dir", "todo/apps/next", "build"],
    command: "pnpm.cmd",
    id: "next",
  });
  const portable = portableBuildDefinition(definition, "win32");
  assert.equal(portable.command.endsWith("cmd.exe"), true);
  assert.deepEqual(portable.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.match(
    portable.args[3],
    /^pnpm\.cmd --dir todo\/apps\/next build$/u,
  );
  assert.equal(definition.command, "pnpm.cmd");
});

test("keeps direct executables unchanged", () => {
  const definition = Object.freeze({
    args: ["build"],
    command: "cargo.exe",
    id: "cargo",
  });
  assert.strictEqual(
    portableBuildDefinition(definition, "win32"),
    definition,
  );
  assert.strictEqual(
    portableBuildDefinition(definition, "linux"),
    definition,
  );
});
