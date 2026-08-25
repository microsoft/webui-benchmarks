// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import { summarizeInlineJavascript } from "../measurement.mjs";

test("counts executable inline JavaScript UTF-8 bytes", () => {
  const executable = [
    { text: "globalThis.classic = true;", type: null },
    { text: "globalThis.module = true;", type: " module " },
    {
      text: "globalThis.mime = '🙂';",
      type: "text/javascript; charset=utf-8",
    },
    { text: "globalThis.legacy = true;", type: "application/x-javascript" },
  ];
  const result = summarizeInlineJavascript([
    ...executable,
    { text: '{"data":true}', type: "application/json" },
    { text: '{"structured":true}', type: "application/ld+json" },
    { text: "not code", type: "text/plain" },
    { text: '{"imports":{}}', type: "importmap" },
    { text: '{"prefetch":[]}', type: "speculationrules" },
    { hasSource: true, text: "ignored fallback", type: null },
    { noModule: true, text: "legacy fallback", type: null },
  ]);
  const expectedBytes = executable.reduce(
    (total, { text }) => total + new TextEncoder().encode(text).byteLength,
    0,
  );
  assert.deepEqual(result, { bytes: expectedBytes, count: executable.length });
  assert.equal(Object.isFrozen(result), true);
});

test("rejects non-array inline script input", () => {
  assert.throws(
    () => summarizeInlineJavascript(null),
    /must be an array/u,
  );
});
