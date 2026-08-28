// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { applyProcessAffinity } from "./affinity.mjs";
import { createBuildPlan, runBuildPlan } from "./builds.mjs";
import {
  HEADLINE_INPUT_POLICY,
  NATURAL_PAYLOAD_POLICY,
  OFFICIAL_MATRIX_ID,
  createCaseMatrix,
  filterCases,
} from "./cases.mjs";
import {
  assertBuildArtifacts,
  collectFrameworkVersions,
  collectMachineMetadata,
  collectSourceRevision,
  collectToolVersions,
  collectWebuiDependency,
  computeFixtureHash,
} from "./metadata.mjs";
import {
  measureLoadWithRetry,
  runSaturationSweep,
  warmup,
} from "./load.mjs";
import { deterministicOrder } from "./order.mjs";
import {
  ProcessRegistry,
  installProcessCleanup,
} from "./process-tree.mjs";
import { evaluateRuntimePolicy } from "./runtime-policy.mjs";
import { REPORT_SCHEMA, assertReportSchema } from "./schema.mjs";
import { launchCaseServer } from "./server.mjs";
import {
  summarizeResponseByteProfiles,
  summarizeRounds,
} from "./statistics.mjs";
import { routeForCase, validateServerContract } from "./validation.mjs";
import { verifyRuntimeMatrix } from "../../servers/verify-runtimes.mjs";

function runtimeDecisionMap(policy) {
  return new Map(
    policy.decisions.map((decision) => [decision.runtimeId, decision]),
  );
}

function serializableCase(benchmarkCase, status, reason = null) {
  return {
    appId: benchmarkCase.appId,
    headline: benchmarkCase.headline,
    id: benchmarkCase.id,
    inputPolicy: benchmarkCase.inputPolicy,
    label: benchmarkCase.label,
    matrixId: benchmarkCase.matrixId,
    mode: benchmarkCase.mode,
    payloadPolicy: benchmarkCase.payloadPolicy,
    productKind: benchmarkCase.productKind,
    reason,
    renderer: benchmarkCase.renderer,
    runtimeId: benchmarkCase.runtimeId,
    serverId: benchmarkCase.serverId,
    status,
    streaming: benchmarkCase.streaming,
    tier: benchmarkCase.tier,
    transport: benchmarkCase.transport,
    workerCount: benchmarkCase.workerCount,
  };
}

function skippedBuilds(plan) {
  return plan.map((definition) => ({
    command: definition.display,
    id: definition.id,
    status: "not-run",
  }));
}

function failureCanSkip(options) {
  return options.runtimeMode === "local" && options.quick;
}

export function canSkipUnavailableCase(options, {
  round,
  serverStarted,
}) {
  return failureCanSkip(options) && round === 0 && !serverStarted;
}

export function unsupportedReason(announcement, fallback) {
  return announcement.message
    ?? announcement.addonCapability?.message
    ?? announcement.code
    ?? announcement.addonCapability?.code
    ?? fallback;
}

function metricsStatus(measurement) {
  if (
    measurement.serverMetrics.status !== "available"
    || measurement.loadGenerator.status === "unavailable"
    || measurement.latencyP95Status === "unavailable"
  ) {
    return "metrics-unavailable";
  }
  return measurement.loadGenerator.status === "bottleneck-risk"
    ? "load-generator-bottleneck-risk"
    : "ok";
}

function summarizeCases(cases, rawRounds) {
  const summaries = [];
  for (const benchmarkCase of cases) {
    const rounds = rawRounds.filter(
      (round) => round.caseId === benchmarkCase.id,
    );
    if (rounds.length === 0) {
      continue;
    }
    const responseByteProfile = summarizeResponseByteProfiles(
      rounds.map((round) => round.responseByteProfile),
    );
    summaries.push(Object.freeze({
      appId: benchmarkCase.appId,
      caseId: benchmarkCase.id,
      headline: benchmarkCase.headline,
      inputPolicy: benchmarkCase.inputPolicy,
      label: benchmarkCase.label,
      naturalResponseBytes: responseByteProfile.dynamic.mean,
      payloadPolicy: benchmarkCase.payloadPolicy,
      productKind: benchmarkCase.productKind,
      renderer: benchmarkCase.renderer,
      responseByteProfile,
      responseBytes: responseByteProfile.dynamic.mean,
      streaming: benchmarkCase.streaming,
      tier: benchmarkCase.tier,
      transport: benchmarkCase.transport,
      workerCount: benchmarkCase.workerCount,
      ...summarizeRounds(rounds),
    }));
  }
  return Object.freeze(summaries);
}

function naturalResponseByteSummary(summaries) {
  const rows = summaries.map((summary) =>
    Object.freeze({
      caseId: summary.caseId,
      maximum: summary.responseByteProfile.dynamic.maximum,
      mean: summary.responseByteProfile.dynamic.mean,
      minimum: summary.responseByteProfile.dynamic.minimum,
    })
  );
  return Object.freeze({
    byCase: Object.freeze(rows),
    maximum: rows.length === 0
      ? 0
      : Math.max(...rows.map((row) => row.maximum)),
    minimum: rows.length === 0
      ? 0
      : Math.min(...rows.map((row) => row.minimum)),
    policy: NATURAL_PAYLOAD_POLICY,
  });
}

export async function prepareLoadMeasurement({
  protocol,
  saturationContext,
  saturationNeeded,
  url,
}, {
  runSweep = runSaturationSweep,
  runWarmup = warmup,
} = {}) {
  const warmupResult = await runWarmup(url, protocol);
  const sweep = saturationNeeded
    ? await runSweep(url, protocol, saturationContext)
    : null;
  return Object.freeze({ sweep, warmupResult });
}

async function launchValidatedCase({
  benchmarkCase,
  expectedAddonPath,
  options,
  registry,
  verifiedRuntime,
}) {
  const server = await launchCaseServer(benchmarkCase, {
    registry,
    timeoutMilliseconds: options.quick ? 30_000 : 60_000,
  });
  try {
    if (server.announcement.status !== "ready") {
      throw new Error(
        unsupportedReason(
          server.announcement,
          `${benchmarkCase.id} is unsupported`,
        ),
      );
    }
    const addonPath = server.announcement.addonCapability?.path;
    if (
      typeof addonPath === "string"
      && expectedAddonPath !== null
      && expectedAddonPath !== addonPath
    ) {
      throw new Error(
        `${benchmarkCase.id} loaded ${addonPath}, expected ${expectedAddonPath}`,
      );
    }
    if (
      verifiedRuntime !== undefined
      && server.announcement.runtimeVersion !== verifiedRuntime.version
    ) {
      throw new Error(
        `${benchmarkCase.id} launched runtime ${server.announcement.runtimeVersion}, expected observed ${verifiedRuntime.version}`,
      );
    }
    const affinity = applyProcessAffinity(
      server.child.pid,
      options.serverCpu,
    );
    if (
      affinity.status === "unavailable"
      && options.runtimeMode === "official"
    ) {
      throw new Error(
        `${benchmarkCase.id} could not apply CPU affinity: ${affinity.reason}`,
      );
    }
    const validation = await validateServerContract(benchmarkCase, server);
    return Object.freeze({
      addonPath: typeof addonPath === "string" ? addonPath : expectedAddonPath,
      affinity,
      server,
      url: `${server.announcement.url}${routeForCase(benchmarkCase)}`,
      validation,
    });
  } catch (error) {
    await server.stop();
    throw error;
  }
}

export async function runBenchmark(options, {
  progress = () => {},
} = {}) {
  const selectedCases = filterCases(
    createCaseMatrix(),
    options.caseFilters,
  );
  const fixtureBefore = computeFixtureHash();
  const sourceRevision = collectSourceRevision(fixtureBefore.value);
  const requiredRuntimes = [
    "node",
    ...selectedCases
      .map((benchmarkCase) => benchmarkCase.runtimeId)
      .filter((runtimeId) => runtimeId !== "rust"),
  ];
  const runtimeVerification = verifyRuntimeMatrix({
    official: options.runtimeMode === "official",
  });
  const runtimePolicy = evaluateRuntimePolicy(
    runtimeVerification,
    options,
    requiredRuntimes,
  );
  if (runtimePolicy.status === "failed") {
    const failures = runtimePolicy.decisions
      .filter((decision) => decision.status === "failed")
      .map((decision) => decision.reason);
    throw new Error(`Runtime policy failed:\n${failures.join("\n")}`);
  }
  const decisions = runtimeDecisionMap(runtimePolicy);
  const verifiedRuntimes = new Map(
    runtimeVerification.runtimes.map((runtime) => [
      runtime.runtimeId,
      runtime,
    ]),
  );
  const registry = new ProcessRegistry();
  const disposeCleanup = installProcessCleanup(registry);
  const buildPlan = createBuildPlan(selectedCases);
  let builds = skippedBuilds(buildPlan);
  const rawRounds = [];
  const saturation = [];
  const caseStates = new Map();
  const caseReasons = new Map();
  try {
    if (options.build) {
      builds = await runBuildPlan(buildPlan, { progress, registry });
    }
    if (options.build || !options.quick) {
      await assertBuildArtifacts(selectedCases);
    }

    for (const benchmarkCase of selectedCases) {
      const decision = decisions.get(benchmarkCase.runtimeId);
      if (decision?.status === "skipped") {
        caseStates.set(benchmarkCase.id, "skipped");
        caseReasons.set(benchmarkCase.id, decision.reason);
      } else {
        caseStates.set(benchmarkCase.id, "pending");
      }
    }

    const saturatedCases = new Set();
    let nativeAddonPath = null;
    for (let round = 0; round < options.protocol.rounds; round += 1) {
      const runnable = selectedCases.filter((benchmarkCase) => {
        const status = caseStates.get(benchmarkCase.id);
        return status === "pending" || status === "complete";
      });
      const ordered = deterministicOrder(runnable, round);
      for (let orderIndex = 0; orderIndex < ordered.length; orderIndex += 1) {
        const benchmarkCase = ordered[orderIndex];
        progress(
          `round ${round + 1}/${options.protocol.rounds} ${benchmarkCase.id}`,
        );
        let server;
        try {
          let launched = await launchValidatedCase({
            benchmarkCase,
            expectedAddonPath: nativeAddonPath,
            options,
            registry,
            verifiedRuntime: verifiedRuntimes.get(benchmarkCase.runtimeId),
          });
          server = launched.server;
          nativeAddonPath = launched.addonPath;
          let { affinity, url, validation } = launched;
          const saturationNeeded = !saturatedCases.has(benchmarkCase.id);
          let warmupResult;
          if (saturationNeeded) {
            const { sweep } = await prepareLoadMeasurement({
              protocol: options.protocol,
              saturationContext: {
               processId: server.child.pid,
               responseBytes: validation.measuredBytes,
               responseByteProfile: validation.responseByteProfile,
              },
              saturationNeeded: true,
              url,
            });
            saturation.push(Object.freeze({
              caseId: benchmarkCase.id,
              affinity,
              ...sweep,
            }));
            saturatedCases.add(benchmarkCase.id);
            await server.stop();
            server = undefined;
            launched = await launchValidatedCase({
              benchmarkCase,
              expectedAddonPath: nativeAddonPath,
              options,
              registry,
              verifiedRuntime: verifiedRuntimes.get(benchmarkCase.runtimeId),
            });
            server = launched.server;
            nativeAddonPath = launched.addonPath;
            ({ affinity, url, validation } = launched);
          }
          warmupResult = await warmup(url, options.protocol);
          const measurement = await measureLoadWithRetry(url, {
            connections: options.protocol.connections,
            durationSeconds: options.protocol.durationSeconds,
            loadWorkers: options.protocol.loadWorkers,
            processId: server.child.pid,
            responseBytes: validation.measuredBytes,
          });
          rawRounds.push(Object.freeze({
            affinity,
            caseId: benchmarkCase.id,
            headline: benchmarkCase.headline,
            inputPolicy: benchmarkCase.inputPolicy,
            latencyP50Ms: measurement.latencyP50Ms,
            latencyP95Ms: measurement.latencyP95Ms,
            latencyP99Ms: measurement.latencyP99Ms,
            latencyP95Status: measurement.latencyP95Status,
            loadGenerator: measurement.loadGenerator,
            metricsStatus: metricsStatus(measurement),
            measurementAttempts: measurement.measurementAttempts,
            naturalResponseBytes: validation.naturalResponseBytes,
            orderIndex,
            payloadPolicy: validation.payloadPolicy,
            requests: measurement.requests,
            requestsPerSecond: measurement.requestsPerSecond,
            responseByteProfile: validation.responseByteProfile,
            responseBytes: validation.measuredBytes,
            round,
            serverMetrics: measurement.serverMetrics,
            streaming: benchmarkCase.streaming,
            throughputBytesPerSecond:
              measurement.throughputBytesPerSecond,
            tier: benchmarkCase.tier,
            warmup: warmupResult,
          }));
          caseStates.set(benchmarkCase.id, "complete");
        } catch (error) {
          if (!canSkipUnavailableCase(options, {
            round,
            serverStarted: server !== undefined,
          })) {
            throw new Error(
              `${benchmarkCase.id}: ${error instanceof Error ? error.message : String(error)}`,
              { cause: error },
            );
          }
          caseStates.set(benchmarkCase.id, "skipped");
          caseReasons.set(
            benchmarkCase.id,
            error instanceof Error ? error.message : String(error),
          );
        } finally {
          await server?.stop();
        }
      }
    }

    const fixtureAfter = computeFixtureHash();
    if (fixtureBefore.value !== fixtureAfter.value) {
      throw new Error("The SSR benchmark source changed during measurement");
    }
    const summaries = summarizeCases(selectedCases, rawRounds);
    const caseReports = selectedCases.map((benchmarkCase) =>
      serializableCase(
        benchmarkCase,
        caseStates.get(benchmarkCase.id),
        caseReasons.get(benchmarkCase.id),
      )
    );
    const hasUnavailableMetrics = rawRounds.some(
      (round) => round.metricsStatus !== "ok",
    );
    const hasSkipped = caseReports.some(
      (benchmarkCase) => benchmarkCase.status !== "complete",
    );
    const hasSaturationWarning = saturation.some(
      (entry) => entry.analysis.status !== "saturated",
    );
    const report = {
      builds,
      cases: caseReports,
      config: {
        ...options.protocol,
        build: options.build,
        caseFilters: options.caseFilters,
        quick: options.quick,
        runtimeMode: options.runtimeMode,
        scalingCores: options.scalingCores,
        serverCpu: options.serverCpu,
      },
      createdAt: new Date().toISOString(),
      fixture: {
        hash: fixtureBefore,
        stateVariants: 32,
      },
      machine: collectMachineMetadata(),
      affinity: {
        cpuIndex: options.serverCpu,
        policy: options.serverCpu === null
          ? "not-requested"
          : "same-server-core",
      },
      matrix: {
        expectedCaseCount: createCaseMatrix().length,
        id: OFFICIAL_MATRIX_ID,
        naturalResponseBytes: naturalResponseByteSummary(summaries),
        summaries,
      },
      policies: {
        finalHtmlCacheInHeadline: false,
        headlineInput: HEADLINE_INPUT_POLICY,
        headlineMode: "dynamic",
        nativeAddonPath,
        payload: NATURAL_PAYLOAD_POLICY,
        workersPerCase: 1,
      },
      rawRounds,
      runtimePolicy,
      runtimeVerification,
      saturation,
      scaling: {
        requestedCores: options.scalingCores,
        reason: options.scalingCores.some((cores) => cores !== 1)
          ? "Equal-core multi-process scaling requires every selected server to expose the same worker topology."
          : null,
        status: options.scalingCores.some((cores) => cores !== 1)
          ? "unsupported"
          : "single-core",
        unequalScalingPublished: false,
      },
      schema: REPORT_SCHEMA,
      sourceRevision,
      status:
        hasSkipped
          || hasUnavailableMetrics
          || hasSaturationWarning
          || runtimePolicy.status !== "ok"
          ? "partial"
          : "ok",
      summaries,
      versions: {
        frameworks: collectFrameworkVersions(),
        runtimes: Object.fromEntries(
          runtimeVerification.runtimes.map((runtime) => [
            runtime.runtimeId,
            {
              expected: runtime.expectedVersion,
              observed: runtime.version,
              versionMatches: runtime.versionMatches,
            },
          ]),
        ),
        tools: collectToolVersions(),
        webuiDependency: collectWebuiDependency(),
      },
    };
    return assertReportSchema(report);
  } finally {
    disposeCleanup();
    await registry.stopAll();
  }
}
