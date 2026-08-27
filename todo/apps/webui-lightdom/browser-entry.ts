// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  installInteractionHydration,
  wakeInteractionHydration,
} from "@microsoft/webui-framework/interaction-hydration.js";
import {
  prepareRoutePreload,
  type PreparedRoutePreload,
} from "@microsoft/webui-router/preload.js";

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
    message?: string;
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

const loaders = {
  "activity-page": () => import("./src/activity-page/activity-page.js"),
  "settings-page": () => import("./src/settings-page/settings-page.js"),
};

function waitForHydrated(): Promise<void> {
  if (benchmarkGlobal.__TODO_BENCH_HYDRATED__?.status === "hydrated") {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    globalThis.addEventListener("todo-bench-hydrated", () => resolve(), {
      once: true,
    });
  });
}

let activation: Promise<void> | undefined;
let prepared: PreparedRoutePreload | undefined;
const activate = (): Promise<void> => {
  activation ??= Promise.all([
    import("./component-definitions.js"),
    import("@microsoft/webui-router"),
  ]).then(async ([, { Router }]) => {
    Router.start({ loaders, preload: prepared });
    await waitForHydrated();
  });
  return activation;
};
const disposeHydration = installInteractionHydration({
  load: activate,
  onError(error) {
    prepared?.destroy();
    const message = error instanceof Error ? error.message : String(error);
    benchmarkGlobal.__TODO_BENCH_READY__ = Object.freeze({
      clientMode: "interaction-hydrate",
      hydration: Object.freeze({
        framework:
          "@microsoft/webui-framework interaction-triggered application hydration",
        reason: message,
        status: "error",
      }),
      message,
      readyAtMs: performance.now(),
      status: "error",
    });
  },
});
try {
  prepared = prepareRoutePreload({
    onIntent: () => wakeInteractionHydration(),
  });
} catch (error) {
  disposeHydration();
  throw error;
}
benchmarkGlobal.__TODO_BENCH_FORCE_HYDRATION__ = async () => {
  await wakeInteractionHydration();
  await activate();
};
await afterInitialPaint();
await animationFrame();
await animationFrame();
const readyAtMs = performance.now();
benchmarkGlobal.__TODO_BENCH_READY__ = Object.freeze({
  clientMode: "interaction-hydrate",
  hydration: Object.freeze({
    framework:
      "@microsoft/webui-framework interaction-triggered application hydration",
    status: "deferred",
  }),
  readyAtMs,
  status: "ready",
});
performance.mark("todo-browser-ready");
globalThis.dispatchEvent(new CustomEvent("todo-browser-ready"));
