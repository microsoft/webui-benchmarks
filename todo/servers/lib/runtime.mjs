// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import process from "node:process";

export function runtimeVersion(runtimeId) {
  if (runtimeId === "bun" && typeof globalThis.Bun !== "undefined") {
    return globalThis.Bun.version;
  }
  if (runtimeId === "deno" && typeof globalThis.Deno !== "undefined") {
    return globalThis.Deno.version.deno;
  }
  return process.versions.node;
}
