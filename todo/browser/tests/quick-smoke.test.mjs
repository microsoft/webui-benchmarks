// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import test from "node:test";
import { CANONICAL_INTERACTION_STEP_IDS } from "../interactions.mjs";
import { runBrowserBenchmark } from "../runner.mjs";
import { validateBrowserReport } from "../schema.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const artifactRoot = resolve(here, ".artifacts");
const outputPath = resolve(artifactRoot, "browser-quick.json");

test(
  "runs real quick React, Solid, and Astro outcomes with cleanup",
  { skip: !existsSync(chromium.executablePath()), timeout: 120_000 },
  async () => {
    await rm(artifactRoot, { force: true, recursive: true });
    try {
      const { report } = await runBrowserBenchmark({
        appFilters: [
          "webui-rust-actix",
          "webui-shadowdom-rust-actix",
          "webui-fast-rust-actix",
          "react",
          "react-tanstack",
          "solid",
          "astro",
        ],
        build: false,
        mode: "quick",
        outputPath,
      });
      const validation = validateBrowserReport(report);
      assert.equal(validation.valid, true, validation.errors.join("\n"));
      assert.ok(
        report.rawRounds.every(
          (round) =>
            round.status === "ok"
            && round.navigationTiming.nextHopProtocol === "h2",
        ),
        "every browser sample must negotiate HTTP/2",
      );
      const react = report.apps.find(({ appId }) => appId === "react");
      const solid = report.apps.find(({ appId }) => appId === "solid");
      const astro = report.apps.find(({ appId }) => appId === "astro");
      const reactRound = report.rawRounds.find(
        ({ appId }) => appId === "react",
      );
      const tanstackRound = report.rawRounds.find(
        ({ appId }) => appId === "react-tanstack",
      );
      const webuiRound = report.rawRounds.find(
        ({ productId }) => productId === "webui-rust-actix",
      );
      const shadowRound = report.rawRounds.find(
        ({ productId }) => productId === "webui-shadowdom-rust-actix",
      );
      const fastRound = report.rawRounds.find(
        ({ productId }) => productId === "webui-fast-rust-actix",
      );
      const solidRound = report.rawRounds.find(
        ({ appId }) => appId === "solid",
      );
      const astroRound = report.rawRounds.find(
        ({ appId }) => appId === "astro",
      );
      assert.equal(react.label, "React");
      assert.equal(webuiRound.status, "ok", webuiRound.reason);
      assert.equal(
        webuiRound.metrics.timings.timeToFirstByteMs.status,
        "available",
      );
      assert.equal(
        webuiRound.metrics.timings.requestToFirstByteMs.status,
        "available",
      );
      const webuiTimingNames = webuiRound.navigationTiming.serverTiming.map(
        ({ name }) => name,
      );
      assert.ok(webuiTimingNames.includes("webui-stream-setup"));
      assert.equal(webuiTimingNames.includes("browser-adapter-total"), false);
      assert.equal(webuiRound.server.serverId, "actix");
      assert.equal(shadowRound.status, "ok", shadowRound.reason);
      assert.equal(shadowRound.server.serverId, "actix");
      assert.match(shadowRound.server.command, /webui-shadowdom/u);
      assert.ok(shadowRound.metrics.dom.shadowRootCount.value >= 800);
      assert.deepEqual(
        Object.values(shadowRound.metrics.interactions.steps).map(
          ({ status }) => status,
        ),
        Array(CANONICAL_INTERACTION_STEP_IDS.length).fill("available"),
      );
      assert.equal(
        shadowRound.metrics.interactions.totalDurationMs.status,
        "available",
      );
      assert.equal(fastRound.status, "ok", fastRound.reason);
      assert.equal(fastRound.server.serverId, "actix");
      assert.match(fastRound.server.command, /webui-fast/u);
      assert.ok(fastRound.metrics.dom.shadowRootCount.value >= 800);
      assert.deepEqual(
        Object.values(fastRound.metrics.interactions.steps).map(
          ({ status }) => status,
        ),
        Array(CANONICAL_INTERACTION_STEP_IDS.length).fill("available"),
      );
      assert.equal(
        fastRound.metrics.interactions.totalDurationMs.status,
        "available",
      );
      assert.equal(reactRound.status, "ok");
      assert.equal(reactRound.readiness.clientMode, react.clientMode);
      assert.ok(
        reactRound.paint.installedAtMs
          <= reactRound.metrics.timings.firstContentfulPaintMs.value,
      );
      assert.ok(
        reactRound.paint.finalizedAtMs
          <= reactRound.paint.interactionStartedAtMs,
      );
      assert.equal(reactRound.paint.label, "pre-interaction LCP");
      assert.ok(reactRound.paint.largestContentfulPaint.size > 0);
      assert.ok(
        reactRound.paint.largestContentfulPaint.element.tagName.length > 0,
      );
      assert.equal(
        reactRound.processMemory.garbageCollection.completedPasses,
        3,
      );
      assert.equal(
        reactRound.processMemory.rendererSelection.status,
        "selected",
      );
      for (
        const metric of [
          reactRound.metrics.timings.firstContentfulPaintMs,
          reactRound.metrics.timings.largestContentfulPaintMs,
          reactRound.metrics.memory.jsHeapUsedBytes,
          reactRound.metrics.memory.rendererWorkingSetBytes,
        ]
      ) {
        assert.equal(metric.status, "available");
        assert.ok(metric.value > 0);
      }
      if (process.platform === "darwin") {
        assert.equal(
          reactRound.metrics.memory.rendererPrivateBytes.status,
          "unavailable",
        );
      } else {
        assert.equal(
          reactRound.metrics.memory.rendererPrivateBytes.status,
          "available",
        );
        assert.ok(
          reactRound.metrics.memory.rendererPrivateBytes.value > 0,
        );
      }
      assert.equal(
        reactRound.metrics.interactions.steps.clearCompletedMs.status,
        "available",
      );
      assert.equal(tanstackRound.status, "ok", tanstackRound.reason);
      assert.equal(
        tanstackRound.metrics.interactions.routeNavigationTotalMs.status,
        "available",
      );
      assert.equal(solid.browserOutcome.status, "supported");
      assert.equal(solid.browserTierSsr.generate, "ssr");
      assert.equal(solid.browserTierSsr.hydratable, true);
      assert.equal(solid.clientMode, "hydrate");
      assert.equal(solidRound.status, "ok", solidRound.reason);
      assert.equal(solidRound.readiness.clientMode, solid.clientMode);
      assert.equal(solidRound.server.serverId, "solid-browser-ssr");
      assert.ok(solidRound.server.browserSsrBundleBytes > 100);
      assert.equal(solidRound.readiness.hydration.status, "supported");
      assert.equal(solidRound.semanticValidation.status, "validated");
      assert.equal(
        solidRound.metrics.timings.hydrationMs.status,
        "available",
      );
      assert.ok(solidRound.metrics.timings.hydrationMs.value > 0);
      assert.deepEqual(
        Object.values(solidRound.metrics.interactions.steps).map(
          ({ status }) => status,
        ),
        Array(CANONICAL_INTERACTION_STEP_IDS.length).fill("available"),
      );
      assert.equal(
        solidRound.metrics.interactions.evidence.selectedSentinel,
        "todo-0050",
      );
      assert.equal(astroRound.status, "ok", astroRound.reason);
      assert.equal(astro.label, "Astro + Preact");
      assert.equal(astro.clientMode, "framework-island-hydrate");
      assert.equal(astroRound.readiness.hydration.status, "supported");
      assert.equal(astroRound.requestState.status, "validated");
      assert.deepEqual(
        Object.values(astroRound.metrics.interactions.steps).map(
          ({ status }) => status,
        ),
        Array(CANONICAL_INTERACTION_STEP_IDS.length).fill("available"),
      );
      assert.equal(
        astroRound.metrics.javascript.externalTransferBytes.status,
        "available",
      );
      assert.equal(
        astroRound.metrics.javascript.inlineBytes.status,
        "available",
      );
      assert.ok(astroRound.metrics.javascript.inlineBytes.value >= 0);
      assert.ok(astroRound.metrics.javascript.inlineCount.value >= 0);
      assert.ok(
        astroRound.metrics.javascript.externalTransferBytes.value > 0,
      );
      assert.equal(
        astroRound.metrics.javascript.transferBytes.value,
        astroRound.metrics.javascript.externalTransferBytes.value
          + astroRound.metrics.javascript.inlineBytes.value,
      );
      assert.ok(astroRound.metrics.javascript.transferBytes.value > 0);
      assert.equal(report.cleanup.processRegistryEmpty, true);
      assert.equal(report.browser.processPerSample, true);
      assert.match(report.browser.contextIsolation, /fresh foreground Chromium/u);
      assert.equal(report.browser.cpuThrottling, "none");
      assert.equal(report.browser.networkThrottling, "none");
      const persisted = JSON.parse(await readFile(outputPath, "utf8"));
      assert.equal(persisted.schema, report.schema);
    } finally {
      await rm(artifactRoot, { force: true, recursive: true });
    }
  },
);
