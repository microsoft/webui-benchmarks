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
  "hydrates WebUI variants and serves partial routes without benchmark headers",
  { skip: !existsSync(chromium.executablePath()), timeout: 120_000 },
  async () => {
    const cases = createBrowserCases([
      "webui-rust-actix",
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
              const search = page.locator(
                '[data-action="workspace-search"]',
              );
              await search.focus();
              await page.waitForFunction(
                () => globalThis.__TODO_BENCH_HYDRATED__?.status === "hydrated",
              );
              await search.fill("Todo 0050");
              await page.locator(
                '.workspace-intelligence[data-result-count="1"]',
              ).waitFor();
              await page.locator(
                '[data-action="workspace-view"][data-view="insights"]',
              ).click();
              await page.locator(
                '[data-workspace-panel="insights"]',
              ).waitFor();
              const partialResponse = await context.request.get(
                `${url}/activity`,
                { headers: { accept: "application/json" } },
              );
              assert.equal(partialResponse.status(), 200);
              assert.match(
                partialResponse.headers()["content-type"],
                /^application\/json\b/u,
              );
              assert.equal((await partialResponse.json()).path, "/activity");
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
