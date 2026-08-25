// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { promisify } from "node:util";

const KIBIBYTE = 1_024;
const SAMPLE_TIMEOUT_MS = 5_000;
const execFileAsync = promisify(execFile);

function available(value) {
  return Number.isFinite(value) && value >= 0
    ? Object.freeze({ status: "available", value })
    : null;
}

function unavailable(reason) {
  return Object.freeze({ reason, status: "unavailable" });
}

function metric(value, reason) {
  return available(value) ?? unavailable(reason);
}

function parseKibibyteField(text, name) {
  const prefix = `${name}:`;
  const line = text.split(/\r?\n/u).find((candidate) =>
    candidate.startsWith(prefix)
  );
  if (line === undefined) {
    return null;
  }
  const value = Number(line.slice(prefix.length).trim().split(/\s+/u)[0]);
  return Number.isFinite(value) ? value * KIBIBYTE : null;
}

export function parseWindowsProcessMemory(text) {
  const [privateText, workingSetText, ...extra] = text.trim().split(",");
  const privateBytes = Number(privateText);
  const workingSetBytes = Number(workingSetText);
  if (
    extra.length > 0
    || !Number.isFinite(privateBytes)
    || !Number.isFinite(workingSetBytes)
  ) {
    throw new Error("Windows process memory output is invalid");
  }
  return Object.freeze({ privateBytes, workingSetBytes });
}

export function parseLinuxProcStatus(text) {
  const workingSetBytes = parseKibibyteField(text, "VmRSS");
  if (workingSetBytes === null) {
    throw new Error("Linux proc status omitted VmRSS");
  }
  return Object.freeze({ workingSetBytes });
}

export function parseLinuxSmapsRollup(text) {
  const fields = ["Private_Clean", "Private_Dirty", "Private_Hugetlb"];
  const values = fields.map((name) => parseKibibyteField(text, name));
  if (values.every((value) => value === null)) {
    throw new Error("Linux smaps rollup omitted private memory fields");
  }
  return Object.freeze({
    privateBytes: values.reduce((total, value) => total + (value ?? 0), 0),
  });
}

export function parseMacProcessMemory(text) {
  const workingSetKibibytes = Number(text.trim());
  if (!Number.isFinite(workingSetKibibytes)) {
    throw new Error("macOS ps output is invalid");
  }
  return Object.freeze({
    workingSetBytes: workingSetKibibytes * KIBIBYTE,
  });
}

async function execute(command, args) {
  return execFileAsync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1_024,
    timeout: SAMPLE_TIMEOUT_MS,
    windowsHide: true,
  });
}

async function readText(path) {
  return readFile(path, "utf8");
}

function timed(operation, description) {
  let timer;
  return Promise.race([
    operation,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${description} timed out`)),
        SAMPLE_TIMEOUT_MS,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

function failedSample(pid, platform, method, reason) {
  return Object.freeze({
    method,
    pid,
    platform,
    privateBytes: unavailable(reason),
    workingSetBytes: unavailable(reason),
  });
}

async function sampleWindows(pid, executeCommand) {
  const command = [
    `$p=Get-Process -Id ${pid} -ErrorAction Stop`,
    "[Console]::Out.Write(('{0},{1}' -f $p.PrivateMemorySize64,$p.WorkingSet64))",
  ].join("; ");
  const { stdout } = await timed(
    executeCommand("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      command,
    ]),
    "Windows Get-Process",
  );
  return parseWindowsProcessMemory(stdout);
}

async function sampleLinux(pid, readProcessFile) {
  const status = parseLinuxProcStatus(
    await timed(
      readProcessFile(`/proc/${pid}/status`),
      "Linux proc status",
    ),
  );
  let privateBytes;
  let privateReason;
  try {
    privateBytes = parseLinuxSmapsRollup(
      await timed(
        readProcessFile(`/proc/${pid}/smaps_rollup`),
        "Linux smaps rollup",
      ),
    ).privateBytes;
  } catch (error) {
    privateReason = error instanceof Error ? error.message : String(error);
  }
  return {
    privateBytes,
    privateReason,
    workingSetBytes: status.workingSetBytes,
  };
}

async function sampleMac(pid, executeCommand) {
  const { stdout } = await timed(
    executeCommand("ps", ["-o", "rss=", "-p", String(pid)]),
    "macOS ps",
  );
  return parseMacProcessMemory(stdout);
}

export async function sampleRendererProcessMemory(
  pid,
  {
    executeCommand = execute,
    platform = process.platform,
    readProcessFile = readText,
  } = {},
) {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new RangeError("Renderer PID must be a positive integer");
  }
  try {
    if (platform === "win32") {
      const sample = await sampleWindows(pid, executeCommand);
      return Object.freeze({
        method: "PowerShell Get-Process PrivateMemorySize64/WorkingSet64",
        pid,
        platform,
        privateBytes: metric(
          sample.privateBytes,
          "Get-Process omitted PrivateMemorySize64",
        ),
        workingSetBytes: metric(
          sample.workingSetBytes,
          "Get-Process omitted WorkingSet64",
        ),
      });
    }
    if (platform === "linux") {
      const sample = await sampleLinux(pid, readProcessFile);
      return Object.freeze({
        method: "/proc/<pid>/status and /proc/<pid>/smaps_rollup",
        pid,
        platform,
        privateBytes: metric(
          sample.privateBytes,
          sample.privateReason ?? "Linux private memory is unavailable",
        ),
        workingSetBytes: metric(
          sample.workingSetBytes,
          "Linux proc status omitted VmRSS",
        ),
      });
    }
    if (platform === "darwin") {
      const sample = await sampleMac(pid, executeCommand);
      return Object.freeze({
        method: "ps rss",
        pid,
        platform,
        privateBytes: unavailable(
          "macOS ps does not expose renderer private bytes",
        ),
        workingSetBytes: metric(
          sample.workingSetBytes,
          "macOS ps omitted RSS",
        ),
      });
    }
    return failedSample(
      pid,
      platform,
      "unsupported platform",
      `Renderer process memory sampling is unsupported on ${platform}`,
    );
  } catch (error) {
    return failedSample(
      pid,
      platform,
      platform === "win32"
        ? "PowerShell Get-Process"
        : platform === "linux"
          ? "/proc"
          : platform === "darwin"
            ? "ps rss"
            : "unsupported platform",
      error instanceof Error ? error.message : String(error),
    );
  }
}
