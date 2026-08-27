// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

const benchmarkGlobal = globalThis;

function animationFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function afterInitialPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
}

const startedAt = performance.now();
const componentHydration = (async () => {
  await import("../../apps/webui-fast/browser-entry.js");
  await customElements.whenDefined("todo-app");
  if (benchmarkGlobal.__TODO_BENCH_HYDRATED__?.status === "hydrated") return;
  await new Promise((resolve) => {
    globalThis.addEventListener("todo-bench-hydrated", () => resolve(), {
      once: true,
    });
  });
})();
benchmarkGlobal.__TODO_BENCH_FORCE_HYDRATION__ = () => componentHydration;
await componentHydration;
await afterInitialPaint();
await animationFrame();
await animationFrame();
const readyAtMs = performance.now();
benchmarkGlobal.__TODO_BENCH_READY__ = Object.freeze({
  clientMode: "hydrate",
  hydration: Object.freeze({
    durationMs: benchmarkGlobal.__TODO_BENCH_HYDRATED__?.atMs === undefined
      ? undefined
      : benchmarkGlobal.__TODO_BENCH_HYDRATED__.atMs - startedAt,
    framework: "@microsoft/fast-element 3 declarative hydration",
    status: "supported",
  }),
  readyAtMs,
  status: "ready",
});
performance.mark("todo-browser-ready");
globalThis.dispatchEvent(new CustomEvent("todo-browser-ready"));
