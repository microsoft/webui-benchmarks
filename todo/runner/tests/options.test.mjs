// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PROTOCOL,
  QUICK_PROTOCOL,
  parseOptions,
} from "../lib/options.mjs";

test("default options use the timeboxed official measurement protocol", () => {
  const options = parseOptions([], {});
  assert.equal(options.quick, false);
  assert.equal(options.build, true);
  assert.equal(options.runtimeMode, "local");
  assert.equal(options.serverCpu, null);
  assert.equal(options.allowLoadErrors, false);
  assert.deepEqual(options.protocol, {
    connections: 64,
    durationSeconds: 20,
    loadWorkers: 2,
    rounds: 1,
    saturationConnections: [64, 128, 256, 512],
    saturationDurationSeconds: 4,
    warmupSeconds: 3,
  });
  assert.deepEqual(options.protocol, DEFAULT_PROTOCOL);
});

test("official mode pins the server to CPU zero by default", () => {
  const options = parseOptions(["--runtime-mode", "official"], {});
  assert.equal(options.serverCpu, 0);
  assert.equal(options.validateTelemetry, false);
});

test("telemetry overhead validation is opt-in", () => {
  assert.equal(parseOptions([], {}).validateTelemetry, false);
  assert.equal(
    parseOptions(["--validate-telemetry"], {}).validateTelemetry,
    true,
  );
});

test("load errors can be recorded for overload-tolerant runs", () => {
  assert.equal(
    parseOptions(["--allow-load-errors"], {}).allowLoadErrors,
    true,
  );
});

test("quick mode and targeted overrides parse without dependencies", () => {
  const options = parseOptions([
    "--quick",
    "--json",
    "--runtime-mode=official",
    "--save-baseline",
    "ci-01",
    "--case",
    "react,webui-node-http",
    "--connections",
    "12",
    "--duration=2.5",
    "--warmup",
    "1.5",
    "--rounds",
    "3",
    "--load-workers",
    "2",
    "--sweep",
    "1,4,12",
    "--sweep-duration",
    "2",
    "--scale-cores",
    "1,2",
    "--server-cpu",
    "0",
  ], {});
  assert.equal(options.quick, true);
  assert.equal(options.json, true);
  assert.equal(options.build, true);
  assert.equal(options.runtimeMode, "official");
  assert.equal(options.saveBaseline, "ci-01");
  assert.deepEqual(options.caseFilters, [
    "react",
    "webui-node-http",
  ]);
  assert.deepEqual(options.protocol, {
    ...QUICK_PROTOCOL,
    connections: 12,
    durationSeconds: 2.5,
    loadWorkers: 2,
    rounds: 3,
    saturationConnections: [1, 4, 12],
    saturationDurationSeconds: 2,
    warmupSeconds: 1.5,
  });

  assert.deepEqual(options.scalingCores, [1, 2]);
  assert.equal(options.serverCpu, 0);
});

test("pnpm argument separators are ignored", () => {
  const options = parseOptions(["--", "--quick", "--case", "react"], {});
  assert.equal(options.quick, true);
  assert.deepEqual(options.caseFilters, ["react"]);
});

test("option parsing rejects unsafe baselines and invalid protocol values", () => {
  assert.throws(
    () => parseOptions(["--save-baseline", "../escape"], {}),
    /invalid baseline/,
  );
  assert.throws(
    () => parseOptions(["--runtime-mode", "relaxed"], {}),
    /local.*official/,
  );
  assert.throws(
    () => parseOptions(["--connections", "0"], {}),
    /at least 1/,
  );
  assert.throws(() => parseOptions(["--unknown"], {}), /Unknown option/);
  assert.throws(
    () =>
      parseOptions([
        "--runtime-mode",
        "official",
        "--skip-build",
      ], {}),
    /not permitted/,
  );
});

test("response mode defaults to progressive and can be selected explicitly", () => {
  assert.equal(parseOptions([], {}).responseMode, "progressive");
  assert.equal(
    parseOptions(["--response-mode", "complete"], {}).responseMode,
    "complete",
  );
  assert.equal(
    parseOptions([], { WEBUI_BENCH_RESPONSE_MODE: "complete" }).responseMode,
    "complete",
  );
  assert.throws(
    () => parseOptions(["--response-mode", "eventual"], {}),
    /--response-mode must be/,
  );
});
