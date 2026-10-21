// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { existsSync, realpathSync } from "node:fs";
import process from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const benchmarkRoot = fileURLToPath(
  new URL("../../../", import.meta.url),
);

export function resolveRuntimeExecutable(
  runtimeId,
  {
    platform = process.platform,
    root = benchmarkRoot,
  } = {},
) {
  if (runtimeId === "node") {
    return process.execPath;
  }
  if (runtimeId !== "bun") {
    throw new RangeError(`Unknown runtime '${runtimeId}'`);
  }
  const directory = resolve(root, "node_modules", "bun", "bin");
  const fileNames = platform === "win32"
    ? ["bun.exe"]
    : ["bun", "bun.exe"];
  for (const fileName of fileNames) {
    const candidate = resolve(directory, fileName);
    if (existsSync(candidate)) {
      return realpathSync(candidate);
    }
  }
  return runtimeId;
}

export const BENCHMARK_ROOT = benchmarkRoot;
