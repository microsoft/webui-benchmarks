// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { produce } from "immer";
import { createWorkspaceAnalytics } from "./workspace-analytics.mjs";
import { createWorkspaceCsv } from "./workspace-csv.mjs";
import {
  WORKSPACE_PREVIEW_ROW_COUNT,
  WORKSPACE_SCHEDULE_IDS,
  WORKSPACE_VIEW_IDS,
  assembleWorkspaceIntelligence,
  deriveWorkspaceRows,
  normalizeWorkspaceControls,
} from "./workspace-intelligence-core.mjs";
import { parseSavedWorkspaceView } from "./workspace-saved-view.mjs";
import { createWorkspaceSchedulePreview } from "./workspace-schedule.mjs";
import { searchWorkspaceIds } from "./workspace-search.mjs";

export const WORKSPACE_MINIMUM_EMITTED_BYTES = 200 * 1024;
export { WORKSPACE_PREVIEW_ROW_COUNT };

export function createWorkspaceIntelligence(todos, previous = {}) {
  const controls = normalizeWorkspaceControls(previous);
  const matchingIds = searchWorkspaceIds(todos, controls.query);
  controls.matchingIds = [...matchingIds].map((id) => ({ id }));
  const rows = deriveWorkspaceRows(todos, controls, matchingIds);
  return assembleWorkspaceIntelligence(controls, rows, {
    analytics: createWorkspaceAnalytics(rows),
    schedulePreview: createWorkspaceSchedulePreview(controls.schedule),
  });
}

function updateIntelligence(state, recipe) {
  const controls = produce(
    normalizeWorkspaceControls(state.intelligence),
    recipe,
  );
  return {
    ...state,
    intelligence: createWorkspaceIntelligence(state.todos, controls),
  };
}

export function searchWorkspace(state, query) {
  return updateIntelligence(state, (draft) => {
    draft.query = query;
    draft.selectedIds = [];
  });
}

export function filterWorkspace(state, facet, value) {
  if (!["assignment", "priority", "status", "sort"].includes(facet)) {
    throw new RangeError(`Unknown workspace facet '${facet}'`);
  }
  return updateIntelligence(state, (draft) => {
    draft[facet] = value;
    draft.selectedIds = [];
  });
}

export function selectWorkspaceView(state, view) {
  if (!WORKSPACE_VIEW_IDS.includes(view)) {
    throw new RangeError(`Unknown workspace view '${view}'`);
  }
  return updateIntelligence(state, (draft) => {
    draft.view = view;
  });
}

export function toggleWorkspaceRow(state, todoId) {
  return updateIntelligence(state, (draft) => {
    const index = draft.selectedIds.findIndex(({ id }) => id === todoId);
    if (index === -1) {
      draft.selectedIds.push({ id: todoId });
    } else {
      draft.selectedIds.splice(index, 1);
    }
  });
}

export function selectWorkspaceResults(state) {
  return updateIntelligence(state, (draft) => {
    draft.selectedIds = state.intelligence.previewRows.map(({ id }) => ({ id }));
  });
}

export function archiveWorkspaceSelection(state) {
  return updateIntelligence(state, (draft) => {
    draft.archivedIds = [
      ...new Map(
        [...draft.archivedIds, ...draft.selectedIds].map(
          (entry) => [entry.id, entry],
        ),
      ).values(),
    ];
    draft.selectedIds = [];
  });
}

export function saveWorkspaceView(state) {
  const id = `saved-${state.intelligence.savedViews.length + 1}`;
  const candidate = {
    assignment: state.intelligence.assignment,
    id,
    label: `Saved view ${state.intelligence.savedViews.length + 1}`,
    priority: state.intelligence.priority,
    query: state.intelligence.query,
    sort: state.intelligence.sort,
    status: state.intelligence.status,
    view: state.intelligence.view,
  };
  const parsed = parseSavedWorkspaceView(candidate);
  return updateIntelligence(state, (draft) => {
    if (parsed.success) {
      draft.savedViews.push(parsed.data);
      draft.validationMessage = `${parsed.data.label} saved and validated`;
    } else {
      draft.validationMessage = parsed.error.issues[0]?.message
        ?? "Saved view validation failed";
    }
  });
}

export function exportWorkspaceRows(state) {
  const csv = createWorkspaceCsv(state.intelligence.previewRows);
  return updateIntelligence(state, (draft) => {
    draft.exportBytes = new TextEncoder().encode(csv).byteLength;
    draft.exportRows = state.intelligence.previewRows.length;
    draft.exportStatus = "CSV export generated";
  });
}

export function setWorkspaceSchedule(state, schedule) {
  if (!WORKSPACE_SCHEDULE_IDS.includes(schedule)) {
    throw new RangeError(`Unknown schedule '${schedule}'`);
  }
  return updateIntelligence(state, (draft) => {
    draft.schedule = schedule;
  });
}

export function resetWorkspaceIntelligence(state) {
  return {
    ...state,
    intelligence: createWorkspaceIntelligence(state.todos),
  };
}
