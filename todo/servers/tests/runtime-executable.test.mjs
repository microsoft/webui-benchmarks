// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";
import { resolveRuntimeExecutable } from "../lib/runtime-executable.mjs";

for (const [platform, fileName] of [
  ["linux", "bun"],
  ["darwin", "bun"],
  ["win32", "bun.exe"],
  ["linux", "bun.exe"],
]) {
  test(`resolves pinned ${fileName} package binary on ${platform}`, (t) => {
    const root = mkdtempSync(join(tmpdir(), "webui-runtime-"));
    t.after(() => rmSync(root, { force: true, recursive: true }));
    const directory = join(root, "node_modules", "bun", "bin");
    mkdirSync(directory, { recursive: true });
    const binary = join(directory, fileName);
    writeFileSync(binary, "");

    assert.equal(
      resolveRuntimeExecutable("bun", { platform, root }),
      realpathSync(binary),
    );
  });
}

test("uses Bun from PATH when no package binary is installed", (t) => {
  const root = mkdtempSync(join(tmpdir(), "webui-runtime-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  assert.equal(resolveRuntimeExecutable("bun", { root }), "bun");
});

test("uses the active Node executable", () => {
  assert.equal(resolveRuntimeExecutable("node"), process.execPath);
});

test("rejects unknown JavaScript runtimes", () => {
  assert.throws(
    () => resolveRuntimeExecutable("unsupported"),
    /Unknown runtime 'unsupported'/u,
  );
});
