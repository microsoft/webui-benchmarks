// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import process from "node:process";
import { resolve } from "node:path";
import { measureLoad, warmup } from "../runner/lib/load.mjs";
import { BENCHMARK_ROOT } from "../runner/lib/paths.mjs";
import {
  ProcessRegistry,
  spawnManagedProcess,
} from "../runner/lib/process-tree.mjs";

const workspaceRoot = BENCHMARK_ROOT;
const executable = resolve(
  workspaceRoot,
  "target",
  "release",
  "examples",
  process.platform === "win32"
    ? "todo_profile_server.exe"
    : "todo_profile_server",
);
const connections = [1, 10];
const durationSeconds = Number(process.env.WEBUI_PROFILE_ACTIX_SECONDS ?? 3);
const rounds = Number(process.env.WEBUI_PROFILE_ACTIX_ROUNDS ?? 5);
const warmupSeconds = Number(process.env.WEBUI_PROFILE_ACTIX_WARMUP ?? 2);

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

function medianAbsoluteDeviation(values) {
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
}

function waitForAnnouncement(entry) {
  return new Promise((resolveAnnouncement, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      reject(new Error(`profile server readiness timed out\n${stderr}`));
    }, 30_000);
    entry.child.stdout.setEncoding("utf8");
    entry.child.stderr.setEncoding("utf8");
    entry.child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-16_384);
    });
    entry.child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const newline = stdout.indexOf("\n");
      if (newline === -1) {
        return;
      }
      clearTimeout(timeout);
      try {
        resolveAnnouncement(JSON.parse(stdout.slice(0, newline)));
      } catch (error) {
        reject(
          new Error(`profile server emitted invalid JSON: ${stdout}`, {
            cause: error,
          }),
        );
      }
    });
    entry.child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    entry.child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(
        new Error(`profile server exited with ${code} before announcing ready`),
      );
    });
  });
}

async function validateEqualBodies(announcement) {
  const observations = [];
  const expectedModes = {
    cached: "cached",
    counted: "counted",
    dynamic: "render",
  };
  for (const [name, route] of Object.entries(announcement.routes)) {
    const response = await fetch(`${announcement.url}${route}`, {
      headers: { "accept-encoding": "identity" },
    });
    if (!response.ok) {
      throw new Error(`${name} returned ${response.status}`);
    }
    const body = await response.arrayBuffer();
    const mode = response.headers.get("x-webui-profile-mode");
    if (mode !== expectedModes[name]) {
      throw new Error(`${name} returned unexpected profile mode '${mode}'`);
    }
    observations.push({
      bytes: body.byteLength,
      mode,
      name,
    });
  }
  if (
    observations.some(
      (observation) => observation.bytes !== announcement.responseBytes,
    )
  ) {
    throw new Error(`profile routes emitted unequal bytes: ${
      JSON.stringify(observations)
    }`);
  }
  return observations;
}

function summarize(samples) {
  const grouped = new Map();
  for (const sample of samples) {
    const key = `${sample.route}:${sample.connections}`;
    const values = grouped.get(key) ?? [];
    values.push(sample);
    grouped.set(key, values);
  }
  return [...grouped.entries()].map(([key, values]) => {
    const [route, connectionCount] = key.split(":");
    const requests = values.map((sample) => sample.requestsPerSecond);
    const p95 = values.map((sample) => sample.latencyP95Ms);
    return {
      connections: Number(connectionCount),
      latencyP95Milliseconds: {
        median: median(p95),
        medianAbsoluteDeviation: medianAbsoluteDeviation(p95),
      },
      loadGeneratorStatuses: [
        ...new Set(values.map((sample) => sample.loadGenerator.status)),
      ],
      requestsPerSecond: {
        median: median(requests),
        medianAbsoluteDeviation: medianAbsoluteDeviation(requests),
      },
      route,
      samples: values.length,
    };
  });
}

const registry = new ProcessRegistry();
const entry = spawnManagedProcess(executable, ["--port", "0"], {
  cwd: workspaceRoot,
  registry,
});

try {
  const announcement = await waitForAnnouncement(entry);
  if (
    announcement.workerCount !== 1
    || announcement.stateVariantCount !== 32
    || announcement.todoItemCount !== 100
  ) {
    throw new Error("profile server contract metadata is invalid");
  }
  const bodyValidation = await validateEqualBodies(announcement);
  const samples = [];
  const routeNames = ["cached", "counted", "dynamic"];

  for (const connectionCount of connections) {
    for (const route of routeNames) {
      await warmup(`${announcement.url}${announcement.routes[route]}`, {
        connections: connectionCount,
        loadWorkers: 0,
        warmupSeconds,
      });
    }
    for (let round = 0; round < rounds; round += 1) {
      const orderedRoutes = routeNames.map(
        (_, index) => routeNames[(index + round) % routeNames.length],
      );
      for (const route of orderedRoutes) {
        const measurement = await measureLoad(
          `${announcement.url}${announcement.routes[route]}`,
          {
            connections: connectionCount,
            durationSeconds,
            loadWorkers: 0,
            processId: entry.child.pid,
            responseBytes: announcement.responseBytes,
          },
        );
        samples.push({ ...measurement, round, route });
      }
    }
  }

  process.stdout.write(
    `${JSON.stringify({
      bodyValidation,
      config: {
        connections,
        durationSeconds,
        rounds,
        warmupSeconds,
      },
      responseBytes: announcement.responseBytes,
      samples,
      schema: "webui.ssr-todo-actix-profile-results/v1",
      summaries: summarize(samples),
      workerCount: announcement.workerCount,
    }, null, 2)}\n`,
  );
} finally {
  await registry.stopAll();
}
