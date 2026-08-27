// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  availableMetric,
  metricFromOptional,
  unavailableMetric,
} from "./metrics.mjs";
import {
  CANONICAL_INTERACTION_STEP_IDS,
  executeTodoInteractionSequence,
} from "./interactions.mjs";
import { sampleRendererProcessMemory } from "./process-memory.mjs";
import {
  captureProcessInfo,
  captureRendererProcessTime,
  selectRendererProcess,
} from "./renderer-process.mjs";
import { collectHtmlObservation } from "../shared/observation.mjs";
import {
  TODO_STATE_VARIANTS,
  createRequestTodoState,
} from "../shared/state.mjs";
import { assertValidObservation } from "../shared/validator.mjs";

const JAVASCRIPT_MIME_TYPES = new Set([
  "application/ecmascript",
  "application/javascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript",
  "text/x-ecmascript",
  "text/x-javascript",
]);

export function installPerformanceObservers() {
  globalThis.__TODO_BENCH_QUERY_ALL__ = (selector) => {
    const matches = [];
    const roots = [document];
    for (let index = 0; index < roots.length; index++) {
      const root = roots[index];
      matches.push(...root.querySelectorAll(selector));
      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot !== null) roots.push(element.shadowRoot);
      }
    }
    return matches;
  };
  const supported = new Set(PerformanceObserver.supportedEntryTypes ?? []);
  const store = {
    firstContentfulPaint: [],
    installedAtMs: performance.now(),
    largestContentfulPaint: [],
    longTasks: [],
    observers: {},
    support: {
      firstContentfulPaint: supported.has("paint"),
      largestContentfulPaint: supported.has("largest-contentful-paint"),
      longTasks: supported.has("longtask"),
    },
  };
  globalThis.__TODO_BENCH_PERFORMANCE__ = store;
  if (store.support.firstContentfulPaint) {
    const observer = new PerformanceObserver((list) => {
      store.firstContentfulPaint.push(
        ...list.getEntries().filter(
          ({ name }) => name === "first-contentful-paint",
        ),
      );
    });
    observer.observe({ buffered: true, type: "paint" });
    store.observers.paint = observer;
  }

  if (store.support.largestContentfulPaint) {
    const observer = new PerformanceObserver((list) => {
      store.largestContentfulPaint.push(...list.getEntries());
    });
    observer.observe({ buffered: true, type: "largest-contentful-paint" });
    store.observers.largestContentfulPaint = observer;
  }
  if (store.support.longTasks) {
    const observer = new PerformanceObserver((list) => {
      store.longTasks.push(...list.getEntries());
    });
    observer.observe({ buffered: true, type: "longtask" });
  }
}

export async function createObservedPage(context) {
  await context.addInitScript(installPerformanceObservers);
  return context.newPage();
}

export async function warmHeadedCompositor(page, headless) {
  if (headless) return;
  await page.bringToFront();
  await page.evaluate(() =>
    new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    })
  );
}

class NetworkCollector {
  #resources = new Map();

  constructor(session) {
    session.on("Network.responseReceived", ({ requestId, response, type }) => {
      this.#resources.set(requestId, {
        encodedDataLength: response.encodedDataLength,
        mimeType: response.mimeType,
        resourceType: type,
        transferBytes: null,
        url: response.url,
      });
    });
    session.on(
      "Network.loadingFinished",
      ({ encodedDataLength, requestId }) => {
        const resource = this.#resources.get(requestId);
        if (resource !== undefined) {
          resource.transferBytes = encodedDataLength;
        }
      },
    );
  }

  javascript() {
    const assets = [...this.#resources.values()]
      .filter(
        ({ mimeType, resourceType }) =>
          resourceType === "Script"
          || mimeType.includes("javascript")
          || mimeType.includes("ecmascript"),
      )
      .map((resource) =>
        Object.freeze({
          mimeType: resource.mimeType,
          transferBytes:
            resource.transferBytes ?? resource.encodedDataLength ?? 0,
          url: resource.url,
        })
      );
    return Object.freeze({
      assets: Object.freeze(assets),
      externalTransferBytes: assets.reduce(
        (total, asset) => total + asset.transferBytes,
        0,
      ),
      requestCount: assets.length,
    });
  }
}

function executableInlineScript({ hasSource, noModule, type }) {
  if (hasSource) {
    return false;
  }
  const essence = String(type ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (essence === "module") {
    return true;
  }
  if (noModule) {
    return false;
  }
  return essence.length === 0 || JAVASCRIPT_MIME_TYPES.has(essence);
}

export function summarizeInlineJavascript(scripts) {
  if (!Array.isArray(scripts)) {
    throw new TypeError("Inline JavaScript input must be an array");
  }
  const encoder = new TextEncoder();
  let bytes = 0;
  let count = 0;
  for (const script of scripts) {
    if (!executableInlineScript(script)) {
      continue;
    }
    bytes += encoder.encode(String(script.text ?? "")).byteLength;
    count += 1;
  }
  return Object.freeze({ bytes, count });
}

async function captureInlineJavascript(page) {
  const scripts = await page.locator("script").evaluateAll((elements) =>
    elements.map((element) => ({
      hasSource: element.hasAttribute("src"),
      noModule: element.noModule,
      text: element.text,
      type: element.getAttribute("type"),
    }))
  );
  return summarizeInlineJavascript(scripts);
}

function readableError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function waitForLargestContentfulPaint(page) {
  let previous = -1;
  let stableIterations = 0;
  for (let iteration = 0; iteration < 20; iteration += 1) {
    await page.waitForTimeout(50);
    const count = await page.evaluate(
      () =>
        globalThis.__TODO_BENCH_PERFORMANCE__?.largestContentfulPaint
          ?.length ?? 0,
    );
    if (count === previous) {
      stableIterations += 1;
      if (stableIterations >= 4) {
        return;
      }
    } else {
      previous = count;
      stableIterations = 0;
    }
  }
}

async function twoFrames(page) {
  return page.evaluate(async () => {
    const frame = () =>
      new Promise((resolve) => requestAnimationFrame(resolve));
    await frame();
    await frame();
    return performance.now();
  });
}

async function finalizePreInteractionPaint(page) {
  const framesCompletedAtMs = await twoFrames(page);
  await waitForLargestContentfulPaint(page);
  return page.evaluate((framesAtMs) => {
    const store = globalThis.__TODO_BENCH_PERFORMANCE__;
    const pendingPaint = store?.observers?.paint?.takeRecords?.() ?? [];
    store?.firstContentfulPaint?.push(
      ...pendingPaint.filter(
        ({ name }) => name === "first-contentful-paint",
      ),
    );
    const pendingLcp =
      store?.observers?.largestContentfulPaint?.takeRecords?.() ?? [];
    store?.largestContentfulPaint?.push(...pendingLcp);
    const valid = (entry) =>
      Number.isFinite(entry?.startTime) && entry.startTime >= 0;
    const describeElement = (element) => {
      if (!(element instanceof Element)) {
        return null;
      }
      const className = typeof element.className === "string"
        ? element.className
        : element.className?.baseVal ?? "";
      return {
        className: className.slice(0, 256),
        id: element.id || null,
        tagName: element.tagName.toLowerCase(),
      };
    };
    const firstContentfulPaint =
      store?.firstContentfulPaint?.find(valid) ?? null;
    const largestContentfulPaint =
      store?.largestContentfulPaint?.filter(valid).at(-1) ?? null;
    return {
      finalizedAtMs: performance.now(),
      firstContentfulPaint: firstContentfulPaint === null
        ? null
        : { startTime: firstContentfulPaint.startTime },
      framesCompletedAtMs: framesAtMs,
      installedAtMs: store?.installedAtMs,
      largestContentfulPaint: largestContentfulPaint === null
        ? null
        : {
            element: describeElement(largestContentfulPaint.element),
            size: Number.isFinite(largestContentfulPaint.size)
              ? largestContentfulPaint.size
              : null,
            startTime: largestContentfulPaint.startTime,
            url: largestContentfulPaint.url || null,
          },
      support: store?.support,
    };
  }, framesCompletedAtMs);
}

async function waitForReadiness(page, browserCase) {
  if (browserCase.controlled) {
    await page.waitForFunction(
      () =>
        globalThis.__TODO_BENCH_READY__?.status === "ready"
        || globalThis.__TODO_BENCH_READY__?.status === "error",
      undefined,
      { timeout: 30_000 },
    );
    const readiness = await page.evaluate(
      () => globalThis.__TODO_BENCH_READY__,
    );
    if (readiness.status !== "ready") {
      throw new Error(
        `${browserCase.appId} client readiness failed: ${readiness.message}`,
      );
    }
    return readiness;
  }
  await page.waitForLoadState("load", { timeout: 30_000 });
  await page.waitForFunction(
    () =>
      globalThis.__TODO_BENCH_QUERY_ALL__(
        ".todo-item[data-todo-id]",
      ).length === 100
      && globalThis.__TODO_BENCH_QUERY_ALL__(
        '.todo-filter[data-action="filter"]',
      ).length === 3
      && globalThis.__TODO_BENCH_QUERY_ALL__(
        '.todo-button[data-action="clear-completed"]',
      ).length === 1,
    undefined,
    { timeout: 30_000 },
  );
  if (browserCase.clientMode === "framework-island-hydrate") {
    await page.waitForFunction(
      () => {
        const islands = document.querySelectorAll("astro-island");
        if (islands.length === 0) return false;
        return Array.from(islands).every((island) =>
          !island.hasAttribute("ssr")
        );
      },
      undefined,
      { timeout: 30_000 },
    );
  }
  return Object.freeze({
    clientMode: browserCase.clientMode,
    hydration: browserCase.hydration,
    readyAtMs: await twoFrames(page),
    status: "ready",
  });
}

async function waitForFullHydration(page, browserCase) {
  if (browserCase.appId === "webui") {
    await page.evaluate(async () => {
      const force = globalThis.__TODO_BENCH_FORCE_HYDRATION__;
      if (typeof force !== "function") {
        throw new Error("WebUI did not expose its hydration trigger");
      }
      await force();
    });
  }
  await page.waitForFunction(
    () => globalThis.__TODO_BENCH_HYDRATED__?.status === "hydrated",
    undefined,
    { timeout: 30_000 },
  );
  const hydration = await page.evaluate(
    () => globalThis.__TODO_BENCH_HYDRATED__,
  );
  if (
    hydration?.status !== "hydrated"
    || !Number.isFinite(hydration.atMs)
  ) {
    throw new Error(`${browserCase.appId} did not publish full hydration`);
  }
  return hydration;
}

async function capturePageTimings(page, readiness, hydration, paint) {
  return page.evaluate(({ fullHydration, observedPaint, ready }) => {
    const navigation = performance.getEntriesByType("navigation")[0];
    const store = globalThis.__TODO_BENCH_PERFORMANCE__;
    const longTasks = store?.longTasks ?? [];
    return {
      domContentLoadedMs: navigation?.domContentLoadedEventEnd,
      firstContentfulPaintMs: observedPaint.firstContentfulPaint?.startTime,
      fullHydrationMs: fullHydration.atMs,
      largestContentfulPaintMs:
        observedPaint.largestContentfulPaint?.startTime,
      loadMs: navigation?.loadEventEnd,
      nextHopProtocol: navigation?.nextHopProtocol,
      longTasks: {
        count: longTasks.length,
        maximumDurationMs: longTasks.reduce(
          (maximum, entry) => Math.max(maximum, entry.duration),
          0,
        ),
        supported: store?.support?.longTasks === true,
        totalDurationMs: longTasks.reduce(
          (total, entry) => total + entry.duration,
          0,
        ),
      },
      readinessMs: ready.readyAtMs,
      requestStartMs: navigation?.requestStart,
      responseEndMs: navigation?.responseEnd,
      responseStartMs: navigation?.responseStart,
      serverTiming: Array.from(
        navigation?.serverTiming ?? [],
        ({ description, duration, name }) => ({
          description,
          duration,
          name,
        }),
      ),
    };
  }, {
    fullHydration: hydration,
    observedPaint: paint,
    ready: readiness,
  });
}

export async function collectStableHeap(session, garbageCollectionPasses = 3) {
  const evidence = {
    completedPasses: 0,
    requestedPasses: garbageCollectionPasses,
  };
  try {
    await session.send("HeapProfiler.enable");
    for (let pass = 0; pass < garbageCollectionPasses; pass += 1) {
      await session.send("HeapProfiler.collectGarbage");
      evidence.completedPasses += 1;
    }
  } catch (error) {
    return Object.freeze({
      ...evidence,
      reason: `Forced garbage collection failed: ${readableError(error)}`,
      status: "unavailable",
    });
  }
  try {
    const heap = await session.send("Runtime.getHeapUsage");
    return Object.freeze({
      ...evidence,
      source: "CDP Runtime.getHeapUsage after forced GC",
      status: "available",
      totalSize: heap.totalSize,
      usedSize: heap.usedSize,
    });
  } catch (runtimeError) {
    try {
      const result = await session.send("Performance.getMetrics");
      const values = new Map(
        result.metrics.map(({ name, value }) => [name, value]),
      );
      const usedSize = values.get("JSHeapUsedSize");
      const totalSize = values.get("JSHeapTotalSize");
      if (!Number.isFinite(usedSize) || !Number.isFinite(totalSize)) {
        throw new Error("Performance metrics omitted JavaScript heap sizes");
      }
      return Object.freeze({
        ...evidence,
        source: "CDP Performance.getMetrics after forced GC",
        status: "available",
        totalSize,
        usedSize,
      });
    } catch (performanceError) {
      return Object.freeze({
        ...evidence,
        reason:
          `Runtime.getHeapUsage failed: ${readableError(runtimeError)}; `
          + `Performance.getMetrics failed: ${readableError(performanceError)}`,
        status: "unavailable",
      });
    }
  }
}

function unavailableProcessMemory(reason) {
  const metric = Object.freeze({ reason, status: "unavailable" });
  return Object.freeze({
    method: "renderer PID selection",
    pid: null,
    platform: process.platform,
    privateBytes: metric,
    workingSetBytes: metric,
  });
}

async function captureMemory(page, session, rendererSelection) {
  let dom;
  const heap = await collectStableHeap(session);
  try {
    dom = await session.send("Memory.getDOMCounters");
  } catch {
    dom = null;
  }
  const pageMemory = await page.evaluate(async () => {
    const allElements = globalThis.__TODO_BENCH_QUERY_ALL__("*");
    const liveElementCount = allElements.length;
    const shadowRootCount = allElements.filter(
      (element) => element.shadowRoot !== null,
    ).length;
    if (typeof performance.measureUserAgentSpecificMemory !== "function") {
      return {
        liveElementCount,
        shadowRootCount,
        rendererMemory: {
          reason:
            "performance.measureUserAgentSpecificMemory is not exposed in this Chromium context",
          status: "unavailable",
        },
      };
    }
    try {
      const timeout = new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("memory measurement timed out")),
          2_000,
        );
      });
      const measured = await Promise.race([
        performance.measureUserAgentSpecificMemory(),
        timeout,
      ]);
      return {
        liveElementCount,
        shadowRootCount,
        rendererMemory: {
          bytes: measured.bytes,
          status: "available",
        },
      };
    } catch (error) {
      return {
        liveElementCount,
        shadowRootCount,
        rendererMemory: {
          reason: error instanceof Error ? error.message : String(error),
          status: "unavailable",
        },
      };
    }
  });
  const processMemory = rendererSelection.status === "selected"
    ? await sampleRendererProcessMemory(rendererSelection.pid)
    : unavailableProcessMemory(rendererSelection.reason);
  return Object.freeze({ dom, heap, pageMemory, processMemory });
}

function timingMetrics(raw, readiness) {
  const navigationReason =
    "PerformanceNavigationTiming did not expose the event";
  const paintReason = "Chromium did not produce this paint entry";
  const hydration = readiness.hydration?.status === "supported"
    && Number.isFinite(readiness.hydration.durationMs)
    ? availableMetric(
        readiness.hydration.durationMs,
        "milliseconds",
        "client readiness signal",
      )
    : unavailableMetric(
        readiness.hydration?.reason
          ?? "The framework exposes no stable hydration-complete timestamp",
        "milliseconds",
        "declared app capability",
      );
  const adapterBackendHeaders = raw.serverTiming.find(
    ({ name }) => name === "browser-backend-headers",
  )?.duration;
  const controlledRender = raw.serverTiming.find(
    ({ name }) => name === "browser-render",
  )?.duration;
  const requestToFirstByte = Number.isFinite(raw.requestStartMs)
      && Number.isFinite(raw.responseStartMs)
    ? raw.responseStartMs - raw.requestStartMs
    : undefined;
  const frameworkFirstByte = Number.isFinite(controlledRender)
    ? controlledRender
    : Number.isFinite(adapterBackendHeaders)
      ? adapterBackendHeaders
      : requestToFirstByte;
  return Object.freeze({
    browserPreRequestMs: metricFromOptional(
      raw.requestStartMs,
      "milliseconds",
      "PerformanceNavigationTiming.requestStart",
      navigationReason,
    ),
    domContentLoadedMs: metricFromOptional(
      raw.domContentLoadedMs,
      "milliseconds",
      "PerformanceNavigationTiming.domContentLoadedEventEnd",
      navigationReason,
    ),
    firstContentfulPaintMs: metricFromOptional(
      raw.firstContentfulPaintMs,
      "milliseconds",
      "buffered PerformanceObserver first-contentful-paint",
      paintReason,
    ),
    frameworkFirstByteMs: metricFromOptional(
      frameworkFirstByte,
      "milliseconds",
      Number.isFinite(controlledRender)
        ? "Server-Timing browser-render for an in-process controlled renderer"
        : Number.isFinite(adapterBackendHeaders)
          ? "Server-Timing browser-backend-headers; excludes the controlled document adapter"
          : "PerformanceNavigationTiming.responseStart - requestStart on the direct framework server",
      navigationReason,
    ),
    fullHydrationMs: metricFromOptional(
      raw.fullHydrationMs,
      "milliseconds",
      "framework-authored hydration completion signal",
      "The framework did not publish a hydration completion timestamp",
    ),
    hydrationMs: hydration,
    largestContentfulPaintMs: metricFromOptional(
      raw.largestContentfulPaintMs,
      "milliseconds",
      "pre-interaction buffered LargestContentfulPaint.startTime",
      paintReason,
    ),
    loadMs: metricFromOptional(
      raw.loadMs,
      "milliseconds",
      "PerformanceNavigationTiming.loadEventEnd",
      navigationReason,
    ),
    responseDownloadMs: metricFromOptional(
      Number.isFinite(raw.responseStartMs) && Number.isFinite(raw.responseEndMs)
        ? raw.responseEndMs - raw.responseStartMs
        : undefined,
      "milliseconds",
      "PerformanceNavigationTiming.responseEnd - responseStart",
      navigationReason,
    ),
    requestToFirstByteMs: metricFromOptional(
      requestToFirstByte,
      "milliseconds",
      "PerformanceNavigationTiming.responseStart - requestStart",
      navigationReason,
    ),
    requestToFullHydrationMs: metricFromOptional(
      Number.isFinite(raw.fullHydrationMs)
          && Number.isFinite(raw.requestStartMs)
        ? raw.fullHydrationMs - raw.requestStartMs
        : undefined,
      "milliseconds",
      "framework hydration completion - PerformanceNavigationTiming.requestStart",
      navigationReason,
    ),
    responseStartToFullHydrationMs: metricFromOptional(
      Number.isFinite(raw.fullHydrationMs)
          && Number.isFinite(raw.responseStartMs)
        ? raw.fullHydrationMs - raw.responseStartMs
        : undefined,
      "milliseconds",
      "framework hydration completion - PerformanceNavigationTiming.responseStart",
      navigationReason,
    ),
    firstContentfulPaintAfterResponseMs: metricFromOptional(
      Number.isFinite(raw.firstContentfulPaintMs)
        && Number.isFinite(raw.responseStartMs)
        ? raw.firstContentfulPaintMs - raw.responseStartMs
        : undefined,
      "milliseconds",
      "first-contentful-paint - PerformanceNavigationTiming.responseStart",
      paintReason,
    ),
    readinessMs: availableMetric(
      raw.readinessMs,
      "milliseconds",
      "app readiness definition",
    ),
    timeToFirstByteMs: metricFromOptional(
      raw.responseStartMs,
      "milliseconds",
      "PerformanceNavigationTiming.responseStart",
      navigationReason,
    ),
  });
}

function longTaskMetrics(raw) {
  if (!raw.supported) {
    const unavailable = (name) =>
      unavailableMetric(
        "Chromium does not expose the Long Tasks API",
        name === "count" ? "count" : "milliseconds",
        "PerformanceObserver.longtask",
      );
    return Object.freeze({
      count: unavailable("count"),
      maximumDurationMs: unavailable("duration"),
      totalDurationMs: unavailable("duration"),
    });
  }
  return Object.freeze({
    count: availableMetric(
      raw.count,
      "count",
      "PerformanceObserver.longtask",
    ),
    maximumDurationMs: availableMetric(
      raw.maximumDurationMs,
      "milliseconds",
      "PerformanceObserver.longtask",
    ),
    totalDurationMs: availableMetric(
      raw.totalDurationMs,
      "milliseconds",
      "PerformanceObserver.longtask",
    ),
  });
}

function memoryMetrics(memory) {
  const heapReason = memory.heap.reason
    ?? "Chromium JavaScript heap measurement is unavailable";
  const domReason = "Chromium Memory.getDOMCounters is unavailable";
  const renderer = memory.pageMemory.rendererMemory.status === "available"
    ? availableMetric(
        memory.pageMemory.rendererMemory.bytes,
        "bytes",
        "performance.measureUserAgentSpecificMemory",
      )
    : unavailableMetric(
        memory.pageMemory.rendererMemory.reason,
        "bytes",
        "performance.measureUserAgentSpecificMemory",
      );
  return Object.freeze({
    dom: Object.freeze({
      documentCount: metricFromOptional(
        memory.dom?.documents,
        "count",
        "CDP Memory.getDOMCounters.documents",
        domReason,
      ),
      eventListenerCount: metricFromOptional(
        memory.dom?.jsEventListeners,
        "count",
        "CDP Memory.getDOMCounters.jsEventListeners",
        domReason,
      ),
      liveElementCount: availableMetric(
        memory.pageMemory.liveElementCount,
        "count",
        "document.querySelectorAll('*')",
      ),
      retainedNodeCount: metricFromOptional(
        memory.dom?.nodes,
        "count",
        "CDP Memory.getDOMCounters.nodes after forced GC",
        domReason,
      ),
      shadowRootCount: availableMetric(
        memory.pageMemory.shadowRootCount,
        "count",
        "open shadow roots across the composed benchmark tree",
      ),
    }),
    memory: Object.freeze({
      jsHeapRetainedDeltaBytes: unavailableMetric(
        "No pre-interaction forced-GC baseline is taken because it would perturb navigation and long-task evidence",
        "bytes",
        "measurement policy",
      ),
      jsHeapTotalBytes: metricFromOptional(
        memory.heap.status === "available"
          ? memory.heap.totalSize
          : null,
        "bytes",
        memory.heap.source ?? "CDP after forced GC",
        heapReason,
      ),
      jsHeapUsedBytes: metricFromOptional(
        memory.heap.status === "available"
          ? memory.heap.usedSize
          : null,
        "bytes",
        memory.heap.source ?? "CDP after forced GC",
        heapReason,
      ),
      rendererBytes: renderer,
      rendererPrivateBytes:
        memory.processMemory.privateBytes.status === "available"
          ? availableMetric(
              memory.processMemory.privateBytes.value,
              "bytes",
              memory.processMemory.method,
            )
          : unavailableMetric(
              memory.processMemory.privateBytes.reason,
              "bytes",
              memory.processMemory.method,
            ),
      rendererWorkingSetBytes:
        memory.processMemory.workingSetBytes.status === "available"
          ? availableMetric(
              memory.processMemory.workingSetBytes.value,
              "bytes",
              memory.processMemory.method,
            )
          : unavailableMetric(
              memory.processMemory.workingSetBytes.reason,
              "bytes",
              memory.processMemory.method,
            ),
    }),
  });
}

function interactionMetrics(result) {
  const step = (name) =>
    availableMetric(
      result.durations[name],
      "milliseconds",
      "in-page performance.now",
    );
  return Object.freeze({
    evidence: Object.freeze(result.evidence),
    routeNavigationTotalMs: availableMetric(
      result.durations.navigateActivityMs
        + result.durations.navigateSettingsMs
        + result.durations.navigateWorkMs,
      "milliseconds",
      "sum of client route transition durations",
    ),
    steps: Object.freeze(
      Object.fromEntries(
        CANONICAL_INTERACTION_STEP_IDS.map((name) => [name, step(name)]),
      ),
    ),
    totalDurationMs: availableMetric(
      result.totalDurationMs,
      "milliseconds",
      "sum of in-page interaction durations",
    ),
  });
}

async function validateSolidSemanticDom(page, response, browserCase) {
  if (browserCase.appId !== "solid") {
    return Object.freeze({ status: "not-applicable" });
  }
  const variantIndex = Number(
    response.headers()["x-webui-browser-variant"],
  );
  if (
    !Number.isInteger(variantIndex)
    || variantIndex < 0
    || variantIndex >= TODO_STATE_VARIANTS.length
  ) {
    throw new Error("Controlled browser response omitted its state variant");
  }
  const html = await page.locator("#todo-browser-root").evaluate((root) => {
    const clone = root.cloneNode(true);
    const liveCheckboxes = root.querySelectorAll('input[type="checkbox"]');
    const clonedCheckboxes = clone.querySelectorAll('input[type="checkbox"]');
    for (let index = 0; index < liveCheckboxes.length; index += 1) {
      clonedCheckboxes[index]?.toggleAttribute(
        "checked",
        liveCheckboxes[index].checked,
      );
    }
    return clone.innerHTML;
  });
  const requestTimestamp = response.headers()["x-webui-bench-timestamp"];
  if (typeof requestTimestamp !== "string") {
    throw new Error("Controlled browser response omitted its request timestamp");
  }
  const state = createRequestTodoState(
    TODO_STATE_VARIANTS[variantIndex],
    requestTimestamp,
  );
  assertValidObservation(collectHtmlObservation(html), state);
  return Object.freeze({
    status: "validated",
    variantId: state.variantId,
    variantIndex,
  });
}

export async function measureBrowserRound({
  browser,
  browserCase,
  headless = true,
  url,
  viewport,
}) {
  const context = await browser.newContext({
    extraHTTPHeaders: {
      "x-webui-browser-profile": "1",
    },
    ignoreHTTPSErrors: true,
    serviceWorkers: "block",
    viewport,
  });
  const page = await createObservedPage(context);
  await warmHeadedCompositor(page, headless);
  const diagnostics = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      diagnostics.push(`console.error: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    diagnostics.push(`pageerror: ${error.stack ?? error.message}`);
  });
  const session = await context.newCDPSession(page);
  const browserSession = await browser.newBrowserCDPSession();
  const network = new NetworkCollector(session);
  try {
    await session.send("Network.enable");
    await session.send("Performance.enable");
    const processInfoBefore = await captureProcessInfo(browserSession);
    const navigationRequestedAt = Date.now();
    const response = await page.goto(`${url}/dynamic`, {
      waitUntil: "domcontentloaded",
    });
    if (response === null || !response.ok()) {
      throw new Error(
        `Navigation failed with ${response?.status() ?? "no response"}`,
      );
    }
    const responseBody = await response.body();
    const navigationCompletedAt = Date.now();
    const sourceBytes = Number(
      response.headers()["x-webui-browser-source-bytes"],
    );
    const readiness = await waitForReadiness(page, browserCase);
    const fullHydration = await waitForFullHydration(page, browserCase);
    const requestState = await page.evaluate(() => {
      const titles = Array.from(
        globalThis.__TODO_BENCH_QUERY_ALL__(".todo-item__title"),
        (element) => element.textContent?.trim() ?? "",
      );
      const timestamps = titles.map((title) =>
        title.match(
          /^Todo \d{4} · (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)$/u,
        )?.[1]
      );
      return {
        itemCount: titles.length,
        timestamps: [...new Set(timestamps)],
      };
    });
    if (
      requestState.itemCount !== 100
      || requestState.timestamps.length !== 1
      || typeof requestState.timestamps[0] !== "string"
    ) {
      throw new Error(
        `${browserCase.appId} did not render one request timestamp across 100 todos`,
      );
    }
    const requestTimestamp = requestState.timestamps[0];
    const requestTimestampMs = Date.parse(requestTimestamp);
    if (
      !Number.isFinite(requestTimestampMs)
      || requestTimestampMs < navigationRequestedAt - 1_000
      || requestTimestampMs > navigationCompletedAt + 1_000
    ) {
      throw new Error(
        `${browserCase.appId} rendered stale request timestamp '${requestTimestamp}'`,
      );
    }
    const responseTimestamp = response.headers()["x-webui-bench-timestamp"];
    if (
      responseTimestamp !== undefined
      && responseTimestamp !== requestTimestamp
    ) {
      throw new Error(
        `${browserCase.appId} response timestamp does not match visible initial state`,
      );
    }
    await page.waitForLoadState("load", { timeout: 30_000 });
    const semanticValidation = await validateSolidSemanticDom(
      page,
      response,
      browserCase,
    );
    const inlineJavascript = await captureInlineJavascript(page);
    const paint = await finalizePreInteractionPaint(page);
    const rawTimings = await capturePageTimings(
      page,
      readiness,
      fullHydration,
      paint,
    );
    if (rawTimings.nextHopProtocol !== "h2") {
      throw new Error(
        `${browserCase.productId} negotiated '${
          rawTimings.nextHopProtocol ?? "unknown"
        }' instead of HTTP/2`,
      );
    }
    const rendererProcessTime = await captureRendererProcessTime(session);
    const processInfoAfter = await captureProcessInfo(browserSession);
    const rendererSelection = selectRendererProcess(
      processInfoBefore.processes,
      processInfoAfter.processes,
      rendererProcessTime.status === "available"
        ? rendererProcessTime.value
        : undefined,
    );
    const rawMemory = await captureMemory(page, session, rendererSelection);
    const memory = memoryMetrics(rawMemory);
    const initialJavascript = network.javascript();
    const interactions = await page.evaluate(
      executeTodoInteractionSequence,
      {
        activitySentinelId: "activity-0026",
        sentinelId: "todo-0050",
        timeoutMs: 10_000,
      },
    );
    const javascript = network.javascript();
    return Object.freeze({
      diagnostics: Object.freeze(diagnostics),
      metrics: Object.freeze({
        document: Object.freeze({
          responseBytes: availableMetric(
            responseBody.byteLength,
            "bytes",
            "Playwright Response.body",
          ),
          sourceSsrResponseBytes: availableMetric(
            Number.isFinite(sourceBytes)
              ? sourceBytes
              : responseBody.byteLength,
            "bytes",
            Number.isFinite(sourceBytes)
              ? "controlled source response before browser document wrapper"
              : "Playwright Response.body",
          ),
        }),
        dom: memory.dom,
        interactions: interactionMetrics(interactions),
        javascript: Object.freeze({
          assets: javascript.assets,
          externalTransferBytes: availableMetric(
            javascript.externalTransferBytes,
            "bytes",
            "CDP transfer bytes for external executable JavaScript resources",
          ),
          inlineBytes: availableMetric(
            inlineJavascript.bytes,
            "bytes",
            "UTF-8 executable inline script text; serialized state outside executable scripts remains in document.responseBytes",
          ),
          inlineCount: availableMetric(
            inlineJavascript.count,
            "count",
            "executable inline script elements without src",
          ),
          requestCount: availableMetric(
            javascript.requestCount,
            "count",
            "CDP Network loading events",
          ),
          transferBytes: availableMetric(
            javascript.externalTransferBytes + inlineJavascript.bytes,
            "bytes",
            "external executable JavaScript plus executable inline script bytes; not total hydration payload",
          ),
          initialTransferBytes: availableMetric(
          initialJavascript.externalTransferBytes + inlineJavascript.bytes,
          "bytes",
          "executable JavaScript transferred before the routed interaction journey",
          ),
          routeRequestCount: availableMetric(
          javascript.requestCount - initialJavascript.requestCount,
          "count",
          "additional executable JavaScript requests during client route transitions",
          ),
          routeTransferBytes: availableMetric(
          javascript.externalTransferBytes
            - initialJavascript.externalTransferBytes,
          "bytes",
          "additional executable JavaScript transferred during client route transitions",
          ),
        }),
        longTasks: longTaskMetrics(rawTimings.longTasks),
        memory: memory.memory,
        timings: timingMetrics(rawTimings, readiness),
      }),
      fullHydration: Object.freeze(fullHydration),
      paint: Object.freeze({
        ...paint,
        interactionStartedAtMs: interactions?.startedAtMs ?? paint.finalizedAtMs,
        label: "pre-interaction LCP",
        observerInstallation:
          "browserContext.addInitScript before page creation and navigation",
      }),
      processMemory: Object.freeze({
        afterProcessInfoStatus: processInfoAfter.status,
        beforeProcessInfoStatus: processInfoBefore.status,
        browserIsolation:
          "fresh foreground Chromium process, context, and renderer page for this sample",
        garbageCollection: Object.freeze({
          completedPasses: rawMemory.heap.completedPasses,
          reason: rawMemory.heap.reason ?? null,
          requestedPasses: rawMemory.heap.requestedPasses,
          status: rawMemory.heap.status,
        }),
        memorySample: rawMemory.processMemory,
        rendererSelection,
        rendererProcessTime,
      }),
      readiness: Object.freeze(readiness),
      navigationTiming: Object.freeze({
        nextHopProtocol: rawTimings.nextHopProtocol,
        requestStartMs: rawTimings.requestStartMs,
        responseEndMs: rawTimings.responseEndMs,
        responseStartMs: rawTimings.responseStartMs,
        serverTiming: Object.freeze(rawTimings.serverTiming),
      }),
      requestState: Object.freeze({
        itemCount: requestState.itemCount,
        requestTimestamp,
        source: responseTimestamp === undefined
          ? "visible todo titles"
          : "response header and visible todo titles",
        status: "validated",
      }),
      semanticValidation,
    });
  } catch (error) {
    const browserDiagnostics = diagnostics.length === 0
      ? ""
      : `\n${diagnostics.join("\n")}`;
    throw new Error(
      `${browserCase.appId} browser measurement failed: ${readableError(error)}${browserDiagnostics}`,
      { cause: error },
    );
  } finally {
    await browserSession.detach().catch(() => {});
    await session.detach().catch(() => {});
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}
