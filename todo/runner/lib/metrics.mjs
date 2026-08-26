// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";

export const WINDOWS_PROCESS_METRICS_UNAVAILABLE_REASON =
  "Windows process sampling is disabled because synchronous PowerShell probes perturb load measurements";

function linuxSample(pid) {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const fields = stat.slice(stat.lastIndexOf(") ") + 2).trim().split(/\s+/u);
  const status = readFileSync(`/proc/${pid}/status`, "utf8");
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

function windowsSample(pid) {
  const script = [
    `$process = Get-Process -Id ${pid} -ErrorAction Stop`,
    "[pscustomobject]@{ cpuMilliseconds = $process.CPU * 1000; rssBytes = $process.WorkingSet64 } | ConvertTo-Json -Compress",
  ].join("; ");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || "PowerShell process metrics failed");
  }
  return JSON.parse(result.stdout);
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

function posixSample(pid) {
  const result = spawnSync(
    "ps",
    ["-o", "time=", "-o", "rss=", "-p", String(pid)],
    { encoding: "utf8" },
  );
  if (result.status !== 0 || result.stdout.trim().length === 0) {
    throw new Error(result.stderr || "ps process metrics failed");
  }
  const match = result.stdout.trim().match(/^(\S+)\s+(\d+)$/u);
  if (match === null) {
    throw new Error("Unexpected ps process metrics output");
  }
  return {
    cpuMilliseconds: parseCpuTime(match[1]),
    rssBytes: Number(match[2]) * 1024,
  };
}

export function readProcessMetrics(pid, platform = process.platform) {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new RangeError("Process metrics require a valid PID");
  }
  if (platform === "linux") {
    return linuxSample(pid);
  }
  if (platform === "win32") {
    return windowsSample(pid);
  }
  return posixSample(pid);
}

export function startProcessMetrics(
  pid,
  {
    intervalMilliseconds = 200,
    platform = process.platform,
    read = readProcessMetrics,
  } = {},
) {
  if (platform === "win32" && read === readProcessMetrics) {
    return {
      finish() {
        return Object.freeze({
          reason: WINDOWS_PROCESS_METRICS_UNAVAILABLE_REASON,
          status: "unavailable",
        });
      },
    };
  }
  const samples = [];
  const errors = [];
  const startedAt = performance.now();
  const sample = () => {
    try {
      samples.push({ at: performance.now(), ...read(pid) });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  };
  sample();
  const timer = setInterval(sample, intervalMilliseconds);
  timer.unref();
  return {
    finish() {
      clearInterval(timer);
      sample();
      if (samples.length < 2) {
        return Object.freeze({
          reason: errors.at(-1) ?? "Process metrics are unavailable",
          status: "unavailable",
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
        peakRssBytes: Math.max(...samples.map((entry) => entry.rssBytes)),
        samples: samples.length,
        status: "available",
      });
    },
  };
}
