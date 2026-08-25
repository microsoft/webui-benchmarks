// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import {
  createObservedPage,
  installPerformanceObservers,
  warmHeadedCompositor,
} from "../measurement.mjs";

test("installs buffered observers before page creation and navigation", async () => {
  const calls = [];
  const page = {};
  const context = {
    async addInitScript(script) {
      calls.push(["addInitScript", script]);
    },
    async newPage() {
      calls.push(["newPage"]);
      return page;
    },
  };

  assert.equal(await createObservedPage(context), page);
  assert.deepEqual(
    calls.map(([name]) => name),
    ["addInitScript", "newPage"],
  );
  assert.equal(calls[0][1], installPerformanceObservers);
});

test("warms a headed page for two frames but skips headless pages", async () => {
  const previous = globalThis.requestAnimationFrame;
  let evaluated = 0;
  let frames = 0;
  const page = {
    async bringToFront() {
      evaluated++;
    },
    async evaluate(callback) {
      evaluated++;
      return callback();
    },
  };
  globalThis.requestAnimationFrame = (callback) => {
    frames++;
    callback();
  };
  try {
    await warmHeadedCompositor(page, true);
    assert.equal(evaluated, 0);
    await warmHeadedCompositor(page, false);
    assert.equal(evaluated, 2);
    assert.equal(frames, 2);
  } finally {
    if (previous === undefined) {
      delete globalThis.requestAnimationFrame;
    } else {
      globalThis.requestAnimationFrame = previous;
    }
  }
});

test("configures FCP and LCP observers with buffered delivery", () => {
  const previousObserver = globalThis.PerformanceObserver;
  const previousStore = globalThis.__TODO_BENCH_PERFORMANCE__;
  const observations = [];
  class FakePerformanceObserver {
    static supportedEntryTypes = [
      "largest-contentful-paint",
      "longtask",
      "paint",
    ];

    constructor() {}

    observe(options) {
      observations.push(options);
    }
  }

  globalThis.PerformanceObserver = FakePerformanceObserver;
  try {
    installPerformanceObservers();
    assert.deepEqual(observations, [
      { buffered: true, type: "paint" },
      { buffered: true, type: "largest-contentful-paint" },
      { buffered: true, type: "longtask" },
    ]);
  } finally {
    if (previousObserver === undefined) {
      delete globalThis.PerformanceObserver;
    } else {
      globalThis.PerformanceObserver = previousObserver;
    }
    if (previousStore === undefined) {
      delete globalThis.__TODO_BENCH_PERFORMANCE__;
    } else {
      globalThis.__TODO_BENCH_PERFORMANCE__ = previousStore;
    }
  }
});
