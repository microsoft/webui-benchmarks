// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { createBrowserCases } from "../apps.mjs";
import { buildControlledClients } from "../build-clients.mjs";
import { startControlledBrowserServer } from "../controlled-browser-server.mjs";

test(
  "Solid hydrates direct lazy route requests",
  { skip: !existsSync(chromium.executablePath()), timeout: 120_000 },
  async () => {
    const [browserCase] = createBrowserCases(["solid"]);
    const clients = await buildControlledClients([browserCase]);
    assert.deepEqual([...clients.failures], []);
    const server = await startControlledBrowserServer({
      backend: undefined,
      browserCase,
      clientBundle: clients.bundles.get("solid"),
      serverRenderer: clients.serverRenderers.get("solid"),
    });
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      for (const route of ["activity", "settings"]) {
        const response = await page.goto(`${server.url}/${route}`, {
          waitUntil: "networkidle",
        });
        assert.equal(response?.ok(), true);
        await page.waitForSelector(
          `[data-route-page="${route}"]`,
          { timeout: 10_000 },
        ).catch(async (cause) => {
          throw new Error(
            `Solid did not hydrate /${route}: ${errors.join("; ")}\n${
              await page.locator("body").innerHTML()
            }`,
            { cause },
          );
        });
        assert.equal(
          await page.locator(`[data-route-page="${route}"]`).count(),
          1,
        );
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
      await browser.close();
      await server.stop();
    }
  },
);
