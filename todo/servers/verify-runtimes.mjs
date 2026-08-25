// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolveRuntimeExecutable } from "./lib/runtime-executable.mjs";

const versionsPath = fileURLToPath(
  new URL("./runtime-versions.json", import.meta.url),
);

export function loadRuntimePins() {
  return JSON.parse(readFileSync(versionsPath, "utf8"));
}

function normalizeVersion(output) {
  const match = output.match(/\d+\.\d+\.\d+/);
  return match?.[0] ?? null;
}

function runVersionCommand(definition, runtimeId) {
  const command = resolveRuntimeExecutable(runtimeId);
  const result = spawnSync(command, definition.args, {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error?.code === "ENOENT") {
    return { installed: false, version: null };
  }
  if (result.error) {
    return {
      error: result.error.message,
      executable: command,
      installed: false,
      version: null,
    };
  }
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return {
    error: result.status === 0 ? null : output.trim(),
    executable: command,
    installed: result.status === 0,
    version: normalizeVersion(output),
  };
}

export function verifyRuntimeMatrix({
  official = false,
  pins = loadRuntimePins(),
  run = runVersionCommand,
} = {}) {
  const runtimes = [];
  let supported = true;
  for (const [runtimeId, definition] of Object.entries(pins.runtimes)) {
    const observed = run(definition, runtimeId);
    const versionMatches =
      observed.installed && observed.version === definition.version;
    let status = "available";
    if (!observed.installed) {
      status = official ? "unsupported" : "skipped";
    } else if (!versionMatches && official) {
      status = "unsupported";
    }
    if (status === "unsupported") {
      supported = false;
    }
    runtimes.push(Object.freeze({
      code: !observed.installed
        ? "runtime-not-installed"
        : versionMatches
          ? null
          : "runtime-version-mismatch",
      error: observed.error ?? null,
      executable: observed.executable ?? null,
      expectedVersion: definition.version,
      installed: observed.installed,
      required: official,
      runtimeId,
      status,
      version: observed.version,
      versionMatches,
    }));
  }
  return Object.freeze({
    mode: official ? "official" : "local",
    runtimes: Object.freeze(runtimes),
    schema: pins.schema,
    status: supported ? "ok" : "unsupported",
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const known = new Set(["--official"]);
  for (const argument of process.argv.slice(2)) {
    if (!known.has(argument)) {
      throw new Error(`Unknown option '${argument}'`);
    }
  }
  const result = verifyRuntimeMatrix({
    official: process.argv.includes("--official"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "ok") {
    process.exitCode = 1;
  }
}
