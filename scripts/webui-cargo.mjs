// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import {
  REPOSITORY_ROOT,
  configuredWebuiCheckout,
  webuiCargoArguments,
} from "../todo/shared/webui-dependency.mjs";

const args = process.argv.slice(2);
if (args[0] === "--") {
  args.shift();
}
if (args.length === 0) {
  throw new Error(
    "Usage: pnpm run webui:cargo -- <cargo arguments>",
  );
}

const lockPath = resolve(REPOSITORY_ROOT, "Cargo.lock");
const preserveLock = configuredWebuiCheckout() !== null;
const previousLock = preserveLock && existsSync(lockPath)
  ? readFileSync(lockPath)
  : null;
let result;
try {
  result = spawnSync(
    process.platform === "win32" ? "cargo.exe" : "cargo",
    webuiCargoArguments(args),
    {
      cwd: REPOSITORY_ROOT,
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (result.error) {
    throw result.error;
  }
} finally {
  if (preserveLock) {
    if (previousLock === null) {
      rmSync(lockPath, { force: true });
    } else {
      writeFileSync(lockPath, previousLock);
    }
  }
}
process.exitCode = result.status ?? 1;
