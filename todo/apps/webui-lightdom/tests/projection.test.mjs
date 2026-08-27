// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import {
  createRequestTodoState,
  createTodoState,
} from "../../../shared/state.mjs";
import { createRenderer } from "../adapter.mjs";

const MAXIMUM_PROJECTED_STATE_BYTES = 90 * 1024;

test("projects only WebUI client-owned state", async () => {
  const renderer = await createRenderer();
  const html = renderer.render(
    createRequestTodoState(
      createTodoState(0),
      "2026-08-27T00:00:00.000000Z",
    ),
    "/dynamic",
  );
  const match =
    /<script[^>]*id="webui-data"[^>]*>([\s\S]*?)<\/script>/u.exec(html);
  assert.notEqual(match, null, "WebUI hydration data is missing");
  const state = JSON.parse(match[1]).state;
  assert.deepEqual(Object.keys(state), [
    "footer",
    "intelligence",
    "selection",
    "summary",
    "todos",
    "toolbar",
  ]);
  assert.equal(Object.hasOwn(state.intelligence, "analytics"), false);
  assert.equal(Object.hasOwn(state.intelligence, "boardColumns"), false);
  assert.equal(Object.hasOwn(state.todos[0], "assignee"), false);
  assert.equal(Object.hasOwn(state.todos[0], "subtasks"), false);
  assert.equal(Object.hasOwn(state.todos[0], "timestamp"), false);
  assert.ok(
    Buffer.byteLength(JSON.stringify(state)) <= MAXIMUM_PROJECTED_STATE_BYTES,
    `projected state exceeds ${MAXIMUM_PROJECTED_STATE_BYTES} bytes`,
  );
  assert.match(html, /Dynamic request variant 01 item 0001/u);
  assert.match(html, /subtasks complete/u);
  assert.match(html, /data-tag-id=/u);
});
