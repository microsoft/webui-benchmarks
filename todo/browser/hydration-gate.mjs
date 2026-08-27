// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { resolve } from "node:path";
import process from "node:process";
import { createCaseMatrix } from "../runner/lib/cases.mjs";
import { BASELINE_ROOT } from "../runner/lib/paths.mjs";
import { isMainModule } from "../servers/lib/cli.mjs";
import { CANONICAL_INTERACTION_STEP_IDS } from "./interactions.mjs";
import { runBrowserBenchmark } from "./runner.mjs";

const defaultOutputPath = resolve(
  BASELINE_ROOT,
  "ssr-todo-hydration-gate.json",
);

function interactionFailure(round) {
  const interactions = round.metrics?.interactions;
  if (interactions?.totalDurationMs?.status !== "available") {
    return "canonical interaction sequence did not complete";
  }
  const steps = Object.values(interactions.steps ?? {});
  if (
    steps.length !== CANONICAL_INTERACTION_STEP_IDS.length
    || steps.some(({ status }) => status !== "available")
  ) {
    return `all ${CANONICAL_INTERACTION_STEP_IDS.length} canonical interaction steps must be available`;
  }
  const evidence = interactions.evidence;
  if (
    evidence?.initialCompleted !== 25
    || evidence?.initialPending !== 75
    || evidence?.totalBeforeClear !== 100
    || evidence?.completedBeforeClear !== 26
    || evidence?.remainingAfterClear !== 74
    || evidence?.selectedSentinel !== "todo-0050"
    || evidence?.activityEvents !== 48
    || evidence?.activityVisibleAfterFilter !== 16
    || evidence?.activitySentinel !== "activity-0026"
    || evidence?.settingsDensity !== "compact"
    || evidence?.settingsSaved !== true
    || evidence?.workItemsAfterReturn !== 100
    || evidence?.workspaceArchived !== 1
    || evidence?.workspaceAfterClear !== 74
    || evidence?.workspaceExportRows !== 1
    || !["completed", "pending"].includes(evidence?.workspaceFacets?.status)
    || !["high", "medium", "low"].includes(evidence?.workspaceFacets?.priority)
    || !["assigned", "unassigned"].includes(
      evidence?.workspaceFacets?.assignment,
    )
    || evidence?.workspaceFinalResults !== 100
    || evidence?.workspaceSavedViews !== 1
    || evidence?.workspaceSchedule !== "weekly"
    || evidence?.workspaceSearchResult !== 1
    || evidence?.workspaceSelectedSentinel !== "todo-0050"
    || JSON.stringify(evidence?.workspaceViews) !== '["board","insights"]'
  ) {
    return "canonical interaction evidence does not match the shared contract";
  }
  return null;
}

export function hydrationGateFailures(report) {
  const expected = createCaseMatrix().map(({ id }) => id);
  const rounds = Array.isArray(report?.rawRounds) ? report.rawRounds : [];
  const byProduct = new Map(rounds.map((round) => [round.productId, round]));
  const failures = [];
  if (rounds.length !== expected.length || byProduct.size !== expected.length) {
    failures.push(
      `hydration gate requires exactly ${expected.length} distinct product rows`,
    );
  }
  for (const productId of expected) {
    const round = byProduct.get(productId);
    if (round === undefined) {
      failures.push(`${productId}: browser round is missing`);
      continue;
    }
    if (round.status !== "ok") {
      failures.push(`${productId}: ${round.reason ?? "browser round failed"}`);
      continue;
    }
    if (round.readiness?.status !== "ready") {
      failures.push(`${productId}: hydration readiness was not published`);
      continue;
    }
    if (!["supported", "deferred"].includes(round.readiness.hydration?.status)) {
      failures.push(`${productId}: hydration did not complete or defer correctly`);
      continue;
    }
    if (
      round.fullHydration?.status !== "hydrated"
      || round.metrics?.timings?.requestToFullHydrationMs?.status !== "available"
    ) {
      failures.push(`${productId}: full hydration timing is unavailable`);
      continue;
    }
    const interaction = interactionFailure(round);
    if (interaction !== null) {
      failures.push(`${productId}: ${interaction}`);
    }
  }
  return failures;
}

export function assertHydrationGate(report) {
  const failures = hydrationGateFailures(report);
  if (failures.length > 0) {
    throw new Error(`SSR hydration gate failed:\n${failures.join("\n")}`);
  }
}

export async function runHydrationGate({
  build = false,
  outputPath = defaultOutputPath,
} = {}) {
  const result = await runBrowserBenchmark({
    build,
    mode: "quick",
    outputPath,
    progress(message) {
      process.stderr.write(`${message}\n`);
    },
  });
  assertHydrationGate(result.report);
  process.stdout.write(
    `Hydration gate passed for ${result.report.rawRounds.length} product rows\n`,
  );
  return result;
}

if (isMainModule(import.meta.url)) {
  await runHydrationGate({ build: process.argv.includes("--build") });
}
