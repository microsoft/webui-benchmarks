// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { OFFICIAL_CASE_COUNT } from "./cases.mjs";

export const REPORT_SCHEMA = "webui.ssr-todo-benchmark/v1";

export function validateReportSchema(report) {
  const errors = [];
  if (report === null || typeof report !== "object" || Array.isArray(report)) {
    return Object.freeze({ errors: ["report must be an object"], valid: false });
  }
  if (report.schema !== REPORT_SCHEMA) {
    errors.push(`schema must be ${REPORT_SCHEMA}`);
  }
  if (typeof report.createdAt !== "string") {
    errors.push("createdAt must be an ISO timestamp");
  }
  if (report.fixture?.hash?.algorithm !== "sha256") {
    errors.push("fixture.hash.algorithm must be sha256");
  }
  if (
    typeof report.fixture?.hash?.value !== "string"
    || report.fixture.hash.value.length !== 64
  ) {
    errors.push("fixture.hash.value must be a SHA-256 digest");
  }
  if (
    typeof report.sourceRevision?.commit !== "string"
    || !/^[0-9a-f]{40}$/u.test(report.sourceRevision.commit)
    || report.sourceRevision.sourceDigest !== report.fixture?.hash?.value
    || typeof report.sourceRevision.workingTreeDirty !== "boolean"
  ) {
    errors.push("sourceRevision must identify the measured source snapshot");
  }
  if (!Array.isArray(report.cases)) {
    errors.push("cases must be an array");
  }
  if (!Array.isArray(report.rawRounds)) {
    errors.push("rawRounds must be an array");
  }
  if (!Array.isArray(report.summaries)) {
    errors.push("summaries must be an array");
  }
  if (!Array.isArray(report.builds)) {
    errors.push("builds must be an array");
  }
  if (report.policies?.headlineInput !== "request-timestamped-input") {
    errors.push("headline input policy must be request-timestamped-input");
  }
  if (report.policies?.payload !== "natural") {
    errors.push("payload policy must publish natural response bytes");
  }
  if (report.policies?.headlineMode !== "dynamic") {
    errors.push("headline mode must be dynamic SSR");
  }
  if (report.policies?.finalHtmlCacheInHeadline !== false) {
    errors.push("headline must not cache final HTML");
  }
  if (report.policies?.workersPerCase !== 1) {
    errors.push("every case must run exactly one worker");
  }
  if (report.matrix?.id !== "official-ssr-matrix") {
    errors.push("matrix.id must be official-ssr-matrix");
  }
  if (report.matrix?.expectedCaseCount !== OFFICIAL_CASE_COUNT) {
    errors.push(
      `the official matrix must contain exactly ${OFFICIAL_CASE_COUNT} rows`,
    );
  }
  if (report.matrix?.naturalResponseBytes?.policy !== "natural") {
    errors.push("matrix.naturalResponseBytes.policy must be natural");
  }
  if (!Array.isArray(report.matrix?.summaries)) {
    errors.push("matrix.summaries must be an array");
  }
  const headlineCases = Array.isArray(report.cases)
    ? report.cases.filter((benchmarkCase) => benchmarkCase.headline)
    : [];
  if (
    headlineCases.some(
      (benchmarkCase) =>
        benchmarkCase.inputPolicy !== "request-timestamped-input"
        || benchmarkCase.workerCount !== 1,
    )
  ) {
    errors.push(
      "headline cases must use request-timestamped input and one worker",
    );
  }
  if (
    headlineCases.some(
      (benchmarkCase) =>
        benchmarkCase.mode !== "dynamic"
        || benchmarkCase.payloadPolicy !== "natural",
    )
  ) {
    errors.push("headline cases must be dynamic SSR with natural bytes");
  }
  if (
    headlineCases.some(
      (benchmarkCase) =>
        typeof benchmarkCase.renderer !== "string"
        || typeof benchmarkCase.transport !== "string"
        || benchmarkCase.renderer.length === 0
        || benchmarkCase.transport.length === 0,
    )
  ) {
    errors.push("every case must distinguish renderer from transport");
  }
  if (
    Array.isArray(report.cases)
    && report.cases.some((benchmarkCase) => benchmarkCase.serverId === "fastify")
  ) {
    errors.push("the official matrix must not use the Fastify transport");
  }
  if (Array.isArray(report.cases)) {
    const ids = report.cases
      .map((benchmarkCase) => benchmarkCase.id)
      .filter((id) => typeof id === "string");
    if (new Set(ids).size !== ids.length) {
      errors.push("case ids must be unique");
    }
    if (
      Array.isArray(report.rawRounds)
      && report.rawRounds.some(
        (round) =>
          !ids.includes(round.caseId)
          || !Number.isFinite(round.requestsPerSecond)
          || !Number.isFinite(round.latencyP95Ms),
      )
    ) {
      errors.push("raw rounds must reference a case and contain numeric metrics");
    }
  }
  return Object.freeze({
    errors: Object.freeze(errors),
    valid: errors.length === 0,
  });
}

export function assertReportSchema(report) {
  const validation = validateReportSchema(report);
  if (!validation.valid) {
    throw new Error(validation.errors.join("\n"));
  }
  return report;
}
