// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isMainModule } from "../todo/servers/lib/cli.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultCheckout = resolve(repositoryRoot, "..", "webui");
const defaultInput = resolve(repositoryRoot, "results", "benchmark-summary.json");
const defaultDestination =
  "docs/.webui-press/state/benchmark-summary.json";

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export function validateCampaignSummary(summary) {
  const benchmarks = summary?.benchmarks;
  if (
    !benchmarks
    || benchmarks.responseMode !== "comparison"
    || !Array.isArray(benchmarks.responseModes)
    || benchmarks.responseModes.join(",") !== "complete,progressive"
    || !Array.isArray(benchmarks.metrics)
    || !Array.isArray(benchmarks.rows)
    || benchmarks.rows.length !== 15
    || benchmarks.metrics.length !== 5
    || benchmarks.campaign?.status !== "official-uniform"
    || benchmarks.campaign?.uniformOfficialMatrix !== true
    || benchmarks.campaign?.rowCount !== 15
    || benchmarks.campaign?.matrixId !== "official-ssr-matrix"
    || !/^\d+\.\d+\.\d+$/u.test(
      benchmarks.campaign?.canonicalWebuiVersion ?? "",
    )
    || !/^[0-9a-f]{40}$/u.test(
      benchmarks.campaign?.sourceCommit ?? "",
    )
    || !/^[0-9a-f]{64}$/u.test(
      benchmarks.campaign?.sourceDigest ?? "",
    )
    || !/^[0-9a-f]{64}$/u.test(
      benchmarks.campaign?.fixtureDigest ?? "",
    )
    || benchmarks.campaign.sourceDigest !== benchmarks.campaign.fixtureDigest
    || benchmarks.campaign.workingTreeDirty !== false
    || benchmarks.campaign.serverMeasuredRounds !== 1
    || benchmarks.campaign.browserRoundsPerApp !== 10
    || benchmarks.campaign.responseModes?.join(",") !== "complete,progressive"
    || ![
      benchmarks.campaign.progressiveMeasuredAt,
      benchmarks.campaign.completeMeasuredAt,
      benchmarks.campaign.browserMeasuredAt,
    ].every((value) => typeof value === "string"
      && Number.isFinite(Date.parse(value)))
    || JSON.stringify(JSON.parse(summary.benchmarksJson))
      !== JSON.stringify(benchmarks)
  ) {
    throw new Error(
      "Benchmark summary must be a 15-row, five-metric complete/progressive official comparison",
    );
  }
  return benchmarks;
}

export async function syncWebuiBenchmarkSummary({
  inputPath = defaultInput,
  checkoutPath = defaultCheckout,
  optional = false,
} = {}) {
  if (!(await pathExists(checkoutPath))) {
    if (optional) {
      return {
        copied: false,
        reason: "WebUI checkout is not present",
      };
    }
    throw new Error(`WebUI checkout does not exist: ${checkoutPath}`);
  }

  const manifestPath = resolve(checkoutPath, "docs", "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.name !== "@webui/docs") {
    throw new Error(`Not a WebUI docs checkout: ${checkoutPath}`);
  }
  const summaryPath = resolve(checkoutPath, defaultDestination);
  const input = resolve(repositoryRoot, inputPath);
  const summary = JSON.parse(await readFile(input, "utf8"));
  validateCampaignSummary(summary);
  await mkdir(dirname(summaryPath), { recursive: true });
  await copyFile(input, summaryPath);
  return {
    copied: true,
    destination: summaryPath,
    input,
  };
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help")) {
    process.stdout.write(
      "Usage: node scripts/sync-webui-benchmark-summary.mjs [--input <summary.json>] [--webui <checkout>] [--optional]\n",
    );
    return null;
  }

  const input = option(argv, "--input");
  const checkout = option(argv, "--webui");
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--input" || argv[index] === "--webui") {
      index += 1;
    } else if (argv[index] !== "--optional") {
      throw new Error(`Unknown option '${argv[index]}'`);
    }
  }
  const result = await syncWebuiBenchmarkSummary({
    inputPath: input === undefined ? defaultInput : resolve(repositoryRoot, input),
    checkoutPath: checkout === undefined
      ? defaultCheckout
      : resolve(repositoryRoot, checkout),
    optional: argv.includes("--optional") && checkout === undefined,
  });
  if (result.copied) {
    process.stdout.write(`Synchronized benchmark summary: ${result.destination}\n`);
  } else {
    process.stdout.write(`Skipped benchmark summary synchronization: ${result.reason}\n`);
  }
  return result;
}

if (isMainModule(import.meta.url)) {
  await main();
}
