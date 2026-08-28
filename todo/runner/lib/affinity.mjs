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
    coreCount = 1,
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
  // `coreCount` reserves a contiguous CPU range starting at `cpuIndex`
  // instead of a single core. It exists so a process whose own design uses
  // more than one concurrently-active OS thread (for example, an HTTP
  // worker thread plus a separate render worker thread) can be isolated on
  // enough real cores to let those threads genuinely run in parallel,
  // while still applying the exact same one-process/N-reserved-cores
  // policy used for every other case. It defaults to 1, which reproduces
  // today's single-core pin byte-for-byte for every existing caller.
  if (!Number.isInteger(coreCount) || coreCount < 1) {
    throw new RangeError("CPU affinity core count must be a positive integer");
  }
  const lastCpuIndex = cpuIndex + coreCount - 1;
  if (
    !Number.isInteger(pid)
    || pid <= 0
    || !Number.isInteger(cpuIndex)
    || cpuIndex < 0
    || lastCpuIndex >= cpuCount
  ) {
    throw new RangeError(
      `CPU affinity range must fit between 0 and ${Math.max(0, cpuCount - 1)}`,
    );
  }
  const result = { cpuIndex };
  if (coreCount !== 1) {
    result.coreCount = coreCount;
  }
  let command;
  let args;
  if (platform === "win32") {
    if (lastCpuIndex >= 63) {
      return Object.freeze({
        ...result,
        reason: "Windows affinity masks above CPU 62 are not supported",
        status: "unavailable",
      });
    }
    const mask = coreCount === 1
      ? `1L -shl ${cpuIndex}`
      : `((1L -shl ${coreCount}) - 1L) -shl ${cpuIndex}`;
    command = "powershell.exe";
    args = [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$process = Get-Process -Id ${pid} -ErrorAction Stop; $process.ProcessorAffinity = [IntPtr](${mask})`,
    ];
  } else if (platform === "linux") {
    const cpuList = coreCount === 1
      ? String(cpuIndex)
      : `${cpuIndex}-${lastCpuIndex}`;
    command = "taskset";
    args = [
      "--all-tasks",
      "--cpu-list",
      "--pid",
      cpuList,
      String(pid),
    ];
  } else {
    return Object.freeze({
      ...result,
      reason: `CPU affinity is not implemented for ${platform}`,
      status: "unavailable",
    });
  }
  const commandResult = run(command, args);
  if (commandResult.error || commandResult.status !== 0) {
    return Object.freeze({
      ...result,
      reason:
        commandResult.error?.message
        ?? `${commandResult.stderr ?? commandResult.stdout ?? "affinity command failed"}`.trim(),
      status: "unavailable",
    });
  }
  return Object.freeze({
    ...result,
    status: "applied",
  });
}
