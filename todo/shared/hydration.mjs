// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export function publishHydrated(framework) {
  if (
    typeof globalThis.window !== "object"
    || typeof globalThis.performance?.now !== "function"
  ) {
    return null;
  }
  const existing = globalThis.__TODO_BENCH_HYDRATED__;
  if (existing?.status === "hydrated") {
    return existing;
  }
  const detail = Object.freeze({
    atMs: performance.now(),
    framework,
    status: "hydrated",
  });
  globalThis.__TODO_BENCH_HYDRATED__ = detail;
  globalThis.dispatchEvent(
    new CustomEvent("todo-bench-hydrated", { detail }),
  );
  return detail;
}
