// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import {
  UnsupportedRuntimeError,
  unsupportedResult,
} from "../lib/capability.mjs";
import { parseServerArgs } from "../lib/cli.mjs";
import { resolveNativeAddon } from "../lib/webui-engine.mjs";
import {
  loadRuntimePins,
  verifyRuntimeMatrix,
} from "../verify-runtimes.mjs";
import { serializeStatePool } from "../write-state-pool.mjs";
import { spawnServer } from "./child-server.mjs";

test("absent Deno is skipped locally and required officially", () => {
  const pins = loadRuntimePins();
  const run = (definition, runtimeId) =>
    runtimeId === "deno"
      ? { installed: false, version: null }
      : { installed: true, version: definition.version };
  const local = verifyRuntimeMatrix({ pins, run });
  const localDeno = local.runtimes.find(({ runtimeId }) => runtimeId === "deno");
  assert.equal(local.status, "ok");
  assert.equal(localDeno.status, "skipped");
  assert.equal(localDeno.code, "runtime-not-installed");
  assert.equal(localDeno.required, false);

  const official = verifyRuntimeMatrix({ official: true, pins, run });
  const officialDeno = official.runtimes.find(
    ({ runtimeId }) => runtimeId === "deno",
  );
  assert.equal(official.status, "unsupported");
  assert.equal(officialDeno.status, "unsupported");
  assert.equal(officialDeno.required, true);
});

test("runtime mismatches are informational locally and fatal officially", () => {
  const pins = loadRuntimePins();
  const run = (definition, runtimeId) => ({
    installed: true,
    version: runtimeId === "bun" ? "1.3.14" : definition.version,
  });
  assert.equal(verifyRuntimeMatrix({ pins, run }).status, "ok");
  assert.equal(
    verifyRuntimeMatrix({ official: true, pins, run }).status,
    "unsupported",
  );
});

test("local capability probe uses pinned package runtimes", () => {
  const local = verifyRuntimeMatrix();
  const bun = local.runtimes.find(({ runtimeId }) => runtimeId === "bun");
  const deno = local.runtimes.find(({ runtimeId }) => runtimeId === "deno");
  assert.ok(deno);
  assert.equal(bun?.versionMatches, true);
  assert.equal(deno.versionMatches, true);
  assert.equal(bun?.status, "available");
  assert.equal(deno.status, "available");
  assert.equal(local.status, "ok");
});

test("missing native addon reports actionable unsupported capability", async () => {
  await assert.rejects(
    resolveNativeAddon("missing-native-addon-for-test.node"),
    (error) => {
      assert.ok(error instanceof UnsupportedRuntimeError);
      assert.equal(error.code, "native-addon-path-missing");
      assert.match(error.message, /does not exist/);
      assert.match(error.help, /WEBUI_ADDON_PATH/);
      const result = unsupportedResult({
        appId: "webui",
        error,
        runtimeId: "bun",
        runtimeVersion: "1.3.14",
        serverId: "bun-serve",
      });
      assert.equal(result.status, "unsupported");
      assert.equal(result.responseBytes, null);
      assert.equal(result.addonCapability.supported, false);
      assert.equal(result.addonCapability.fallback, "disabled");
      return true;
    },
  );
});

test("CLI validates ports and isolates renderer ids as values", () => {
  assert.deepEqual(
    parseServerArgs(["--port", "0", "--app", "react"], {
      allowApp: true,
    }),
    {
      addonPath: process.env.WEBUI_ADDON_PATH,
      appId: "react",
      host: "127.0.0.1",
      port: 0,
      protocolPath: process.env.WEBUI_BENCH_PROTOCOL,
      responseMode: "progressive",
    },
  );
  assert.throws(() => parseServerArgs(["--port", "70000"]), /Invalid port/);
  assert.throws(
    () => parseServerArgs(["--app", "../../shared"]),
    /Unknown option/,
  );
});

test("CLI parses and validates --response-mode", () => {
  assert.equal(
    parseServerArgs(["--response-mode", "complete"]).responseMode,
    "complete",
  );
  assert.throws(
    () => parseServerArgs(["--response-mode", "eventual"]),
    /--response-mode must be/,
  );
});

test("CLI accepts an explicit WebUI protocol", () => {
  assert.equal(
    parseServerArgs(["--protocol", "todo/apps/webui-shadowdom/dist/protocol.bin"])
      .protocolPath,
    "todo/apps/webui-shadowdom/dist/protocol.bin",
  );
});

test("serialized Rust pool is the exact shared 32-state pool", async () => {
  const [{ TODO_STATE_VARIANTS }, { STATE_VARIANT_COUNT }] = await Promise.all([
    import("../../shared/state.mjs"),
    import("../../shared/contract.mjs"),
  ]);
  const serialized = serializeStatePool();
  const parsed = JSON.parse(serialized);
  assert.equal(parsed.length, STATE_VARIANT_COUNT);
  assert.equal(parsed[0].variantId, TODO_STATE_VARIANTS[0].variantId);
  assert.equal(parsed[31].variantId, TODO_STATE_VARIANTS[31].variantId);
  assert.equal(serialized, JSON.stringify(TODO_STATE_VARIANTS));
});

test("child server helper reaps a process that never announces", async () => {
  await assert.rejects(
    spawnServer(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { timeoutMilliseconds: 50 },
    ),
    /did not announce readiness/,
  );
});
