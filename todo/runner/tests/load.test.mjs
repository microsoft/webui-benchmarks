// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  analyzeSaturation,
  classifyLoadGeneratorUsage,
  distributeConnections,
  measureLoadWithRetry,
  runAutocannon,
} from "../lib/load.mjs";
import { prepareLoadMeasurement } from "../lib/orchestrator.mjs";

function sample(connections, requestsPerSecond, overrides = {}) {
  return {
    connections,
    loadGenerator: { status: "available" },
    requestsPerSecond,
    serverMetrics: { status: "available" },
    ...overrides,
  };
}

test("load-generator capacity is normalized across worker threads", () => {
  const available = classifyLoadGeneratorUsage(1_750, 1_000, 2);
  assert.equal(available.cpuPercent, 175);
  assert.equal(available.capacityPercent, 87.5);
  assert.equal(available.workerCount, 2);
  assert.equal(available.status, "available");

  assert.equal(
    classifyLoadGeneratorUsage(1_850, 1_000, 2).status,
    "bottleneck-risk",
  );
  assert.equal(
    classifyLoadGeneratorUsage(950, 1_000, 0).status,
    "bottleneck-risk",
  );
});

test("connections are divided exactly across available workers", () => {
  assert.deepEqual(distributeConnections(1, 2), [1]);
  assert.deepEqual(distributeConnections(5, 2), [3, 2]);
  assert.deepEqual(distributeConnections(64, 2), [32, 32]);
});

test("retries one discarded transient load window", async () => {
  let attempts = 0;
  const result = await measureLoadWithRetry(
    "http://127.0.0.1/dynamic",
    {},
    {
      measure: async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error(
            "http://127.0.0.1/dynamic load generated 1 errors",
          );
        }
        return { requestsPerSecond: 100 };
      },
    },
  );
  assert.equal(attempts, 2);
  assert.equal(result.measurementAttempts, 2);
  assert.equal(result.requestsPerSecond, 100);
});

test("does not retry non-transient load failures", async () => {
  let attempts = 0;
  await assert.rejects(
    measureLoadWithRetry(
      "http://127.0.0.1/dynamic",
      {},
      {
        measure: async () => {
          attempts++;
          throw new Error("contract validation failed");
        },
      },
    ),
    /contract validation failed/u,
  );
  assert.equal(attempts, 1);
});

test("server warmup completes before the saturation sweep", async () => {
  const calls = [];
  const result = await prepareLoadMeasurement({
    protocol: { warmupSeconds: 5 },
    saturationContext: { processId: 123 },
    saturationNeeded: true,
    url: "http://127.0.0.1/dynamic",
  }, {
    runSweep: async () => {
      calls.push("sweep");
      return { analysis: { status: "saturated" }, samples: [] };
    },
    runWarmup: async () => {
      calls.push("warmup");
      return { status: "ok" };
    },
  });
  assert.deepEqual(calls, ["warmup", "sweep"]);
  assert.equal(result.warmupResult.status, "ok");
  assert.equal(result.sweep.analysis.status, "saturated");
});

test("parallel load workers merge throughput and latency evidence", async () => {
  const server = createServer((_request, response) => {
    response.end("ok");
  });
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, "object");
    const result = await runAutocannon({
      connections: 4,
      duration: 1,
      headers: { "accept-encoding": "identity" },
      loadWorkers: 2,
      pipelining: 1,
      url: `http://127.0.0.1:${address.port}`,
    });
    assert.equal(result.errors, 0);
    assert.equal(result.timeouts, 0);
    assert.equal(result.webuiLoadWorkerCount, 2);
    assert.ok(result.requests.average > 0);
    assert.ok(result.requests.total > 0);
    assert.ok(result.webuiLatencyP95 >= 0);
    assert.equal(result.webuiLatencyP95Status, "histogram-10us");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      });
    });
  }
});

test("saturation analysis distinguishes a plateau from an unfinished sweep", () => {
  assert.equal(
    analyzeSaturation([
      sample(1, 100),
      sample(8, 500),
      sample(32, 505),
    ]).status,
    "saturated",
  );
  assert.equal(
    analyzeSaturation([
      sample(1, 100),
      sample(8, 500),
      sample(32, 700),
    ]).status,
    "server-unsaturated",
  );
  assert.equal(
    analyzeSaturation([
      sample(1, 100),
      sample(8, 500),
      sample(32, 480),
      sample(64, 520),
    ]).status,
    "saturated",
  );
  assert.equal(
    analyzeSaturation([
      sample(192, 700, { durationSeconds: 4 }),
      sample(200, 745, { durationSeconds: 4 }),
    ]).status,
    "saturated",
  );
  assert.equal(
    analyzeSaturation([
      sample(192, 700, { durationSeconds: 4 }),
      sample(200, 800, { durationSeconds: 4 }),
    ]).status,
    "server-unsaturated",
  );
});

test("saturation analysis reports load and process metric uncertainty", () => {
  assert.equal(
    analyzeSaturation([
      sample(1, 100, {
        loadGenerator: { status: "bottleneck-risk" },
      }),
    ]).status,
    "load-generator-unconfirmed",
  );
  const unavailable = analyzeSaturation([
    sample(1, 100, {
      serverMetrics: { status: "unavailable" },
    }),
  ]);
  assert.equal(unavailable.status, "process-metrics-unavailable");
  assert.equal(unavailable.plateauStatus, "saturated");
});

test("saturation analysis rejects an unfinished sweep without process metrics", () => {
  const unavailable = { status: "unavailable" };
  assert.equal(
    analyzeSaturation([
      sample(1, 100, { serverMetrics: unavailable }),
      sample(8, 500, { serverMetrics: unavailable }),
      sample(32, 700, { serverMetrics: unavailable }),
    ]).status,
    "server-unsaturated",
  );
});
