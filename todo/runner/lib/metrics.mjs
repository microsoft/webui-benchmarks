// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import process from "node:process";

export const WINDOWS_PROCESS_METRICS_UNAVAILABLE_REASON =
  "Windows process sampling is disabled because synchronous PowerShell probes perturb load measurements";
export const PROCESS_METRICS_INTERVAL_MILLISECONDS = 200;

const execFileAsync = promisify(execFile);

async function linuxSample(pid) {
  const [stat, status] = await Promise.all([
    readFile(`/proc/${pid}/stat`, "utf8"),
    readFile(`/proc/${pid}/status`, "utf8"),
  ]);
  const fields = stat.slice(stat.lastIndexOf(") ") + 2).trim().split(/\s+/u);
  const rssLine = status.split(/\r?\n/u).find((line) =>
    line.startsWith("VmRSS:")
  );
  const rssKilobytes = Number(rssLine?.match(/\d+/u)?.[0]);
  const userTicks = Number(fields[11]);
  const systemTicks = Number(fields[12]);
  if (
    !Number.isFinite(rssKilobytes)
    || !Number.isFinite(userTicks)
    || !Number.isFinite(systemTicks)
  ) {
    throw new Error("Linux process metrics were incomplete");
  }
  return {
    cpuMilliseconds: (userTicks + systemTicks) * 10,
    rssBytes: rssKilobytes * 1024,
  };
}

function parseCpuTime(value) {
  const parts = value.trim().split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) {
    throw new Error("Invalid ps CPU time");
  }
  let seconds = 0;
  for (const part of parts) {
    seconds = (seconds * 60) + part;
  }
  return seconds * 1000;
}

async function posixSample(pid) {
  const { stdout } = await execFileAsync(
    "ps",
    ["-o", "time=", "-o", "rss=", "-p", String(pid)],
    { encoding: "utf8" },
  );
  if (stdout.trim().length === 0) {
    throw new Error("ps process metrics failed");
  }
  const match = stdout.trim().match(/^(\S+)\s+(\d+)$/u);
  if (match === null) {
    throw new Error("Unexpected ps process metrics output");
  }
  return {
    cpuMilliseconds: parseCpuTime(match[1]),
    rssBytes: Number(match[2]) * 1024,
  };
}

export async function readProcessMetrics(pid, platform = process.platform) {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new RangeError("Process metrics require a valid PID");
  }
  if (platform === "linux") {
    return linuxSample(pid);
  }
  if (platform === "win32") {
    throw new Error(WINDOWS_PROCESS_METRICS_UNAVAILABLE_REASON);
  }
  return posixSample(pid);
}

export async function snapshotProcessMemory(pid, options = {}) {
  try {
    const metrics = await (options.read ?? readProcessMetrics)(
      pid,
      options.platform ?? process.platform,
    );
    if (!Number.isFinite(metrics.rssBytes)) {
      throw new Error("Process RSS was incomplete");
    }
    return Object.freeze({ rssBytes: metrics.rssBytes, status: "available" });
  } catch (error) {
    return Object.freeze({
      reason: error instanceof Error ? error.message : String(error),
      status: "unavailable",
    });
  }
}

export function startProcessMetrics(
  pid,
  {
    intervalMilliseconds = PROCESS_METRICS_INTERVAL_MILLISECONDS,
    platform = process.platform,
    read = readProcessMetrics,
  } = {},
) {
  if (platform === "win32" && read === readProcessMetrics) {
    return {
      async finish() {
        return Object.freeze({
          reason: WINDOWS_PROCESS_METRICS_UNAVAILABLE_REASON,
          status: "unavailable",
          intervalMilliseconds,
        });
      },
    };
  }
  const samples = [];
  const errors = [];
  const startedAt = performance.now();
  let sampling;
  const sample = async () => {
    if (sampling !== undefined) {
      return sampling;
    }
    const pending = (async () => {
      try {
        samples.push({ at: performance.now(), ...await read(pid) });
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    })();
    sampling = pending;
    void pending.finally(() => {
      if (sampling === pending) {
        sampling = undefined;
      }
    });
    return pending;
  };
  void sample();
  const timer = setInterval(() => void sample(), intervalMilliseconds);
  timer.unref();
  return {
    async finish() {
      clearInterval(timer);
      await sampling;
      await sample();
      if (samples.length < 2) {
        return Object.freeze({
          reason: errors.at(-1) ?? "Process metrics are unavailable",
          status: "unavailable",
          intervalMilliseconds,
        });
      }
      const first = samples[0];
      const last = samples[samples.length - 1];
      const elapsedMilliseconds = Math.max(
        1,
        performance.now() - startedAt,
      );
      const cpuMilliseconds = Math.max(
        0,
        last.cpuMilliseconds - first.cpuMilliseconds,
      );
      return Object.freeze({
        cpuMilliseconds,
        cpuPercent: (cpuMilliseconds / elapsedMilliseconds) * 100,
        errors: Object.freeze(errors),
        intervalMilliseconds,
        peakRssBytes: Math.max(...samples.map((entry) => entry.rssBytes)),
        samples: samples.length,
        status: "available",
      });
    },
  };
}
