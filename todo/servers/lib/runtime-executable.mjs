// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { existsSync, realpathSync } from "node:fs";
import process from "node:process";
import { dirname, resolve } from "node:path";
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
  const packageRoot = resolve(root, "node_modules", runtimeId);
  const fileNames = runtimeId === "bun"
    ? platform === "win32"
      ? ["bun.exe"]
      : ["bun", "bun.exe"]
    : platform === "win32"
      ? ["deno.exe"]
      : ["deno", "deno.exe"];
  const directory = runtimeId === "bun"
    ? resolve(packageRoot, "bin")
    : packageRoot;
  for (const fileName of fileNames) {
    const candidate = resolve(directory, fileName);
    if (existsSync(candidate)) {
      return realpathSync(candidate);
    }
  }
  return runtimeId;
}

export const BENCHMARK_ROOT = benchmarkRoot;
