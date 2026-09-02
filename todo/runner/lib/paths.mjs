// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import process from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RUNNER_ROOT = fileURLToPath(new URL("../", import.meta.url));
export const TODO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const BENCHMARK_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const REPOSITORY_ROOT = BENCHMARK_ROOT;
export const BUILD_ROOT = fileURLToPath(
  new URL("../../../target/", import.meta.url),
);
export const BASELINE_ROOT = fileURLToPath(
  new URL("../../../results/", import.meta.url),
);

// Bun's `--compile --bytecode` ahead-of-time build produces one standalone
// executable that both the build plan and the case launcher must agree on.
export function bunServeBinaryPath(platform = process.platform) {
  const extension = platform === "win32" ? ".exe" : "";
  return resolve(BUILD_ROOT, "bun", `webui-bun-serve${extension}`);
}
