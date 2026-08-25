// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
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
      expectedCaseCount: 14,
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
    /exactly 14 rows/u,
  );
});
