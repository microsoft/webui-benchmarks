// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export function initialState() {
  const state = globalThis.__TODO_BENCH_INITIAL_STATE__;
  if (state === null || typeof state !== "object") {
    throw new Error("The browser benchmark did not provide initial state");
  }
  return state;
}

export function benchmarkTarget() {
  const target = document.querySelector("#todo-browser-root");
  if (!(target instanceof HTMLElement)) {
    throw new Error("The browser benchmark root is missing");
  }
  return target;
}

function animationFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

export async function publishReady({
  clientMode,
  hydrationReason,
  hydrationResult,
  hydrationStatus,
  startedAt,
}) {
  await animationFrame();
  await animationFrame();
  const readyAtMs = performance.now();
  const settled = hydrationResult?.() ?? {
    reason: hydrationReason,
    status: hydrationStatus,
  };
  const hydration = settled.status === "supported"
    ? {
        durationMs: readyAtMs - startedAt,
        status: "supported",
      }
    : {
        reason: settled.reason,
        status: "unsupported",
      };
  globalThis.__TODO_BENCH_READY__ = Object.freeze({
    clientMode,
    hydration: Object.freeze(hydration),
    readyAtMs,
    status: "ready",
  });
  performance.mark("todo-browser-ready");
  globalThis.dispatchEvent(new CustomEvent("todo-browser-ready"));
}

export function publishFailure(error, clientMode) {
  globalThis.__TODO_BENCH_READY__ = Object.freeze({
    clientMode,
    message: error instanceof Error ? error.message : String(error),
    status: "error",
  });
}
