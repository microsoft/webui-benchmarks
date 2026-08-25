// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { spawn } from "node:child_process";
import process from "node:process";

const OUTPUT_LIMIT = 64 * 1024;

function appendBounded(previous, chunk, limit = OUTPUT_LIMIT) {
  const combined = previous + chunk;
  return combined.length <= limit ? combined : combined.slice(-limit);
}

function childExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

export async function waitForChildExit(child) {
  if (childExited(child)) {
    return Object.freeze({
      code: child.exitCode,
      signal: child.signalCode,
    });
  }
  return new Promise((resolveExit) => {
    child.once("exit", (code, signal) => {
      resolveExit(Object.freeze({ code, signal }));
    });
    child.once("error", (error) => {
      resolveExit(Object.freeze({ code: null, error, signal: null }));
    });
  });
}

async function stopWindowsProcessTree(pid) {
  const script = [
    `$root = ${pid}`,
    "$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId",
    "$pending = [System.Collections.Generic.List[uint32]]::new()",
    "$pending.Add([uint32]$root)",
    "for ($index = 0; $index -lt $pending.Count; $index += 1) {",
    "  $parent = $pending[$index]",
    "  foreach ($child in $all) {",
    "    if ($child.ParentProcessId -eq $parent) { $pending.Add($child.ProcessId) }",
    "  }",
    "}",
    "for ($index = $pending.Count - 1; $index -ge 0; $index -= 1) {",
    "  Stop-Process -Id $pending[$index] -Force -ErrorAction SilentlyContinue",
    "}",
  ].join("; ");
  const cleanup = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      stdio: "ignore",
      windowsHide: true,
    },
  );
  await waitForChildExit(cleanup);
}

function signalUnixTree(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (groupError) {
    try {
      process.kill(pid, signal);
    } catch (processError) {
      if (processError.code !== "ESRCH" && groupError.code !== "ESRCH") {
        throw processError;
      }
    }
  }
}

export async function terminateProcessTree(
  child,
  { graceMilliseconds = 2_000, platform = process.platform } = {},
) {
  if (childExited(child)) {
    return waitForChildExit(child);
  }
  if (!Number.isInteger(child.pid) || child.pid <= 0) {
    return waitForChildExit(child);
  }
  if (platform === "win32") {
    await stopWindowsProcessTree(child.pid);
    return waitForChildExit(child);
  }

  const exited = waitForChildExit(child);
  signalUnixTree(child.pid, "SIGTERM");
  let timer;
  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => {
      timer = setTimeout(resolve, graceMilliseconds, false);
      timer.unref();
    }),
  ]);
  clearTimeout(timer);
  if (!graceful && !childExited(child)) {
    signalUnixTree(child.pid, "SIGKILL");
  }
  return exited;
}

export class ProcessRegistry {
  #entries = [];
  #stopping = null;

  register(entry) {
    if (entry === null || typeof entry?.stop !== "function") {
      throw new TypeError("A managed process entry must provide stop()");
    }
    this.#entries.push(entry);
    return entry;
  }

  release(entry) {
    const index = this.#entries.lastIndexOf(entry);
    if (index !== -1) {
      this.#entries.splice(index, 1);
    }
  }

  async stop(entry) {
    this.release(entry);
    await entry.stop();
  }

  async stopAll() {
    if (this.#stopping !== null) {
      return this.#stopping;
    }
    this.#stopping = (async () => {
      const entries = this.#entries.splice(0).reverse();
      const failures = [];
      for (const entry of entries) {
        try {
          await entry.stop();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, "Failed to stop all child processes");
      }
    })();
    try {
      await this.#stopping;
    } finally {
      this.#stopping = null;
    }
  }

  get size() {
    return this.#entries.length;
  }
}

export function spawnManagedProcess(
  command,
  args,
  {
    cwd,
    env = process.env,
    registry,
    stdio = ["ignore", "pipe", "pipe"],
  } = {},
) {
  if (!(registry instanceof ProcessRegistry)) {
    throw new TypeError("spawnManagedProcess requires a ProcessRegistry");
  }
  const child = spawn(command, args, {
    cwd,
    detached: process.platform !== "win32",
    env,
    stdio,
    windowsHide: true,
  });
  let stopped = false;
  const entry = registry.register({
    child,
    async stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      await terminateProcessTree(child);
    },
  });
  child.once("exit", () => {
    registry.release(entry);
  });
  return entry;
}

export async function runManagedCommand(
  command,
  args,
  { cwd, env, registry } = {},
) {
  const startedAt = performance.now();
  const entry = spawnManagedProcess(command, args, { cwd, env, registry });
  const { child } = entry;
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    stdout = appendBounded(stdout, chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr = appendBounded(stderr, chunk);
  });
  let spawnError = null;
  child.once("error", (error) => {
    spawnError = error;
  });
  const exit = await waitForChildExit(child);
  registry.release(entry);
  const result = Object.freeze({
    command,
    durationMilliseconds: performance.now() - startedAt,
    exitCode: exit.code,
    signal: exit.signal,
    stderr,
    stdout,
  });
  if (spawnError !== null) {
    throw new Error(`Failed to launch ${command}: ${spawnError.message}`, {
      cause: spawnError,
    });
  }
  if (exit.code !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited with ${exit.code}\n${stderr || stdout}`,
    );
  }
  return result;
}

export function installProcessCleanup(registry) {
  let handling = false;
  const handlers = new Map();
  for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143]]) {
    const handler = () => {
      if (handling) {
        process.exit(exitCode);
        return;
      }
      handling = true;
      void registry.stopAll().finally(() => {
        process.exit(exitCode);
      });
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  return () => {
    for (const [signal, handler] of handlers) {
      process.off(signal, handler);
    }
  };
}
