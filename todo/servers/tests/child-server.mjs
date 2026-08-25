// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";

export async function spawnServer(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const lines = createInterface({ input: child.stdout });
  const timeoutMilliseconds = options.timeoutMilliseconds ?? 30_000;
  let timer;
  let announcement;
  try {
    announcement = await new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(
            `${command} did not announce readiness within ${timeoutMilliseconds}ms\n${stderr}`,
          ),
        );
      }, timeoutMilliseconds);
      child.once("error", reject);
      child.once("exit", (code) => {
        reject(
          new Error(
            `${command} exited with ${code} before announcing status\n${stderr}`,
          ),
        );
      });
      lines.on("line", (line) => {
        try {
          const value = JSON.parse(line);
          if (value.status === "ready" || value.status === "unsupported") {
            resolve(value);
          }
        } catch {
          // Ignore runtime diagnostics that are not the machine-readable record.
        }
      });
    });
  } catch (error) {
    lines.close();
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  return {
    announcement,
    child,
    stderr() {
      return stderr;
    },
    async stop() {
      lines.close();
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      const exited = once(child, "exit");
      child.kill();
      await exited;
    },
    async waitForExit() {
      if (child.exitCode !== null || child.signalCode !== null) {
        return {
          code: child.exitCode,
          signal: child.signalCode,
        };
      }
      const [code, signal] = await once(child, "exit");
      return { code, signal };
    },
  };
}
