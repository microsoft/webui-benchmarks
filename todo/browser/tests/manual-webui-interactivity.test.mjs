// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { createBrowserCases } from "../apps.mjs";
import { buildControlledClients } from "../build-clients.mjs";
import { withCaseResources } from "../runner.mjs";
import { ProcessRegistry } from "../../runner/lib/process-tree.mjs";

test(
  "hydrates direct WebUI variants without benchmark request headers",
  { skip: !existsSync(chromium.executablePath()), timeout: 120_000 },
  async () => {
    const cases = createBrowserCases([
      "webui-shadowdom-rust-actix",
      "webui-fast-rust-actix",
    ]);
    const clients = await buildControlledClients(cases);
    assert.deepEqual([...clients.failures], []);
    const registry = new ProcessRegistry();
    const browser = await chromium.launch({ headless: true });
    try {
      for (const browserCase of cases) {
        await withCaseResources({
          browserCase,
          clientBundle: clients.bundles.get(browserCase.appId),
          operation: async ({ url }) => {
            const context = await browser.newContext({
              ignoreHTTPSErrors: true,
            });
            const page = await context.newPage();
            const pageErrors = [];
            page.on("pageerror", (error) => pageErrors.push(error.message));
            try {
              await page.goto(`${url}/dynamic`);
              await page.waitForFunction(
                () => globalThis.__TODO_BENCH_READY__?.status === "ready",
              );
              assert.equal(
                await page.locator(
                  'script[src="/__browser/webui.js"]',
                ).count(),
                1,
              );
              await page.locator(
                '[data-action="workspace-search"]',
              ).fill("Todo 0050");
              await page.locator(
                '.workspace-intelligence[data-result-count="1"]',
              ).waitFor();
              await page.locator(
                '[data-action="workspace-view"][data-view="insights"]',
              ).click();
              await page.locator(
                '[data-workspace-panel="insights"]',
              ).waitFor();
              assert.deepEqual(pageErrors, []);
            } finally {
              await context.close();
            }
          },
          registry,
          serverRenderer: clients.serverRenderers.get(browserCase.appId),
        });
      }
    } finally {
      await browser.close();
      await registry.stopAll();
    }
  },
);
