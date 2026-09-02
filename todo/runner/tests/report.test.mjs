// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import { renderHumanReport } from "../lib/report.mjs";

test("human reports include median peak server RSS for RPS measurements", () => {
  const report = {
    cases: [],
    config: { connections: 1, durationSeconds: 1, rounds: 1 },
    fixture: { hash: { value: "a".repeat(64) } },
    matrix: {
      expectedCaseCount: 1,
      id: "official-ssr-matrix",
      naturalResponseBytes: {
        byCase: [],
        maximum: 10,
        minimum: 10,
      },
      summaries: [{
        caseId: "webui-node-http",
        latencyP95Ms: { median: 2 },
        renderer: "WebUI",
        requestsPerSecond: { median: 100 },
        responseByteProfile: { dynamic: { maximum: 10, minimum: 10 } },
        serverMemory: {
          peakRssBytes: { median: 64 * 1024 * 1024 },
          status: "available",
        },
        transport: "node:http",
      }],
    },
    policies: { responseMode: "complete" },
    rawRounds: [],
    saturation: [],
    status: "ok",
  };

  const output = renderHumanReport(report);
  assert.match(output, /peak RSS MiB/u);
  assert.match(output, /64/u);
});
