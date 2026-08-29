// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { spawnSync } from "node:child_process";
import { cpus } from "node:os";
import process from "node:process";

function defaultRun(command, args) {
  return spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
  });
}

export function applyProcessAffinity(
  pid,
  cpuIndex,
  {
    cpuCount = cpus().length,
    platform = process.platform,
    run = defaultRun,
  } = {},
) {
  if (cpuIndex === null) {
    return Object.freeze({
      cpuIndex: null,
      status: "not-requested",
    });
  }
  if (
    !Number.isInteger(pid)
    || pid <= 0
    || !Number.isInteger(cpuIndex)
    || cpuIndex < 0
    || cpuIndex >= cpuCount
  ) {
    throw new RangeError(
      `CPU affinity index must be between 0 and ${Math.max(0, cpuCount - 1)}`,
    );
  }
  let command;
  let args;
  if (platform === "win32") {
    if (cpuIndex >= 63) {
      return Object.freeze({
        cpuIndex,
        reason: "Windows affinity masks above CPU 62 are not supported",
        status: "unavailable",
      });
    }
    command = "powershell.exe";
    args = [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$process = Get-Process -Id ${pid} -ErrorAction Stop; $process.ProcessorAffinity = [IntPtr](1L -shl ${cpuIndex})`,
    ];
  } else if (platform === "linux") {
    command = "taskset";
    args = [
      "--all-tasks",
      "--cpu-list",
      "--pid",
      String(cpuIndex),
      String(pid),
    ];
  } else {
    return Object.freeze({
      cpuIndex,
      reason: `CPU affinity is not implemented for ${platform}`,
      status: "unavailable",
    });
  }
  const result = run(command, args);
  if (result.error || result.status !== 0) {
    return Object.freeze({
      cpuIndex,
      reason:
        result.error?.message
        ?? `${result.stderr ?? result.stdout ?? "affinity command failed"}`.trim(),
      status: "unavailable",
    });
  }
  return Object.freeze({
    cpuIndex,
    status: "applied",
  });
}
