// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import { parseDemoArgs } from "../cli.mjs";

test("the demo defaults to the container contract", () => {
  assert.deepEqual(parseDemoArgs([], {}), {
    concurrency: 4,
    host: "0.0.0.0",
    port: 8080,
    rateLimit: 0,
  });
});

test("the hosting platform's PORT wins over the demo default", () => {
  assert.equal(parseDemoArgs([], { PORT: "3000" }).port, 3000);
  assert.equal(
    parseDemoArgs([], { PORT: "3000", WEBUI_DEMO_PORT: "9000" }).port,
    3000,
  );
  assert.equal(parseDemoArgs([], { WEBUI_DEMO_PORT: "9000" }).port, 9000);
});

test("command line options override the environment", () => {
  assert.deepEqual(
    parseDemoArgs(
      ["--port", "9100", "--host", "127.0.0.1", "--concurrency", "2", "--rate-limit", "0"],
      { PORT: "3000", WEBUI_DEMO_CONCURRENCY: "8" },
    ),
    { concurrency: 2, host: "127.0.0.1", port: 9100, rateLimit: 0 },
  );
});

test("invalid options are rejected instead of silently ignored", () => {
  assert.throws(() => parseDemoArgs(["--port"], {}), /requires a value/u);
  assert.throws(() => parseDemoArgs(["--port", "-1"], {}), /non-negative integer/u);
  assert.throws(() => parseDemoArgs(["--port", "70000"], {}), /valid TCP port/u);
  assert.throws(() => parseDemoArgs(["--unknown", "1"], {}), /Unknown option/u);
  assert.throws(() => parseDemoArgs([], { PORT: "http" }), /non-negative integer/u);
});
