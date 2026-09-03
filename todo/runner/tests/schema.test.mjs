// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import {
  ASYNC_DATA_BOUNDARY_CAPABILITY,
  createCaseMatrix,
} from "../lib/cases.mjs";
import {
  REPORT_SCHEMA,
  assertReportSchema,
  validateReportSchema,
} from "../lib/schema.mjs";

function validReport() {
  return {
    builds: [],
    cases: [{
      headline: true,
      id: "webui-node-http",
      inputPolicy: "request-timestamped-input",
      mode: "dynamic",
      payloadPolicy: "natural",
      renderer: "@microsoft/webui Protocol.render (request-materialized Node-API state)",
      serverId: "node-http",
      transport: "node:http",
      workerCount: 1,
    }],
    createdAt: "2026-08-20T00:00:00.000Z",
    fixture: {
      hash: {
        algorithm: "sha256",
        value: "a".repeat(64),
      },
    },
    matrix: {
      expectedCaseCount: 16,
      id: "official-ssr-matrix",
      naturalResponseBytes: {
        byCase: [],
        maximum: 0,
        minimum: 0,
        policy: "natural",
      },
      summaries: [],
    },
    policies: {
      finalHtmlCacheInHeadline: false,
      headlineInput: "request-timestamped-input",
      headlineMode: "dynamic",
      payload: "natural",
      workersPerCase: 1,
    },
    rawRounds: [],
    schema: REPORT_SCHEMA,
    sourceRevision: {
      commit: "b".repeat(40),
      sourceDigest: "a".repeat(64),
      workingTreeDirty: true,
    },
    summaries: [],
  };
}

function setResponseMode(report, responseMode) {
  const expectedCases = new Map(
    createCaseMatrix({ responseMode }).map((entry) => [entry.id, entry]),
  );
  report.config = { responseMode };
  report.policies.responseMode = responseMode;
  for (const collection of [report.cases, report.summaries]) {
    for (const entry of collection) {
      const expected = expectedCases.get(entry.id ?? entry.caseId);
      entry.responseMode = responseMode;
      if (expected !== undefined) {
        entry.renderer = expected.renderer;
        entry.streaming = expected.streaming;
      }
    }
  }
  for (const round of report.rawRounds) {
    const expected = expectedCases.get(round.caseId);
    round.responseMode = responseMode;
    if (expected !== undefined) {
      round.streaming = expected.streaming;
    }
  }
  report.capabilities = responseMode === "progressive"
    ? { asyncDataBoundary: ASYNC_DATA_BOUNDARY_CAPABILITY }
    : {};
}

test("schema accepts one unified official matrix report", () => {
  const report = validReport();
  assert.deepEqual(validateReportSchema(report), {
    errors: [],
    valid: true,
  });
  assert.strictEqual(assertReportSchema(report), report);
});

test("schema rejects cached or fresh input in headline", () => {
  const report = validReport();
  report.cases[0].inputPolicy = "fresh-input";
  const validation = validateReportSchema(report);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /headline cases/u);
});

test("schema rejects cached headline rows and final HTML caching", () => {
  const cached = validReport();
  cached.cases[0].mode = "cached";
  assert.match(
    validateReportSchema(cached).errors.join("\n"),
    /dynamic SSR with natural bytes/u,
  );
  const cachePolicy = validReport();
  cachePolicy.policies.finalHtmlCacheInHeadline = true;
  assert.match(
    validateReportSchema(cachePolicy).errors.join("\n"),
    /must not cache final HTML/u,
  );
});

test("schema rejects padded payloads", () => {
  const report = validReport();
  report.policies.payload = "equal-padded";
  report.cases[0].payloadPolicy = "equal-padded";
  const errors = validateReportSchema(report).errors.join("\n");
  assert.match(errors, /natural response bytes/u);
  assert.match(errors, /dynamic SSR with natural bytes/u);
});

test("schema rejects Fastify rows and missing renderer/transport metadata", () => {
  const fastify = validReport();
  fastify.cases[0].serverId = "fastify";
  assert.match(
    validateReportSchema(fastify).errors.join("\n"),
    /must not use the Fastify transport/u,
  );
  const untyped = validReport();
  delete untyped.cases[0].transport;
  assert.match(
    validateReportSchema(untyped).errors.join("\n"),
    /distinguish renderer from transport/u,
  );
});

test("schema rejects multi-worker cases and wrong matrix size", () => {
  const workers = validReport();
  workers.policies.workersPerCase = 24;
  workers.cases[0].workerCount = 24;
  const errors = validateReportSchema(workers).errors.join("\n");
  assert.match(errors, /exactly one worker/u);
  assert.match(errors, /one worker/u);
  const size = validReport();
  size.matrix.expectedCaseCount = 46;
  assert.match(
    validateReportSchema(size).errors.join("\n"),
    /exactly 16 rows/u,
  );
});

test("schema accepts an explicit response mode and rejects an unknown one", () => {
  const complete = validReport();
  setResponseMode(complete, "complete");
  assert.deepEqual(validateReportSchema(complete), {
    errors: [],
    valid: true,
  });
  const unknownPolicy = validReport();
  setResponseMode(unknownPolicy, "complete");
  unknownPolicy.policies.responseMode = "eventual";
  assert.match(
    validateReportSchema(unknownPolicy).errors.join("\n"),
    /every responseMode must be complete or progressive/u,
  );
  const unknownCase = validReport();
  setResponseMode(unknownCase, "complete");
  unknownCase.cases[0].responseMode = "eventual";
  assert.match(
    validateReportSchema(unknownCase).errors.join("\n"),
    /every responseMode must be complete or progressive/u,
  );
});

test("schema rejects a report that mixes response modes across cases and policy", () => {
  const mixed = validReport();
  setResponseMode(mixed, "progressive");
  mixed.cases[0].responseMode = "complete";
  assert.match(
    validateReportSchema(mixed).errors.join("\n"),
    /must not mix response modes/u,
  );
});

test("schema rejects partially labeled response-mode evidence", () => {
  const partial = validReport();
  setResponseMode(partial, "complete");
  delete partial.policies.responseMode;
  assert.match(
    validateReportSchema(partial).errors.join("\n"),
    /absent everywhere.*present on every mode-bearing entry/u,
  );
});

test("schema validates matrix modes and progressive capability disclosure", () => {
  const mixedMatrix = validReport();
  mixedMatrix.matrix.summaries = [{ responseMode: "progressive" }];
  setResponseMode(mixedMatrix, "complete");
  mixedMatrix.matrix.summaries[0].responseMode = "progressive";
  assert.match(
    validateReportSchema(mixedMatrix).errors.join("\n"),
    /must not mix response modes/u,
  );

  const missingCapability = validReport();
  setResponseMode(missingCapability, "progressive");
  delete missingCapability.capabilities.asyncDataBoundary;
  assert.match(
    validateReportSchema(missingCapability).errors.join("\n"),
    /must disclose.*async data-boundary capability/u,
  );
});

test("schema rejects relabeling progressive renderer evidence as complete", () => {
  const relabeled = validReport();
  setResponseMode(relabeled, "progressive");
  relabeled.config.responseMode = "complete";
  relabeled.policies.responseMode = "complete";
  relabeled.capabilities = {};
  for (const entry of relabeled.cases) {
    entry.responseMode = "complete";
  }
  assert.match(
    validateReportSchema(relabeled).errors.join("\n"),
    /does not match the complete suite renderer\/streaming contract/u,
  );
});

test("schema keeps validating legacy reports that predate the response-mode dimension", () => {
  const legacy = validReport();
  assert.equal(legacy.policies.responseMode, undefined);
  assert.equal(legacy.cases[0].responseMode, undefined);
  assert.deepEqual(validateReportSchema(legacy), {
    errors: [],
    valid: true,
  });
});

test("schema validates optional lifecycle memory telemetry", () => {
  const report = validReport();
  report.rawRounds = [{
    caseId: "webui-node-http",
    latencyP95Ms: 1,
    requestsPerSecond: 1,
    serverCpuMillisecondsPerRequest: 0.5,
    serverMemory: {
      loadDeltaPeakRssBytes: 10,
      postSettle: { rssBytes: 110, status: "available" },
      postWarmup: { rssBytes: 105, status: "available" },
      retainedRssBytes: 10,
      startup: { rssBytes: 100, status: "available" },
      peakDuringLoad: { rssBytes: 110, status: "available" },
    },
  }];
  assert.equal(validateReportSchema(report).valid, true);
  report.rawRounds[0].serverMemory.startup = { status: "available" };
  assert.match(
    validateReportSchema(report).errors.join("\n"),
    /lifecycle RSS snapshots/u,
  );
});
