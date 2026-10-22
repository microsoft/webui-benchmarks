// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  syncWebuiBenchmarkSummary,
  validateCampaignSummary,
} from "../sync-webui-benchmark-summary.mjs";

function summary() {
  return {
    benchmarks: {
      campaign: {
        canonicalWebuiVersion: "3.0.4",
        browserMeasuredAt: "2026-10-22T01:47:35.884Z",
        completeMeasuredAt: "2026-10-22T01:39:47.554Z",
        progressiveMeasuredAt: "2026-10-22T01:29:33.368Z",
        browserRoundsPerApp: 10,
        serverMeasuredRounds: 1,
        responseModes: ["complete", "progressive"],
        workingTreeDirty: false,
        fixtureDigest: "f".repeat(64),
        matrixId: "official-ssr-matrix",
        rowCount: 15,
        sourceCommit: "c".repeat(40),
        sourceDigest: "f".repeat(64),
        status: "official-uniform",
        uniformOfficialMatrix: true,
      },
      metrics: Array.from({ length: 5 }, (_, index) => ({ id: index })),
      responseMode: "comparison",
      responseModes: ["complete", "progressive"],
      rows: Array.from({ length: 15 }, (_, index) => ({ caseId: `${index}` })),
    },
  };
}

function inputSummary() {
  const value = summary();
  return {
    ...value,
    benchmarksJson: JSON.stringify(value.benchmarks),
  };
}

test("validates a 15-row official comparison", () => {
  assert.equal(validateCampaignSummary(inputSummary()).campaign.rowCount, 15);
});

test("rejects a summary with stale row count or response mode", () => {
  const stale = inputSummary();
  stale.benchmarks.rows.pop();
  assert.throws(
    () => validateCampaignSummary(stale),
    /15-row, five-metric/u,
  );
});

test("copies only a validated summary into a sibling WebUI checkout", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "webui-benchmark-sync-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const checkout = join(directory, "webui");
  const input = join(directory, "benchmark-summary.json");
  await mkdir(join(checkout, "docs/.webui-press/state"), { recursive: true });
  await writeFile(join(checkout, "docs/package.json"), '{"name":"@webui/docs"}');
  await writeFile(input, JSON.stringify(inputSummary()), "utf8");
  const destination = join(checkout, "docs/.webui-press/state/benchmark-summary.json");
  const result = await syncWebuiBenchmarkSummary({
    checkoutPath: checkout,
    inputPath: input,
    optional: false,
  });
  assert.equal(result.copied, true);
  const contents = await readFile(destination, "utf8");
  assert.equal(contents, JSON.stringify(inputSummary()));
  await writeFile(input, '{"benchmarks":{"rows":[]}}');
  await assert.rejects(
    syncWebuiBenchmarkSummary({ checkoutPath: checkout, inputPath: input }),
    /15-row, five-metric/u,
  );
  assert.equal(await readFile(destination, "utf8"), contents);
});

test("can skip synchronization only when the sibling checkout is absent", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "webui-benchmark-sync-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const checkoutPath = join(directory, "missing");
  const result = await syncWebuiBenchmarkSummary({
    checkoutPath,
    optional: true,
  });
  assert.deepEqual(result, {
    copied: false,
    reason: "WebUI checkout is not present",
  });
  await assert.rejects(syncWebuiBenchmarkSummary({ checkoutPath }), /does not exist/u);
});

test("rejects invalid provenance and a stale serialized mirror", () => {
  for (const mutate of [
    (value) => { value.benchmarks.campaign.sourceDigest = "s".repeat(64); },
    (value) => { value.benchmarks.campaign.sourceDigest = "a".repeat(64); },
    (value) => { value.benchmarks.campaign.browserMeasuredAt = "invalid"; },
    (value) => { value.benchmarks.campaign.workingTreeDirty = true; },
    (value) => { value.benchmarks.responseMode = "progressive"; },
    (value) => { value.benchmarks.rows[0].caseId = "changed"; },
  ]) {
    const value = inputSummary();
    mutate(value);
    assert.throws(() => validateCampaignSummary(value), /15-row, five-metric/u);
  }
});
