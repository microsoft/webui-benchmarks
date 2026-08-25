// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveRuntimeExecutable } from "../lib/runtime-executable.mjs";
import {
  TODO_STATE_VARIANTS,
  createRequestTodoState,
} from "../../shared/state.mjs";
import {
  collectHtmlObservation as collectObservation,
} from "../../shared/observation.mjs";
import { assertValidObservation } from "../../shared/validator.mjs";
import { resolveNativeAddon } from "../lib/webui-engine.mjs";
import { spawnServer } from "./child-server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const benchmarkPath = resolve(here, "..", "..", "..");
const bunCheck = spawnSync(resolveRuntimeExecutable("bun"), ["--version"], {
  encoding: "utf8",
  windowsHide: true,
});
const hasBun = bunCheck.status === 0;

test(
  "Bun.serve materializes request state for the native WebUI renderer",
  { skip: !hasBun },
  async () => {
    const addon = await resolveNativeAddon();
    const server = await spawnServer(
      "bun",
      ["todo/servers/bun.mjs", "--port", "0", "--addon", addon.path],
      {
        cwd: benchmarkPath,
        env: {
          ...process.env,
          NODE_ENV: "production",
          WEBUI_ADDON_PATH: addon.path,
        },
      },
    );
    try {
      assert.equal(server.announcement.status, "ready");
      assert.equal(server.announcement.runtimeId, "bun");
      assert.equal(server.announcement.serverId, "bun-serve");
      assert.equal(server.announcement.addonCapability.path, addon.path);
      const response = await fetch(`${server.announcement.url}/dynamic`);
      assert.equal(response.headers.get("content-encoding"), null);
      assert.equal(response.headers.get("x-webui-bench-variant"), "0");
      const timestamp = response.headers.get("x-webui-bench-timestamp");
      assert.match(timestamp, /^\d{4}-\d{2}-\d{2}T/u);
      const html = await response.text();
      assertValidObservation(
        collectObservation(html),
        createRequestTodoState(TODO_STATE_VARIANTS[0], timestamp),
      );
      const cachedFirst = await fetch(`${server.announcement.url}/cached`);
      const cachedSecond = await fetch(`${server.announcement.url}/cached`);
      assert.deepEqual(
        Buffer.from(await cachedSecond.arrayBuffer()),
        Buffer.from(await cachedFirst.arrayBuffer()),
      );
    } finally {
      await server.stop();
    }
    assert.ok(
      server.child.exitCode !== null || server.child.signalCode !== null,
      "Bun child process should be reaped",
    );
  },
);

test(
  "Bun reports native-addon failure as machine-readable unsupported",
  { skip: !hasBun },
  async () => {
    const missingAddon = resolve(
      benchmarkPath,
      "todo",
      "servers",
      "missing-addon.node",
    );
    const server = await spawnServer(
      "bun",
      [
        "todo/servers/bun.mjs",
        "--port",
        "0",
        "--addon",
        missingAddon,
      ],
      {
        cwd: benchmarkPath,
        env: {
          ...process.env,
          WEBUI_ADDON_PATH: missingAddon,
        },
      },
    );
    const exit = await server.waitForExit();
    assert.equal(server.announcement.status, "unsupported");
    assert.equal(
      server.announcement.addonCapability.code,
      "native-addon-path-missing",
    );
    assert.equal(server.announcement.addonCapability.fallback, "disabled");
    assert.equal(exit.code, 78);
    assert.match(server.stderr(), /help:/);
  },
);
