// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import process from "node:process";
import { Worker } from "node:worker_threads";
import { startProcessMetrics } from "./metrics.mjs";

let autocannonPromise;

async function loadAutocannon() {
  autocannonPromise ??= import("autocannon").then((module) => module.default);
  return autocannonPromise;
}

async function runSingleAutocannon(options) {
  const autocannon = await loadAutocannon();
  return new Promise((resolve, reject) => {
    const latencyCounts = new Map();
    let latencyCount = 0;
    const instance = autocannon(options, (error, result) => {
      if (error) {
        reject(error);
      } else {
        const target = Math.ceil(latencyCount * 0.95);
        let seen = 0;
        let latencyP95 = null;
        for (
          const [latency, count] of [...latencyCounts].sort(
            ([left], [right]) => left - right,
          )
        ) {
          seen += count;
          if (seen >= target) {
            latencyP95 = latency;
            break;
          }
        }
        result.webuiLatencyP95 = latencyP95;
        result.webuiLatencyP95Status = latencyP95 === null
          ? "unavailable"
          : "histogram-10us";
        result.webuiLoadWorkerCount = 1;
        resolve(result);
      }
    });
    instance.on(
      "response",
      (_client, _statusCode, _responseBytes, latency) => {
        const bucket = Math.round(latency * 100) / 100;
        latencyCounts.set(bucket, (latencyCounts.get(bucket) ?? 0) + 1);
        latencyCount += 1;
      },
    );
  });
}

export function distributeConnections(connections, loadWorkers) {
  const workerCount = Math.min(connections, loadWorkers);
  const base = Math.floor(connections / workerCount);
  const remainder = connections % workerCount;
  return Object.freeze(
    Array.from(
      { length: workerCount },
      (_unused, index) => base + (index < remainder ? 1 : 0),
    ),
  );
}

function percentile(latencyCounts, quantile) {
  const total = [...latencyCounts.values()].reduce(
    (sum, count) => sum + count,
    0,
  );
  if (total === 0) {
    return null;
  }
  const target = Math.ceil(total * quantile);
  let seen = 0;
  for (
    const [latency, count] of [...latencyCounts].sort(
      ([left], [right]) => left - right,
    )
  ) {
    seen += count;
    if (seen >= target) {
      return latency;
    }
  }
  return null;
}

function startLoadWorker(options) {
  const worker = new Worker(new URL("./load-worker.mjs", import.meta.url), {
    workerData: { options },
  });
  let markReady;
  let failReady;
  const ready = new Promise((resolve, reject) => {
    markReady = resolve;
    failReady = reject;
  });
  const promise = new Promise((resolve, reject) => {
    let settled = false;
    worker.on("message", (message) => {
      if (message.type === "ready") {
        markReady();
        return;
      }
      settled = true;
      if (message.error === undefined) {
        resolve(message);
      } else {
        reject(new Error(message.error));
      }
    });
    worker.once("error", (error) => {
      settled = true;
      failReady(error);
      reject(error);
    });
    worker.once("exit", (code) => {
      if (!settled) {
        const error = new Error(
          `load worker exited before reporting (code ${code})`,
        );
        failReady(error);
        reject(error);
      }
    });
  });
  return { promise, ready, worker };
}

async function runParallelAutocannon(options, loadWorkers) {
  const connectionCounts = distributeConnections(
    options.connections,
    loadWorkers,
  );
  const workers = connectionCounts.map((connections) =>
    startLoadWorker({ ...options, connections })
  );
  let messages;
  let loadCpuMilliseconds;
  let loadElapsedMilliseconds;
  try {
    await Promise.all(workers.map(({ ready }) => ready));
    const startCpu = process.cpuUsage();
    const startedAt = performance.now();
    for (const { worker } of workers) {
      worker.postMessage({ command: "start" });
    }
    messages = await Promise.all(workers.map(({ promise }) => promise));
    const usage = process.cpuUsage(startCpu);
    loadCpuMilliseconds = (usage.user + usage.system) / 1000;
    loadElapsedMilliseconds = performance.now() - startedAt;
  } finally {
    await Promise.all(workers.map(({ worker }) => worker.terminate()));
  }

  const latencyCounts = new Map();
  const totals = {
    errors: 0,
    non2xx: 0,
    requests: 0,
    requestsPerSecond: 0,
    throughputBytesPerSecond: 0,
    timeouts: 0,
  };
  for (const message of messages) {
    for (const [latency, count] of message.latencyCounts) {
      latencyCounts.set(latency, (latencyCounts.get(latency) ?? 0) + count);
    }
    for (const name of Object.keys(totals)) {
      totals[name] += message.result[name];
    }
  }

  const latencyP50 = percentile(latencyCounts, 0.5);
  const latencyP95 = percentile(latencyCounts, 0.95);
  const latencyP99 = percentile(latencyCounts, 0.99);
  return {
    errors: totals.errors,
    latency: {
      p50: latencyP50,
      p97_5: percentile(latencyCounts, 0.975),
      p99: latencyP99,
    },
    non2xx: totals.non2xx,
    requests: {
      average: totals.requestsPerSecond,
      total: totals.requests,
    },
    throughput: { average: totals.throughputBytesPerSecond },
    timeouts: totals.timeouts,
    webuiLatencyP95: latencyP95,
    webuiLatencyP95Status: latencyP95 === null
      ? "unavailable"
      : "histogram-10us",
    webuiLoadCpuMilliseconds: loadCpuMilliseconds,
    webuiLoadElapsedMilliseconds: loadElapsedMilliseconds,
    webuiLoadWorkerCount: workers.length,
  };
}

export function runAutocannon(options) {
  const { loadWorkers, ...autocannon } = options;
  return loadWorkers > 0
    ? runParallelAutocannon(autocannon, loadWorkers)
    : runSingleAutocannon(autocannon);
}

function autocannonOptions(
  url,
  { connections, durationSeconds, loadWorkers },
) {
  return {
    connections,
    duration: durationSeconds,
    headers: { "accept-encoding": "identity" },
    loadWorkers,
    pipelining: 1,
    url,
  };
}

function assertSuccessfulLoad(result, url) {
  for (const name of ["errors", "timeouts", "non2xx"]) {
    if (result[name] !== 0) {
      throw new Error(`${url} load generated ${result[name]} ${name}`);
    }
  }
  if (!Number.isFinite(result.requests?.average)) {
    throw new Error(`${url} load generator did not report request throughput`);
  }
}

export function classifyLoadGeneratorUsage(
  cpuMilliseconds,
  elapsedMilliseconds,
  loadWorkers,
) {
  const workerCount = Math.max(1, loadWorkers);
  const cpuPercent = (cpuMilliseconds / Math.max(1, elapsedMilliseconds)) * 100;
  const capacityPercent = cpuPercent / workerCount;
  return Object.freeze({
    capacityPercent,
    cpuMilliseconds,
    cpuPercent,
    status: capacityPercent >= 90 ? "bottleneck-risk" : "available",
    workerCount,
  });
}

function loadGeneratorStatus(startCpu, elapsedMilliseconds, result) {
  const usage = process.cpuUsage(startCpu);
  const cpuMilliseconds = result.webuiLoadCpuMilliseconds
    ?? (usage.user + usage.system) / 1000;
  return classifyLoadGeneratorUsage(
    cpuMilliseconds,
    result.webuiLoadElapsedMilliseconds ?? elapsedMilliseconds,
    result.webuiLoadWorkerCount,
  );
}

export async function warmup(url, protocol) {
  const result = await runAutocannon(
    autocannonOptions(url, {
      connections: protocol.connections,
      durationSeconds: protocol.warmupSeconds,
      loadWorkers: protocol.loadWorkers,
    }),
  );
  assertSuccessfulLoad(result, url);
  return Object.freeze({
    durationSeconds: protocol.warmupSeconds,
    requests: result.requests.total,
    status: "ok",
  });
}

export async function measureLoad(
  url,
  {
    connections,
    durationSeconds,
    loadWorkers,
    processId,
    responseBytes,
  },
) {
  const processMetrics = startProcessMetrics(processId);
  const startCpu = process.cpuUsage();
  const startedAt = performance.now();
  let result;
  try {
    result = await runAutocannon(
      autocannonOptions(url, {
        connections,
        durationSeconds,
        loadWorkers,
      }),
    );
  } catch (error) {
    processMetrics.finish();
    throw error;
  }
  const elapsedMilliseconds = performance.now() - startedAt;
  const serverMetrics = processMetrics.finish();
  assertSuccessfulLoad(result, url);
  const requestsPerSecond = result.requests.average;
  return Object.freeze({
    connections,
    durationSeconds,
    errors: result.errors,
    latencyP50Ms: result.latency.p50,
    latencyP95Ms:
      result.webuiLatencyP95 ?? result.latency.p97_5 ?? result.latency.p99,
    latencyP95Status: result.webuiLatencyP95Status,
    latencyP99Ms: result.latency.p99,
    loadGenerator: loadGeneratorStatus(
      startCpu,
      elapsedMilliseconds,
      result,
    ),
    non2xx: result.non2xx,
    requests: result.requests.total,
    requestsPerSecond,
    serverMetrics,
    timeouts: result.timeouts,
    throughputBytesPerSecond:
      result.throughput?.average ?? requestsPerSecond * responseBytes,
  });
}

export async function measureLoadWithRetry(
  url,
  options,
  {
    attempts = 2,
    measure = measureLoad,
  } = {},
) {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new RangeError("attempts must be a positive integer");
  }
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await measure(url, options);
      return Object.freeze({ ...result, measurementAttempts: attempt });
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (
        attempt === attempts
        || !/ load generated \d+ (?:errors|timeouts|non2xx)$/u.test(message)
      ) {
        throw error;
      }
    }
  }
  throw lastError;
}

export function analyzeSaturation(samples) {
  if (samples.length === 0) {
    return Object.freeze({
      reason: "No saturation samples were collected",
      status: "unavailable",
    });
  }
  if (
    samples.some(
      (sample) =>
        sample.loadGenerator.status === "bottleneck-risk"
        || sample.loadGenerator.status === "unavailable",
    )
  ) {
    return Object.freeze({
      reason: "Load-generator capacity could not be proven",
      status: "load-generator-unconfirmed",
    });
  }
  const peak = samples.reduce(
    (best, sample, index) =>
      sample.requestsPerSecond > best.sample.requestsPerSecond
        ? { index, sample }
        : best,
    { index: 0, sample: samples[0] },
  );
  if (peak.index === samples.length - 1 && samples.length > 1) {
    const previousPeak = Math.max(
      ...samples
        .slice(0, -1)
        .map((sample) => sample.requestsPerSecond),
    );
    const gain =
      (peak.sample.requestsPerSecond - previousPeak) / previousPeak;
    const gainThreshold = samples.length === 2
        && samples.every(({ durationSeconds }) => durationSeconds <= 4)
      ? 0.1
      : 0.05;
    if (gain > gainThreshold) {
      return Object.freeze({
        gain,
        reason: "Throughput was still increasing at the largest connection count",
        status: "server-unsaturated",
      });
    }
  }
  if (samples.some((sample) => sample.serverMetrics.status !== "available")) {
    return Object.freeze({
      peakConnections: peak.sample.connections,
      peakRequestsPerSecond: peak.sample.requestsPerSecond,
      plateauStatus: "saturated",
      reason: "Server process metrics were unavailable",
      status: "process-metrics-unavailable",
    });
  }
  return Object.freeze({
    peakConnections: peak.sample.connections,
    peakRequestsPerSecond: peak.sample.requestsPerSecond,
    plateauStatus: "saturated",
    status: "saturated",
  });
}

export async function runSaturationSweep(
  url,
  protocol,
  { processId, responseBytes },
) {
  const samples = [];
  for (const connections of protocol.saturationConnections) {
    samples.push(
      await measureLoadWithRetry(url, {
        connections,
        durationSeconds: protocol.saturationDurationSeconds,
        loadWorkers: protocol.loadWorkers,
        processId,
        responseBytes,
      }),
    );
  }
  return Object.freeze({
    analysis: analyzeSaturation(samples),
    samples: Object.freeze(samples),
  });
}
