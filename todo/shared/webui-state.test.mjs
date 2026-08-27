// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import { createTodoState } from "./state.mjs";
import {
  createWebuiTodo,
  createWebuiRenderState,
} from "./webui-state.mjs";

test("WebUI render state keeps rich SSR todos out of client state", () => {
  const state = createTodoState(0);
  const projected = createWebuiRenderState(state);
  assert.notEqual(projected, state);
  assert.notEqual(projected.todos, state.todos);
  assert.equal(projected.todos.length, state.todos.length);
  assert.deepEqual(
    projected.todos[0],
    createWebuiTodo(state.todos[0]),
  );
  assert.equal(Object.hasOwn(projected.todos[0], "subtasks"), false);
  assert.equal(Object.hasOwn(projected.todos[0], "assignee"), false);
  assert.equal(Object.hasOwn(projected.todos[0], "timestamp"), false);
  assert.equal(Object.hasOwn(projected.intelligence, "analytics"), false);
  assert.equal(Object.hasOwn(projected.intelligence, "boardColumns"), false);
  assert.ok(Object.hasOwn(state.intelligence, "analytics"));
  assert.ok(Object.hasOwn(state.intelligence, "boardColumns"));
});
