// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import process from "node:process";
import { buildControlledClients } from "./build-clients.mjs";
import {
  BROWSER_REPORT_SCHEMA,
  BROWSER_TIER,
  OFFICIAL_MINIMUM_ROUNDS,
  QUICK_ROUNDS,
  createBrowserCases,
  frameworkVersionsForApp,
} from "./apps.mjs";
import { startControlledBrowserServer } from "./controlled-browser-server.mjs";
import { aggregateAppRounds } from "./metrics.mjs";
import { measureBrowserRound } from "./measurement.mjs";
import { defaultReportPath, writeBrowserReport } from "./report.mjs";
import { createBuildPlan, runBuildPlan } from "../runner/lib/builds.mjs";
import {
  collectFrameworkVersions,
  collectMachineMetadata,
  collectSourceRevision,
  collectToolVersions,
  collectWebuiDependency,
  computeFixtureHash,
} from "../runner/lib/metadata.mjs";
import { deterministicOrder } from "../runner/lib/order.mjs";
import {
  ProcessRegistry,
  installProcessCleanup,
} from "../runner/lib/process-tree.mjs";
import { evaluateRuntimePolicy } from "../runner/lib/runtime-policy.mjs";
import {
  assertServerMetadata,
  launchCaseServer,
  requestHttp2Ok,
} from "../runner/lib/server.mjs";
import { TODO_STATE_VARIANTS } from "../shared/state.mjs";
import { verifyRuntimeMatrix } from "../servers/verify-runtimes.mjs";

const DEFAULT_VIEWPORT = Object.freeze({ height: 900, width: 1_440 });
const DEFAULT_SEED = "webui-ssr-todo-browser-outcomes";
const OFFICIAL_INFRASTRUCTURE_ATTEMPTS = 2;
const CHROMIUM_ARGS = Object.freeze([
  "--disable-backgrounding-occluded-windows",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-features=CalculateNativeWinOcclusion",
  "--enable-precise-memory-info",
  "--enable-blink-features=DeclarativeCSSModules",
  "--process-per-tab",
]);

function quoteCommandArgument(argument) {
  return /\s|"/u.test(argument)
    ? `"${argument.replaceAll('"', '""')}"`
    : argument;
}

export function portableBuildPlan(plan, platform = process.platform) {
  if (platform !== "win32") {
    return plan;
  }
  return Object.freeze(
    plan.map((definition) => {
      if (!definition.command.toLowerCase().endsWith(".cmd")) {
        return definition;
      }
      const commandLine = [definition.command, ...definition.args]
        .map(quoteCommandArgument)
        .join(" ");
      return Object.freeze({
        ...definition,
        args: ["/d", "/s", "/c", commandLine],
        command: process.env.ComSpec ?? "cmd.exe",
      });
    }),
  );
}

function snapshotDigest() {
  return createHash("sha256")
    .update(JSON.stringify(TODO_STATE_VARIANTS))
    .digest("hex");
}

function formatError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.length <= 4_096 ? message : message.slice(0, 4_096);
}

async function cleanupResources(resources, operationError) {
  const failures = [];
  for (const resource of resources.reverse()) {
    try {
      await resource.stop();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 0) {
    return;
  }
  if (operationError !== null) {
    failures.unshift(operationError);
  }
  throw new AggregateError(failures, "Browser case cleanup failed");
}

async function warmBrowserServer(url) {
  if (url.startsWith("https://")) {
    await requestHttp2Ok(`${url}/dynamic`, {
      headers: {
        "accept-encoding": "identity",
      },
      timeoutMilliseconds: 30_000,
    });
    return;
  }
  const response = await fetch(`${url}/dynamic`, {
    headers: { "accept-encoding": "identity" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Browser warmup returned HTTP ${response.status}`);
  }

  await response.arrayBuffer();
}

export async function withCaseResources({
  browserCase,
  clientBundle,
  operation,
  registry,
  serverRenderer,
  startBackend = launchCaseServer,
  startBrowserServer = startControlledBrowserServer,
  warmServer = warmBrowserServer,
}) {
  const resources = [];
  let operationError = null;
  try {
    if (browserCase.directBrowserServer) {
      if (typeof clientBundle?.browserAssetDirectory !== "string") {
        throw new Error(
          `${browserCase.productId} direct browser assets were not built`,
        );
      }
      const backend = await startBackend(browserCase.sourceCase, {
        browserAssetDirectory: clientBundle.browserAssetDirectory,
        browserTls: true,
        controlledTargetBytes: 0,
        registry,
        timeoutMilliseconds: 120_000,
      });
      resources.push(backend);
      assertServerMetadata(browserCase.sourceCase, backend.announcement);
      await warmServer(backend.announcement.url);
      return await operation({
        backend,
        url: backend.announcement.url,
      });
    }
    if (browserCase.controlled && serverRenderer !== undefined) {
      const browserServer = await startBrowserServer({
        browserCase,
        clientBundle,
        serverRenderer,
      });
      resources.push(browserServer);
      await warmServer(browserServer.url);
      return await operation({
        backend: browserServer,
        url: browserServer.url,
      });
    }
    const backend = await startBackend(browserCase.sourceCase, {
      browserTls: !browserCase.controlled,
      controlledTargetBytes: 0,
      registry,
      timeoutMilliseconds: 120_000,
    });
    resources.push(backend);
    assertServerMetadata(browserCase.sourceCase, backend.announcement);
    let url = backend.announcement.url;
    if (browserCase.controlled) {
      const proxy = await startBrowserServer({
        backend,
        browserCase,
        clientBundle,
      });
      resources.push(proxy);
      url = proxy.url;
    }
    await warmServer(url);
    return await operation({ backend, url });
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    await cleanupResources(resources, operationError);
  }
}

export async function withFreshChromium(
  operation,
  {
    headless = true,
    launch = (options) => chromium.launch(options),
  } = {},
) {
  const browser = await launch({ args: CHROMIUM_ARGS, headless });
  let operationError = null;
  try {
    return await operation(browser);
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await browser.close();
    } catch (closeError) {
      if (operationError === null) {
        throw closeError;
      }
      throw new AggregateError(
        [operationError, closeError],
        "Browser measurement and Chromium cleanup failed",
      );
    }
  }
}

function normalizeOptions(options) {
  const mode = options.mode ?? "official";
  if (!["official", "quick"].includes(mode)) {
    throw new Error("Browser benchmark mode must be official or quick");
  }
  const rounds = options.rounds
    ?? (mode === "quick" ? QUICK_ROUNDS : OFFICIAL_MINIMUM_ROUNDS);
  if (!Number.isInteger(rounds) || rounds <= 0) {
    throw new RangeError("rounds must be a positive integer");
  }
  if (mode === "quick" && rounds !== QUICK_ROUNDS) {
    throw new RangeError("quick mode is exactly one smoke round");
  }
  if (mode === "official" && rounds !== OFFICIAL_MINIMUM_ROUNDS) {
    throw new RangeError(
      `official mode requires exactly ${OFFICIAL_MINIMUM_ROUNDS} rounds`,
    );
  }
  if (mode === "official" && (options.appFilters?.length ?? 0) !== 0) {
    throw new RangeError("official mode requires the complete product matrix");
  }
  const viewport = Object.freeze({
    height: options.viewport?.height ?? DEFAULT_VIEWPORT.height,
    width: options.viewport?.width ?? DEFAULT_VIEWPORT.width,
  });
  if (
    !Number.isInteger(viewport.width)
    || viewport.width <= 0
    || !Number.isInteger(viewport.height)
    || viewport.height <= 0
  ) {
    throw new RangeError("viewport dimensions must be positive integers");
  }
  return Object.freeze({
    appFilters: Object.freeze(options.appFilters ?? []),
    build: mode === "official" || options.build === true,
    headless: options.headless !== false,
    json: options.json === true,
    mode,
    outputPath: options.outputPath ?? defaultReportPath(mode),
    progress: options.progress ?? (() => {}),
    rounds,
    seed: options.seed ?? DEFAULT_SEED,
    viewport,
    write: options.write !== false,
  });
}

function appMetadata(browserCase, frameworkVersions, rawRounds) {
  const runtimeVersion = rawRounds.find(
    ({ productId, status }) =>
      productId === browserCase.productId && status === "ok",
  )?.runtime.version ?? null;
  return Object.freeze({
    appId: browserCase.appId,
    browserOutcome: browserCase.browserOutcome,
    browserTierSsr: browserCase.browserTierSsr,
    clientMode: browserCase.clientMode,
    frameworkVersions: frameworkVersionsForApp(
      browserCase.appId,
      frameworkVersions,
    ),
    headline: false,
    hydration: browserCase.hydration,
    id: browserCase.id,
    initialStateSource: browserCase.initialStateSource,
    label: browserCase.label,
    lazyHydration: browserCase.lazyHydration,
    primaryRoute: browserCase.primaryRoute,
    productId: browserCase.productId,
    readinessDefinition: browserCase.readinessDefinition,
    routing: browserCase.routing,
    runtime: Object.freeze({
      id: browserCase.sourceCase.runtimeId,
      version: runtimeVersion,
    }),
    sourceSsrCaseId: browserCase.sourceSsrCaseId,
    tier: BROWSER_TIER,
  });
}

function unavailableRound(browserCase, round, order, reason) {
  return Object.freeze({
    appId: browserCase.appId,
    headline: false,
    order,
    productId: browserCase.productId,
    reason,
    round,
    route: browserCase.primaryRoute,
    status: "unavailable",
  });
}

async function runCaseRound({
  browserCase,
  clientBundle,
  headless,
  order,
  registry,
  round,
  serverRenderer,
  verifiedRuntimes,
  viewport,
}) {
  try {
    const rawRound = await withCaseResources({
      browserCase,
      clientBundle,
      operation: async ({ backend, url }) => {
        const expectedRuntime = verifiedRuntimes.get(
          browserCase.sourceCase.runtimeId,
        );
        if (
          expectedRuntime !== undefined
          && backend.announcement.runtimeVersion !== expectedRuntime.version
        ) {
          throw new Error(
            `${browserCase.productId} launched runtime ${backend.announcement.runtimeVersion}, expected ${expectedRuntime.version}`,
          );
        }
        return withFreshChromium(
          async (browser) => {
            const measured = await measureBrowserRound({
              browser,
              browserCase,
              headless,
              url,
              viewport,
            });
            return Object.freeze({
              appId: browserCase.appId,
              browserVersion: browser.version(),
              diagnostics: measured.diagnostics,
              fullHydration: measured.fullHydration,
              headline: false,
              metrics: measured.metrics,
              navigationTiming: measured.navigationTiming,
              order,
              paint: measured.paint,
              processMemory: measured.processMemory,
              productId: browserCase.productId,
              readiness: measured.readiness,
              requestState: measured.requestState,
              round,
              route: browserCase.primaryRoute,
              runtime: Object.freeze({
                id: backend.announcement.runtimeId,
                version: backend.announcement.runtimeVersion,
              }),
              server: Object.freeze({
                appId: backend.announcement.appId,
                browserSsrBundleBytes:
                  backend.announcement.browserSsrBundleBytes ?? null,
                command: backend.command,
                serverId: backend.announcement.serverId,
                streaming: backend.announcement.streaming
                  ?? browserCase.sourceCase.streaming,
                workerCount: backend.announcement.workerCount,
              }),
              semanticValidation: measured.semanticValidation,
              status: "ok",
            });
          },
          { headless },
        );
      },
      registry,
      serverRenderer,
    });
    return rawRound;
  } catch (error) {
    return unavailableRound(
      browserCase,
      round,
      order,
      formatError(error),
    );
  }
}

function summariesForCases(cases, rawRounds) {
  return Object.freeze(
    cases.map((browserCase) =>
      Object.freeze({
        appId: browserCase.appId,
        productId: browserCase.productId,
        ...aggregateAppRounds(
          rawRounds.filter(
            ({ productId }) => productId === browserCase.productId,
          ),
        ),
      })
    ),
  );
}

export function isRetryableBrowserInfrastructureFailure(reason) {
  return typeof reason === "string"
    && (
      reason.includes("Target page, context or browser has been closed")
      || reason.includes("X connection error received")
    );
}

export function enforceProductionMode(environment = process.env) {
  environment.NODE_ENV = "production";
}

export async function runBrowserBenchmark(inputOptions = {}) {
  enforceProductionMode();
  const options = normalizeOptions(inputOptions);
  const browserCases = createBrowserCases(options.appFilters);
  const runtimeVerification = verifyRuntimeMatrix({
    official: options.mode === "official",
  });
  const requiredRuntimes = [
    "node",
    ...browserCases
      .map(({ sourceCase }) => sourceCase.runtimeId)
      .filter((runtimeId) => runtimeId !== "rust"),
  ];
  const runtimePolicy = evaluateRuntimePolicy(
    runtimeVerification,
    {
      quick: options.mode === "quick",
      runtimeMode: options.mode === "official" ? "official" : "local",
    },
    requiredRuntimes,
  );
  if (runtimePolicy.status === "failed") {
    throw new Error(
      `Browser runtime policy failed:\n${
        runtimePolicy.decisions
          .filter(({ status }) => status === "failed")
          .map(({ reason }) => reason)
          .join("\n")
      }`,
    );
  }
  const verifiedRuntimes = new Map(
    runtimeVerification.runtimes.map((runtime) => [
      runtime.runtimeId,
      runtime,
    ]),
  );
  const frameworkVersions = collectFrameworkVersions();
  const webuiDependency = collectWebuiDependency();
  const registry = new ProcessRegistry();
  const disposeSignals = installProcessCleanup(registry);
  let builds = Object.freeze([]);
  let clients;
  let fixtureBefore;
  let sourceRevision;
  let stateBefore;
  const rawRounds = [];
  const roundOrder = [];
  let browserVersion = null;
  try {
    if (options.build) {
      builds = await runBuildPlan(
        portableBuildPlan(
          createBuildPlan(
            browserCases.map(({ sourceCase }) => sourceCase),
            { browser: true },
          ),
        ),
        {
          progress: options.progress,
          registry,
        },
      );
    }
    clients = await buildControlledClients(browserCases);
    fixtureBefore = computeFixtureHash();
    sourceRevision = collectSourceRevision(fixtureBefore.value);
    stateBefore = snapshotDigest();
    for (let round = 0; round < options.rounds; round += 1) {
      const ordered = deterministicOrder(browserCases, round, options.seed);
      roundOrder.push(
        Object.freeze(ordered.map(({ productId }) => productId)),
      );
      for (let order = 0; order < ordered.length; order += 1) {
        const browserCase = ordered[order];
        options.progress(
          `browser round ${round + 1}/${options.rounds}: ${browserCase.label}`,
        );
        if (browserCase.browserOutcome.status === "unsupported") {
          rawRounds.push(
            unavailableRound(
              browserCase,
              round,
              order,
              browserCase.browserOutcome.reason,
            ),
          );
          continue;
        }
        const clientFailure = clients.failures.get(browserCase.appId);
        if (clientFailure !== undefined) {
          rawRounds.push(
            unavailableRound(
              browserCase,
              round,
              order,
              `Browser client build failed: ${clientFailure}`,
            ),
          );
          continue;
        }
        let rawRound;
        const attempts = options.mode === "official"
          ? OFFICIAL_INFRASTRUCTURE_ATTEMPTS
          : 1;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
          rawRound = await runCaseRound({
            browserCase,
            clientBundle: clients.bundles.get(browserCase.appId),
            headless: options.headless,
            order,
            registry,
            round,
            serverRenderer: clients.serverRenderers.get(browserCase.appId),
            verifiedRuntimes,
            viewport: options.viewport,
            webuiDependency,
          });
          if (
            rawRound.status === "ok"
            || !isRetryableBrowserInfrastructureFailure(rawRound.reason)
            || attempt === attempts
          ) {
            break;
          }
          options.progress(
            `retrying browser infrastructure failure: ${browserCase.label}`,
          );
        }
        browserVersion ??= rawRound.browserVersion ?? null;
        rawRounds.push(rawRound);
      }
    }
  } finally {
    disposeSignals();
    const cleanupFailures = [];
    try {
      await registry.stopAll();
    } catch (error) {
      cleanupFailures.push(error);
    }
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        cleanupFailures,
        "Browser benchmark cleanup failed",
      );
    }
  }
  const fixtureAfter = computeFixtureHash();
  const stateAfter = snapshotDigest();
  if (
    fixtureBefore.value !== fixtureAfter.value
    || stateBefore !== stateAfter
  ) {
    throw new Error("The browser benchmark changed a shared fixture snapshot");
  }
  if (
    options.mode === "official"
    && rawRounds.some(({ status }) => status !== "ok")
  ) {
    const failures = rawRounds
      .filter(({ status }) => status !== "ok")
      .map(({ productId, reason, round }) =>
        `${productId} round ${round + 1}: ${reason}`
      );
    throw new Error(
      `Official browser evidence is incomplete:\n${failures.join("\n")}`,
    );
  }
  const report = Object.freeze({
    apps: Object.freeze(
      browserCases.map((browserCase) =>
        appMetadata(browserCase, frameworkVersions, rawRounds)
      ),
    ),
    browser: Object.freeze({
      engine: "chromium",
      cachePolicy:
        "fresh browser process and context start empty; same-navigation resource reuse remains enabled",
      contextIsolation:
        "fresh foreground Chromium process, context, and page per product round",
      cpuThrottling: "none",
      headless: options.headless,
      launchArguments: CHROMIUM_ARGS,
      networkThrottling: "none",
      processPerSample: true,
      processWarmup:
        "two unmeasured foreground animation frames before each product navigation",
      transportProtocol: "h2",
      version: browserVersion ?? "unavailable",
    }),
    builds,
    cleanup: Object.freeze({
      processRegistryEmpty: registry.size === 0,
      status: registry.size === 0 ? "verified" : "failed",
    }),
    createdAt: new Date().toISOString(),
    environment: Object.freeze({
      machine: collectMachineMetadata(),
      tools: collectToolVersions(),
      webuiDependency,
    }),
    fixture: Object.freeze({ hash: fixtureBefore }),
    mode: options.mode,
    rawRounds: Object.freeze(rawRounds),
    // The browser suite always measures each product's real page load, so it
    // always exercises native progressive/streaming boundaries end to end;
    // there is no buffered-complete browser variant yet (see README.md).
    responseMode: "progressive",
    roundOrder: Object.freeze(roundOrder),
    roundsPerApp: options.rounds,
    runtimePolicy,
    runtimeVerification,
    schema: BROWSER_REPORT_SCHEMA,
    seed: options.seed,
    snapshotIntegrity: Object.freeze({
      fixtureHashBefore: fixtureBefore.value,
      fixtureHashAfter: fixtureAfter.value,
      sharedStateHashBefore: stateBefore,
      sharedStateHashAfter: stateAfter,
      status: "verified",
    }),
    sourceRevision,
    summaries: summariesForCases(browserCases, rawRounds),
    tier: Object.freeze({
      headline: false,
      id: BROWSER_TIER,
      statement:
        "Secondary browser outcomes only; this report is not consumed by headline SSR scoring.",
    }),
    viewport: options.viewport,
  });
  if (options.write) {
    await writeBrowserReport(report, options.outputPath);
  }
  return Object.freeze({ outputPath: options.outputPath, report });
}

export { DEFAULT_SEED, DEFAULT_VIEWPORT, normalizeOptions };
