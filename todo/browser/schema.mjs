// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  BROWSER_REPORT_SCHEMA,
  BROWSER_TIER,
  OFFICIAL_MINIMUM_ROUNDS,
  PRIMARY_ROUTE,
  PRODUCT_ORDER,
  QUICK_ROUNDS,
  ROUTE_JOURNEY,
} from "./apps.mjs";
import { METRIC_PATHS, metricAt } from "./metrics.mjs";
import { summarizeSeries } from "../runner/lib/statistics.mjs";

function validateMetric(metric, path, errors) {
  if (metric?.status === "available") {
    if (!Number.isFinite(metric.value)) {
      errors.push(`${path} available value must be finite`);
    }
    if (typeof metric.unit !== "string" || metric.unit.length === 0) {
      errors.push(`${path} must declare a unit`);
    }
    if (Object.hasOwn(metric, "reason")) {
      errors.push(`${path} available metric must not carry a reason`);
    }
    return;
  }
  if (metric?.status === "unavailable") {
    if (typeof metric.reason !== "string" || metric.reason.length === 0) {
      errors.push(`${path} unavailable metric must explain why`);
    }
    if (Object.hasOwn(metric, "value")) {
      errors.push(`${path} unavailable metric must not carry a value`);
    }
    return;
  }
  errors.push(`${path} must be available or unavailable`);
}

function validateMode(report, errors) {
  if (report.browser?.transportProtocol !== "h2") {
    errors.push("browser transport protocol must be h2");
  }
  if (report.mode === "quick") {
    if (report.roundsPerApp !== QUICK_ROUNDS) {
      errors.push("quick mode must run exactly one round per app");
    }
    return;
  }
  if (report.mode !== "official") {
    errors.push("mode must be quick or official");
  } else if (report.roundsPerApp !== OFFICIAL_MINIMUM_ROUNDS) {
    errors.push(
      `official mode requires exactly ${OFFICIAL_MINIMUM_ROUNDS} rounds per app`,
    );
  } else if (
    report.runtimePolicy?.status !== "ok"
    || report.runtimeVerification?.mode !== "official"
    || report.runtimeVerification?.status !== "ok"
  ) {
    errors.push("official mode requires verified pinned runtimes");
  }
}

function validateApps(report, errors) {
  if (!Array.isArray(report.apps) || report.apps.length === 0) {
    errors.push("apps must be a non-empty array");
    return new Set();
  }
  const ids = report.apps.map(({ productId }) => productId);
  if (new Set(ids).size !== ids.length) {
    errors.push("product ids must be unique");
  }
  for (const app of report.apps) {
    if (typeof app.productId !== "string" || app.productId.length === 0) {
      errors.push(`${app.appId} must define a product id`);
    }
    if (app.headline !== false || app.tier !== BROWSER_TIER) {
      errors.push(`${app.appId} must be a non-headline secondary case`);
    }
    if (app.primaryRoute !== PRIMARY_ROUTE) {
      errors.push(`${app.appId} primary browser evidence must use /dynamic`);
    }
    if (
      typeof app.readinessDefinition !== "string"
      || app.readinessDefinition.length === 0
    ) {
      errors.push(`${app.appId} must define its readiness signal`);
    }
    if (
      app.routing?.clientNavigation !== "supported"
      || typeof app.routing?.router !== "string"
      || app.routing.router.length === 0
      || !Array.isArray(app.routing?.journey)
      || app.routing.journey.length !== ROUTE_JOURNEY.length
      || app.routing.journey.some(
        (path, index) => path !== ROUTE_JOURNEY[index],
      )
    ) {
      errors.push(`${app.appId} must define the canonical routed journey`);
    }
    if (app.lazyHydration?.status === "supported") {
      if (
        typeof app.lazyHydration.strategy !== "string"
        || app.lazyHydration.strategy.length === 0
        || typeof app.lazyHydration.scope !== "string"
        || app.lazyHydration.scope.length === 0
      ) {
        errors.push(`${app.appId} lazy hydration must declare strategy and scope`);
      }
    } else if (
      app.lazyHydration?.status !== "unavailable"
      || typeof app.lazyHydration.reason !== "string"
      || app.lazyHydration.reason.length === 0
    ) {
      errors.push(`${app.appId} must declare native lazy hydration availability`);
    }
    if (
      app.frameworkVersions === null
      || typeof app.frameworkVersions !== "object"
    ) {
      errors.push(`${app.appId} must record framework versions`);
    }
    if (
      !["browser-wrapper", "framework-server", "ssr-document"].includes(
        app.initialStateSource,
      )
    ) {
      errors.push(`${app.appId} must record its initial state source`);
    }
    if (
      app.appId === "webui"
      && app.initialStateSource !== "ssr-document"
    ) {
      errors.push("WebUI must consume the state already embedded by SSR");
    }
  }
  if (
    report.mode === "official"
    && (
      ids.length !== PRODUCT_ORDER.length
      || ids.some((id, index) => id !== PRODUCT_ORDER[index])
    )
  ) {
    errors.push("official mode requires the complete ordered product matrix");
  }
  return new Set(ids);
}

function validateRawRounds(report, productIds, errors) {
  if (!Array.isArray(report.rawRounds)) {
    errors.push("rawRounds must be an array");
    return;
  }
  const counts = new Map(
    [...productIds].map((productId) => [productId, 0]),
  );
  const keys = new Set();
  const appsByProductId = new Map(
    report.apps.map((app) => [app.productId, app]),
  );
  for (const [index, round] of report.rawRounds.entries()) {
    const prefix = `rawRounds[${index}]`;
    if (!productIds.has(round.productId)) {
      errors.push(`${prefix} references an unknown product`);
    } else {
      counts.set(round.productId, counts.get(round.productId) + 1);
    }
    if (
      !Number.isInteger(round.round)
      || round.round < 0
      || round.round >= report.roundsPerApp
    ) {
      errors.push(`${prefix}.round is outside the configured round range`);
    }
    const key = `${round.productId}:${round.round}`;
    if (keys.has(key)) {
      errors.push(`${prefix} duplicates ${key}`);
    }
    keys.add(key);
    if (round.headline !== false || round.route !== PRIMARY_ROUTE) {
      errors.push(`${prefix} must be non-headline dynamic evidence`);
    }
    if (round.status !== "ok") {
      if (report.mode === "official") {
        errors.push(`${prefix} official result must be successful`);
      }
      if (typeof round.reason !== "string" || round.reason.length === 0) {
        errors.push(`${prefix} unavailable result must provide a reason`);
      }
      if (round.metrics !== undefined) {
        errors.push(`${prefix} unavailable result must not be success-shaped`);
      }
      continue;
    }
    const app = appsByProductId.get(round.productId);
    if (round.readiness?.clientMode !== app?.clientMode) {
      errors.push(`${prefix} readiness client mode must match its app row`);
    }
    if (
      round.fullHydration?.status !== "hydrated"
      || !Number.isFinite(round.fullHydration.atMs)
      || typeof round.fullHydration.framework !== "string"
      || round.fullHydration.framework.length === 0
    ) {
      errors.push(`${prefix} must record framework-authored full hydration`);
    }
    for (const path of METRIC_PATHS) {
      validateMetric(metricAt(round.metrics, path), `${prefix}.${path}`, errors);
    }
    if (
      round.requestState?.status !== "validated"
      || round.requestState.itemCount !== 100
      || typeof round.requestState.requestTimestamp !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(
        round.requestState.requestTimestamp,
      )
    ) {
      errors.push(
        `${prefix} must validate one current request timestamp across 100 todos`,
      );
    }
    if (round.navigationTiming?.nextHopProtocol !== "h2") {
      errors.push(`${prefix} must negotiate HTTP/2`);
    }
    if (
      round.paint?.label !== "pre-interaction LCP"
      || !Number.isFinite(round.paint?.finalizedAtMs)
      || !Number.isFinite(round.paint?.interactionStartedAtMs)
      || round.paint.finalizedAtMs > round.paint.interactionStartedAtMs
    ) {
      errors.push(`${prefix} must finalize LCP before interactions`);
    }
    const garbageCollection = round.processMemory?.garbageCollection;
    if (
      !Number.isInteger(garbageCollection?.requestedPasses)
      || garbageCollection.requestedPasses < 2
    ) {
      errors.push(`${prefix} must request repeated GC before heap sampling`);
    } else if (
      garbageCollection.status === "available"
      && garbageCollection.completedPasses
        !== garbageCollection.requestedPasses
    ) {
      errors.push(`${prefix} must complete GC before heap sampling`);
    } else if (
      garbageCollection.status !== "available"
      && (
        garbageCollection.status !== "unavailable"
        || typeof garbageCollection.reason !== "string"
        || garbageCollection.reason.length === 0
      )
    ) {
      errors.push(`${prefix} unavailable GC must provide a reason`);
    }
  }
  for (const [productId, count] of counts) {
    if (count !== report.roundsPerApp) {
      errors.push(
        `${productId} must have exactly ${report.roundsPerApp} raw rounds`,
      );
    }
  }
}

function validateCollections(report, productIds, errors) {
  if (
    !Array.isArray(report.summaries)
    || report.summaries.length !== productIds.size
  ) {
    errors.push("summaries must contain one entry per app");
  } else {
    const summaryIds = new Set(
      report.summaries.map(({ productId }) => productId),
    );
    if (
      summaryIds.size !== productIds.size
      || [...productIds].some((productId) => !summaryIds.has(productId))
    ) {
      errors.push("summaries must reference every selected app exactly once");
    }
    for (const summary of report.summaries) {
      const rounds = (Array.isArray(report.rawRounds) ? report.rawRounds : [])
        .filter(
        ({ productId }) => productId === summary.productId,
        );
      for (const path of METRIC_PATHS) {
        validateAggregateMetric(
          metricAt(summary.metrics, path),
          rounds.map((round) => metricAt(round.metrics, path)),
          `${summary.productId}.${path}`,
          errors,
        );
      }
    }
  }

  function numbersMatch(left, right) {
    const scale = Math.max(Math.abs(left), Math.abs(right), 1);
    return Math.abs(left - right) <= scale * 1e-12;
  }

  function validateAggregateMetric(aggregate, rawMetrics, path, errors) {
    const available = rawMetrics.filter(
      (metric) => metric?.status === "available",
    );
    const unavailable = rawMetrics.length - available.length;
    if (available.length === 0) {
      if (
        aggregate?.status !== "unavailable"
        || aggregate.availableSamples !== 0
        || aggregate.unavailableSamples !== unavailable
      ) {
        errors.push(`${path} unavailable aggregate must match raw rounds`);
      }
      return;
    }
    const values = available.map(({ value }) => value);
    const units = new Set(available.map(({ unit }) => unit));
    if (
      aggregate?.status !== "available"
      || aggregate.availableSamples !== available.length
      || aggregate.unavailableSamples !== unavailable
      || units.size !== 1
      || aggregate.unit !== available[0].unit
      || !Array.isArray(aggregate.samples)
      || aggregate.samples.length !== values.length
      || aggregate.samples.some(
        (value, index) => !numbersMatch(value, values[index]),
      )
    ) {
      errors.push(`${path} aggregate samples must match raw rounds`);
      return;
    }
    const expected = summarizeSeries(values);
    for (const field of ["count", "mad", "max", "median", "min", "p95"]) {
      if (!numbersMatch(aggregate.statistics?.[field], expected[field])) {
        errors.push(`${path}.${field} must be derived from raw rounds`);
      }
    }
  }
  if (
    !Array.isArray(report.roundOrder)
    || report.roundOrder.length !== report.roundsPerApp
  ) {
    errors.push("roundOrder must contain one order per round");
    return;
  }
  const expected = [...productIds].sort().join("\0");
  for (const [index, order] of report.roundOrder.entries()) {
    const actual = Array.isArray(order)
      ? [...new Set(order)].sort().join("\0")
      : "";
    if (actual !== expected || order.length !== productIds.size) {
      errors.push(`roundOrder[${index}] must be a permutation of product ids`);
    }
  }
}

export function validateBrowserReport(report) {
  const errors = [];
  if (report === null || typeof report !== "object" || Array.isArray(report)) {
    return Object.freeze({ errors: ["report must be an object"], valid: false });
  }
  if (report.schema !== BROWSER_REPORT_SCHEMA) {
    errors.push(`schema must be ${BROWSER_REPORT_SCHEMA}`);
  }
  if (report.tier?.id !== BROWSER_TIER || report.tier?.headline !== false) {
    errors.push("tier must be browser-secondary and non-headline");
  }
  if (
    report.responseMode !== undefined
    && report.responseMode !== "progressive"
  ) {
    errors.push(
      "the browser suite only measures the progressive suite's native streaming today",
    );
  }
  validateMode(report, errors);
  if (
    report.fixture?.hash?.algorithm !== "sha256"
    || typeof report.fixture?.hash?.value !== "string"
    || report.fixture.hash.value.length !== 64
  ) {
    errors.push("fixture.hash must contain a SHA-256 digest");
  }
  if (
    typeof report.sourceRevision?.commit !== "string"
    || !/^[0-9a-f]{40}$/u.test(report.sourceRevision.commit)
    || report.sourceRevision.sourceDigest !== report.fixture?.hash?.value
    || typeof report.sourceRevision.workingTreeDirty !== "boolean"
  ) {
    errors.push("sourceRevision must identify the measured source snapshot");
  }
  if (
    typeof report.browser?.version !== "string"
    || report.browser.version.length === 0
  ) {
    errors.push("browser.version is required");
  }
  if (
    !Number.isInteger(report.viewport?.width)
    || !Number.isInteger(report.viewport?.height)
  ) {
    errors.push("viewport width and height must be integers");
  }
  const productIds = validateApps(report, errors);
  validateRawRounds(report, productIds, errors);
  validateCollections(report, productIds, errors);
  if (report.snapshotIntegrity?.status !== "verified") {
    errors.push("shared snapshot integrity must be verified");
  }
  return Object.freeze({
    errors: Object.freeze(errors),
    valid: errors.length === 0,
  });
}

export function assertBrowserReport(report) {
  const validation = validateBrowserReport(report);
  if (!validation.valid) {
    throw new Error(validation.errors.join("\n"));
  }
  return report;
}
