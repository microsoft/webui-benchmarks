// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import autocannon from "autocannon";
import { parentPort, workerData } from "node:worker_threads";

if (parentPort === null) {
  throw new Error("load-worker.mjs must run in a worker thread");
}

const latencyCounts = new Map();
parentPort.once("message", ({ command }) => {
  if (command !== "start") {
    parentPort.postMessage({ error: `unknown load worker command '${command}'` });
    return;
  }
  const instance = autocannon(workerData.options, (error, result) => {
    if (error !== null) {
      parentPort.postMessage({ error: error.message });
      return;
    }
    parentPort.postMessage({
      latencyCounts: [...latencyCounts],
      result: {
        errors: result.errors,
        non2xx: result.non2xx,
        requests: result.totalCompletedRequests,
        requestsPerSecond: result.totalCompletedRequests / result.samples,
        samples: result.samples,
        throughputBytesPerSecond: result.totalBytes / result.samples,
        timeouts: result.timeouts,
      },
      type: "result",
    });
  });

  instance.on(
    "response",
    (_client, _statusCode, _responseBytes, latency) => {
      const bucket = Math.round(latency * 100) / 100;
      latencyCounts.set(bucket, (latencyCounts.get(bucket) ?? 0) + 1);
    },
  );
});
parentPort.postMessage({ type: "ready" });
