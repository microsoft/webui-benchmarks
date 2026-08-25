// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TODO_STATE_VARIANTS } from "../shared/state.mjs";

const defaultOutput = fileURLToPath(
  new URL("./generated/todo-states.json", import.meta.url),
);

export function serializeStatePool() {
  return JSON.stringify(TODO_STATE_VARIANTS);
}

export async function writeStatePool(outputPath = defaultOutput) {
  const resolvedPath = resolve(outputPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, serializeStatePool(), "utf8");
  return resolvedPath;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--output")) {
    throw new Error("Usage: node write-state-pool.mjs [--output <path>]");
  }
  const outputPath = await writeStatePool(args[1] ?? defaultOutput);
  process.stdout.write(`${JSON.stringify({ outputPath, status: "written" })}\n`);
}
