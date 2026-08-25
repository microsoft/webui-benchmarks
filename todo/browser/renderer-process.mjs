// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

const MAX_PROCESS_TIME_DISTANCE_SECONDS = 0.02;
const MAX_COUNTER_LAG_SECONDS = 0.001;

function renderers(processes) {
  return processes
    .filter(({ type }) => type === "renderer")
    .map(({ cpuTime, id }) => ({
      cpuTime: Number(cpuTime),
      pid: Number(id),
    }))
    .filter(
      ({ cpuTime, pid }) =>
        Number.isFinite(cpuTime) && Number.isInteger(pid) && pid > 0,
    );
}

export function selectRendererProcess(
  beforeProcesses,
  afterProcesses,
  pageProcessTimeSeconds,
) {
  const before = new Map(
    renderers(beforeProcesses).map(({ cpuTime, pid }) => [pid, cpuTime]),
  );
  const hasPageProcessTime = Number.isFinite(pageProcessTimeSeconds)
    && pageProcessTimeSeconds >= 0;
  const candidates = renderers(afterProcesses)
    .map(({ cpuTime, pid }) => {
      const beforeCpuSeconds = before.get(pid) ?? null;
      return {
        afterCpuSeconds: cpuTime,
        beforeCpuSeconds,
        cpuDeltaSeconds: Math.max(0, cpuTime - (beforeCpuSeconds ?? 0)),
        pageProcessTimeDistanceSeconds: hasPageProcessTime
          ? Math.abs(cpuTime - pageProcessTimeSeconds)
          : null,
        pid,
      };
    })
    .sort(
      hasPageProcessTime
        ? (left, right) =>
          left.pageProcessTimeDistanceSeconds
            - right.pageProcessTimeDistanceSeconds
          || left.pid - right.pid
        : (left, right) =>
          right.cpuDeltaSeconds - left.cpuDeltaSeconds
          || left.pid - right.pid,
    );
  const selected = candidates[0];
  const selectedDistance = selected?.pageProcessTimeDistanceSeconds;
  const processTimeMismatch = hasPageProcessTime
    && selected !== undefined
    && (
      selectedDistance > MAX_PROCESS_TIME_DISTANCE_SECONDS
      || pageProcessTimeSeconds
        > selected.afterCpuSeconds + MAX_COUNTER_LAG_SECONDS
    );
  if (
    selected === undefined
    || selected.cpuDeltaSeconds <= 0
    || processTimeMismatch
  ) {
    return Object.freeze({
      candidates: Object.freeze(candidates.map(Object.freeze)),
      reason: processTimeMismatch
        ? "Page ProcessTime did not closely match a renderer process"
        : "No renderer accumulated CPU time during navigation",
      status: "unavailable",
      strategy: hasPageProcessTime
        ? "closest renderer CPU time to the page CDP ProcessTime metric"
        : "largest renderer CPU delta in a fresh isolated Chromium",
    });
  }
  return Object.freeze({
    candidates: Object.freeze(
      candidates.map((candidate) =>
        Object.freeze({
          ...candidate,
          selected: candidate.pid === selected.pid,
        })
      ),
    ),
    pid: selected.pid,
    status: "selected",
    strategy: hasPageProcessTime
      ? "closest renderer CPU time to the page CDP ProcessTime metric"
      : "largest renderer CPU delta in a fresh isolated Chromium",
  });
}

export async function captureRendererProcessTime(session) {
  try {
    const result = await session.send("Performance.getMetrics");
    const value = result.metrics.find(({ name }) => name === "ProcessTime")
      ?.value;
    if (!Number.isFinite(value) || value < 0) {
      return Object.freeze({
        reason: "CDP Performance.getMetrics omitted ProcessTime",
        status: "unavailable",
      });
    }
    return Object.freeze({
      source: "page CDP Performance.getMetrics ProcessTime",
      status: "available",
      value,
    });
  } catch (error) {
    return Object.freeze({
      reason: error instanceof Error ? error.message : String(error),
      status: "unavailable",
    });
  }
}

export async function captureProcessInfo(session) {
  try {
    const result = await session.send("SystemInfo.getProcessInfo");
    return Object.freeze({
      processes: Object.freeze(result.processInfo.map(Object.freeze)),
      status: "available",
    });
  } catch (error) {
    return Object.freeze({
      processes: Object.freeze([]),
      reason: error instanceof Error ? error.message : String(error),
      status: "unavailable",
    });
  }
}
