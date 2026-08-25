// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

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
