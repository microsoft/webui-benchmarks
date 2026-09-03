// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearCompletedTodos,
  filterTodos,
  selectTodo,
  toggleTodoCompletion,
} from "../interactions.mjs";
import { FILTER_IDS, TODO_ITEM_COUNT } from "../../../shared/contract.mjs";
import { createTodoState } from "../../../shared/state.mjs";

function completedCount(state) {
  return state.todos.filter((todo) => todo.completed).length;
}

test("filtering narrows visibility without mutating the source state", () => {
  const state = createTodoState(0);
  const snapshot = JSON.stringify(state);
  const pending = filterTodos(state, "pending");
  assert.equal(JSON.stringify(state), snapshot, "filter must not mutate state");
  assert.equal(pending.toolbar.activeFilter, "pending");

  const visible = pending.todos.filter((todo) => todo.visible).length;
  assert.ok(visible > 0 && visible < TODO_ITEM_COUNT, "pending filter is inert");

  const completed = filterTodos(state, "completed");
  assert.equal(
    completed.todos.filter((todo) => todo.visible).length,
    TODO_ITEM_COUNT - visible,
  );

  const all = filterTodos(state, "all");
  assert.equal(
    all.todos.filter((todo) => todo.visible).length,
    TODO_ITEM_COUNT,
  );

  for (const filterId of FILTER_IDS) {
    const filtered = filterTodos(state, filterId);
    assert.equal(
      filtered.toolbar.filters.filter((filter) => filter.active).length,
      1,
      `${filterId} must be the single active filter`,
    );
  }
});

test("selecting a todo moves the single selection", () => {
  const state = createTodoState(0);
  const target = state.todos[3];
  const selected = selectTodo(state, target.id);
  assert.equal(selected.selection.todoId, target.id);
  assert.equal(selected.selection.hasSelection, true);
  assert.equal(selected.selection.label, `Selected ${target.id}`);
  assert.equal(
    selected.todos.filter((todo) => todo.selected).length,
    1,
    "exactly one todo may be selected",
  );
  const [chosen] = selected.todos.filter((todo) => todo.selected);
  assert.equal(chosen.id, target.id);
  assert.equal(chosen.selectionLabel, "Selected");
});

test("toggling completion flips the todo and keeps counts consistent", () => {
  const state = createTodoState(0);
  const target = state.todos.find((todo) => !todo.completed);
  const before = completedCount(state);
  const toggled = toggleTodoCompletion(state, target.id);
  const after = toggled.todos.find((todo) => todo.id === target.id);
  assert.equal(after.completed, true);
  assert.equal(after.pending, false);
  assert.equal(after.statusLabel, "Completed");
  assert.equal(completedCount(toggled), before + 1);
  assert.equal(toggled.summary.completedCount, before + 1);
  assert.equal(
    toggled.summary.pendingCount,
    TODO_ITEM_COUNT - (before + 1),
  );

  const restored = toggleTodoCompletion(toggled, target.id);
  assert.equal(completedCount(restored), before);
});

test("clearing completed todos leaves the contract footer state", () => {
  const state = createTodoState(0);
  const cleared = clearCompletedTodos(state);
  assert.equal(cleared.todos.length, 75, "must remove completed todos");
  assert.equal(cleared.summary.totalCount, 75);
  assert.equal(cleared.footer.itemCountLabel, "75 items");
  assert.equal(cleared.intelligence.resultCount, 75);
  assert.equal(completedCount(cleared), 0, "no completed todo may remain");
  assert.ok(
    cleared.intelligence.previewRows.every(
      ({ completed }) => completed === false,
    ),
    "workspace rows must refresh after clearing completed todos",
  );
  assert.equal(cleared.selection.hasSelection, true);
  assert.ok(
    cleared.todos.some(
      (todo) =>
        todo.id === cleared.selection.todoId
        && todo.selected
        && todo.selectionLabel === "Selected",
    ),
    "a remaining todo must stay selected",
  );
});
