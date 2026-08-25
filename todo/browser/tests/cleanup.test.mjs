// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import {
  portableBuildPlan,
  withCaseResources,
  withFreshChromium,
} from "../runner.mjs";

test("wraps Windows command shims without changing build policy", () => {
  const definition = Object.freeze({
    args: ["--dir", "todo/apps/next", "build"],
    command: "pnpm.cmd",
    id: "full-stack-next",
  });
  const [portable] = portableBuildPlan([definition], "win32");
  assert.equal(portable.command.endsWith("cmd.exe"), true);
  assert.deepEqual(portable.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.match(portable.args[3], /^pnpm\.cmd --dir todo\/apps\/next build$/u);
  assert.equal(definition.command, "pnpm.cmd");
});

test("stops the browser proxy and production backend after measurement failure", async () => {
  const events = [];
  const browserCase = {
    appId: "test",
    controlled: true,
    sourceCase: {},
  };
  await assert.rejects(
    withCaseResources({
      browserCase,
      clientBundle: Buffer.from("client"),
      operation() {
        events.push("measure");
        throw new Error("measurement failed");
      },
      registry: {},
      startBackend: async () => ({
        announcement: {
          appId: undefined,
          runtimeId: undefined,
          schema: "webui.ssr-todo-server/v1",
          serverId: undefined,
          stateVariantCount: 32,
          status: "ready",
          url: "http://backend.test",
          workerCount: 1,
        },
        async stop() {
          events.push("backend-stop");
        },
      }),
      startBrowserServer: async () => ({
        url: "http://browser.test",
        async stop() {
          events.push("proxy-stop");
        },
      }),
      warmServer: async () => {
        events.push("warm");
      },
    }),
    /measurement failed/u,
  );
  assert.deepEqual(events, [
    "warm",
    "measure",
    "proxy-stop",
    "backend-stop",
  ]);
});

test("stops the backend when browser proxy startup fails", async () => {
  const events = [];
  const browserCase = {
    appId: "test",
    controlled: true,
    sourceCase: {},
  };
  await assert.rejects(
    withCaseResources({
      browserCase,
      clientBundle: Buffer.from("client"),
      operation() {
        assert.fail("measurement must not run");
      },
      registry: {},
      startBackend: async () => ({
        announcement: {
          appId: undefined,
          runtimeId: undefined,
          schema: "webui.ssr-todo-server/v1",
          serverId: undefined,
          stateVariantCount: 32,
          status: "ready",
          url: "http://backend.test",
          workerCount: 1,
        },
        async stop() {
          events.push("backend-stop");
        },
      }),
      startBrowserServer: async () => {
        throw new Error("proxy failed");
      },
      warmServer: async () => {
        assert.fail("warmup must not run");
      },
    }),
    /proxy failed/u,
  );
  assert.deepEqual(events, ["backend-stop"]);
});

test("cleans browser-only Solid SSR without launching the headline backend", async () => {
  const events = [];
  const serverRenderer = Object.freeze({ render() {} });
  await assert.rejects(
    withCaseResources({
      browserCase: {
        appId: "solid",
        controlled: true,
        sourceCase: {},
      },
      clientBundle: Buffer.from("client"),
      operation() {
        events.push("measure");
        throw new Error("measurement failed");
      },
      registry: {},
      serverRenderer,
      startBackend() {
        assert.fail("headline backend must not start");
      },
      startBrowserServer: async (options) => {
        assert.equal(options.backend, undefined);
        assert.equal(options.serverRenderer, serverRenderer);
        return {
          announcement: {},
          url: "http://solid-browser.test",
          async stop() {
            events.push("browser-stop");
          },
        };
      },
      warmServer: async () => {
        events.push("warm");
      },
    }),
    /measurement failed/u,
  );
  assert.deepEqual(events, ["warm", "measure", "browser-stop"]);
});

test("closes a fresh Chromium process after each successful sample", async () => {
  const events = [];
  const result = await withFreshChromium(
    async () => {
      events.push("measure");
      return "ok";
    },
    {
      launch: async (options) => {
        assert.equal(options.headless, true);
        return {
          async close() {
            events.push("browser-close");
          },
        };
      },
    },
  );
  assert.equal(result, "ok");
  assert.deepEqual(events, ["measure", "browser-close"]);
});

test("passes headed mode through to the Chromium launcher", async () => {
  await withFreshChromium(
    async () => "ok",
    {
      headless: false,
      launch: async (options) => {
        assert.equal(options.headless, false);
        return {
          async close() {},
        };
      },
    },
  );
});

test("closes a fresh Chromium process after measurement failure", async () => {
  const events = [];
  await assert.rejects(
    withFreshChromium(
      async () => {
        events.push("measure");
        throw new Error("failed");
      },
      {
        launch: async () => ({
          async close() {
            events.push("browser-close");
          },
        }),
      },
    ),
    /failed/u,
  );
  assert.deepEqual(events, ["measure", "browser-close"]);
});
