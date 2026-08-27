// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import { createTodoState } from "./state.mjs";
import {
  WORKSPACE_MINIMUM_EMITTED_BYTES,
  WORKSPACE_PREVIEW_ROW_COUNT,
  archiveWorkspaceSelection,
  exportWorkspaceRows,
  filterWorkspace,
  resetWorkspaceIntelligence,
  saveWorkspaceView,
  searchWorkspace,
  selectWorkspaceView,
  setWorkspaceSchedule,
  toggleWorkspaceRow,
} from "./workspace-intelligence.mjs";

test("creates a deterministic analytics workbench from the todo fixture", () => {
  const { intelligence } = createTodoState(0);
  assert.equal(WORKSPACE_MINIMUM_EMITTED_BYTES, 200 * 1024);
  assert.equal(intelligence.resultCount, 100);
  assert.equal(intelligence.previewRows.length, WORKSPACE_PREVIEW_ROW_COUNT);
  assert.equal(intelligence.boardColumns.length, 3);
  assert.equal(intelligence.analytics.priorityBars.length, 3);
  assert.equal(intelligence.analytics.donutSegments.length, 2);
  assert.equal(intelligence.schedulePreview.dates.length, 4);
  assert.equal(intelligence.view, "table");
});

test("runs the canonical workspace workflow without mutating its input", () => {
  const initial = createTodoState(0);
  let state = searchWorkspace(initial, "Todo 0050");
  assert.equal(state.intelligence.resultCount, 1);
  const sentinel = state.intelligence.previewRows[0];

  state = filterWorkspace(state, "status", sentinel.status);
  state = filterWorkspace(state, "priority", sentinel.priority);
  state = filterWorkspace(state, "assignment", sentinel.assignment);
  state = filterWorkspace(state, "sort", "title");
  assert.equal(state.intelligence.resultCount, 1);

  state = toggleWorkspaceRow(state, sentinel.id);
  assert.deepEqual(state.intelligence.selectedIds, [{ id: sentinel.id }]);
  state = exportWorkspaceRows(state);
  assert.equal(state.intelligence.exportRows, 1);
  assert.ok(state.intelligence.exportBytes > 0);
  state = saveWorkspaceView(state);
  assert.equal(state.intelligence.savedViewCount, 1);
  assert.match(state.intelligence.validationMessage, /saved and validated/u);
  state = archiveWorkspaceSelection(state);
  assert.equal(state.intelligence.archivedCount, 1);
  assert.equal(state.intelligence.resultCount, 0);

  state = resetWorkspaceIntelligence(state);
  state = selectWorkspaceView(state, "insights");
  state = setWorkspaceSchedule(state, "weekly");
  assert.equal(state.intelligence.resultCount, 100);
  assert.equal(state.intelligence.view, "insights");
  assert.equal(state.intelligence.schedulePreview.label, "Every Monday");
  assert.equal(initial.intelligence.query, "");
  assert.equal(initial.intelligence.archivedCount, 0);
});

test("supports fuzzy search and rejects unsupported controls", () => {
  const state = createTodoState(0);
  assert.equal(searchWorkspace(state, "secutiry").intelligence.resultCount, 20);
  const dueSorted = filterWorkspace(state, "sort", "due");
  assert.deepEqual(
    dueSorted.intelligence.previewRows.map(({ dueRank }) => dueRank),
    [...dueSorted.intelligence.previewRows]
      .map(({ dueRank }) => dueRank)
      .sort((left, right) => left - right),
  );
  assert.throws(
    () => filterWorkspace(state, "unknown", "all"),
    /Unknown workspace facet/u,
  );
  assert.throws(
    () => selectWorkspaceView(state, "timeline"),
    /Unknown workspace view/u,
  );
  assert.throws(
    () => setWorkspaceSchedule(state, "monthly"),
    /Unknown schedule/u,
  );
});
