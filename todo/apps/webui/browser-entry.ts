// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Router } from "@microsoft/webui-router";

const benchmarkGlobal = globalThis as typeof globalThis & {
  __TODO_BENCH_FORCE_HYDRATION__?: () => Promise<void>;
  __TODO_BENCH_HYDRATED__?: Readonly<{
    atMs: number;
    framework: string;
    status: string;
  }>;
  __TODO_BENCH_READY__?: Readonly<{
    clientMode: string;
    hydration: Readonly<{
      durationMs?: number;
      framework?: string;
      reason?: string;
      status: string;
    }>;
    readyAtMs: number;
    status: string;
  }>;
};

function animationFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function afterInitialPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
}

const startedAt = performance.now();
const componentHydration = (async (): Promise<void> => {
  await import("./component-definitions.js");
  await customElements.whenDefined("todo-app");
  if (benchmarkGlobal.__TODO_BENCH_HYDRATED__?.status === "hydrated") return;
  await new Promise<void>((resolve) => {
    globalThis.addEventListener("todo-bench-hydrated", () => resolve(), {
      once: true,
    });
  });
})();
benchmarkGlobal.__TODO_BENCH_FORCE_HYDRATION__ = () => componentHydration;
await componentHydration;
Router.start({
  loaders: {
    "activity-page": () => import("./src/activity-page/activity-page.js"),
    "settings-page": () => import("./src/settings-page/settings-page.js"),
  },
});
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
    framework: "@microsoft/webui-framework eager root hydration",
    status: "supported",
  }),
  readyAtMs,
  status: "ready",
});
performance.mark("todo-browser-ready");
globalThis.dispatchEvent(new CustomEvent("todo-browser-ready"));
