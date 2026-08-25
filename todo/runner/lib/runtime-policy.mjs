// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export function runtimeDecision(runtime, { quick, runtimeMode }) {
  if (runtime?.installed === true && runtime.versionMatches === true) {
    return Object.freeze({
      code: null,
      reason: null,
      runtimeId: runtime.runtimeId,
      status: "available",
    });
  }
  const code = runtime?.installed
    ? "runtime-version-mismatch"
    : "runtime-not-installed";
  const expected = runtime?.expectedVersion ?? "the pinned version";
  const observed = runtime?.version ?? "not installed";
  const reason = `${runtime?.runtimeId ?? "runtime"} expected ${expected}, observed ${observed}`;
  if (runtimeMode === "local" && quick) {
    return Object.freeze({
      code,
      reason,
      runtimeId: runtime?.runtimeId,
      status: "skipped",
    });
  }
  return Object.freeze({
    code,
    reason,
    runtimeId: runtime?.runtimeId,
    status: "failed",
  });
}

export function evaluateRuntimePolicy(
  verification,
  options,
  requiredRuntimeIds,
) {
  const byId = new Map(
    verification.runtimes.map((runtime) => [runtime.runtimeId, runtime]),
  );
  const decisions = [...new Set(requiredRuntimeIds)].map((runtimeId) =>
    runtimeDecision(
      byId.get(runtimeId) ?? {
        expectedVersion: null,
        installed: false,
        runtimeId,
        version: null,
        versionMatches: false,
      },
      options,
    )
  );
  return Object.freeze({
    decisions: Object.freeze(decisions),
    status: decisions.some((decision) => decision.status === "failed")
      ? "failed"
      : decisions.some((decision) => decision.status === "skipped")
        ? "partial"
        : "ok",
  });
}
