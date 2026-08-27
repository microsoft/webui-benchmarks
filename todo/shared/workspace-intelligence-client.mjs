// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  WORKSPACE_SCHEDULE_IDS,
  WORKSPACE_VIEW_IDS,
  assembleWorkspaceIntelligence,
  deriveWorkspaceRows,
  normalizeWorkspaceControls,
} from "./workspace-intelligence-core.mjs";

let loadedSearchWorkspaceIds;
let loadedWorkspaceAnalytics;

function readWorkspaceState(state) {
  return typeof state === "function" ? state() : state;
}

async function loadSearchWorkspaceIds() {
  const { searchWorkspaceIds } = await import("./workspace-search.mjs");
  loadedSearchWorkspaceIds = searchWorkspaceIds;
  return searchWorkspaceIds;
}

async function loadWorkspaceAnalytics() {
  const { createWorkspaceAnalytics } = await import(
    "./workspace-analytics.mjs"
  );
  loadedWorkspaceAnalytics = createWorkspaceAnalytics;
  return createWorkspaceAnalytics;
}

function matchingIdsFor(todos, controls, previous) {
  if (controls.query && loadedSearchWorkspaceIds !== undefined) {
    return loadedSearchWorkspaceIds(todos, controls.query);
  }
  return Object.hasOwn(previous, "matchingIds")
    ? new Set(controls.matchingIds.map(({ id }) => id))
    : new Set(todos.map(({ id }) => id));
}

function workspaceInputs(
  stateSource,
  changes,
  searchWorkspaceIds,
  reset,
) {
  const state = readWorkspaceState(stateSource);
  const resolvedChanges = typeof changes === "function"
    ? changes(state)
    : changes;
  const controls = normalizeWorkspaceControls({
    ...(reset ? {} : state.intelligence),
    ...resolvedChanges,
  });
  const matchingIds = searchWorkspaceIds === undefined
    ? matchingIdsFor(state.todos, controls, state.intelligence)
    : searchWorkspaceIds(state.todos, controls.query);
  controls.matchingIds = [...matchingIds].map((id) => ({ id }));
  return {
    controls,
    rows: deriveWorkspaceRows(state.todos, controls, matchingIds),
    state,
  };
}

async function rebuildWorkspace(
  stateSource,
  changes = {},
  {
    recomputeAnalytics = false,
    recomputeSchedule = false,
    recomputeSearch = false,
    reset = false,
  } = {},
) {
  const searchWorkspaceIds = recomputeSearch
    ? await loadSearchWorkspaceIds()
    : undefined;
  let createWorkspaceAnalytics = recomputeAnalytics
    ? await loadWorkspaceAnalytics()
    : undefined;
  let createWorkspaceSchedulePreview;
  if (recomputeSchedule) {
    ({ createWorkspaceSchedulePreview } = await import(
      "./workspace-schedule.mjs"
    ));
  }
  let inputs = workspaceInputs(
    stateSource,
    changes,
    searchWorkspaceIds,
    reset,
  );
  if (
    inputs.controls.view === "insights"
    && createWorkspaceAnalytics === undefined
  ) {
    createWorkspaceAnalytics = await loadWorkspaceAnalytics();
    inputs = workspaceInputs(
      stateSource,
      changes,
      searchWorkspaceIds,
      reset,
    );
  }
  const { controls, rows, state } = inputs;
  const analytics = createWorkspaceAnalytics === undefined
    ? state.intelligence.analytics
    : createWorkspaceAnalytics(rows);
  const schedulePreview = createWorkspaceSchedulePreview === undefined
    ? state.intelligence.schedulePreview
    : createWorkspaceSchedulePreview(controls.schedule);
  return {
    ...state,
    intelligence: assembleWorkspaceIntelligence(controls, rows, {
      analytics,
      schedulePreview,
    }),
  };
}

export function createClientWorkspaceIntelligence(todos, previous = {}) {
  const controls = normalizeWorkspaceControls(previous);
  const matchingIds = matchingIdsFor(todos, controls, previous);
  controls.matchingIds = [...matchingIds].map((id) => ({ id }));
  const rows = deriveWorkspaceRows(todos, controls, matchingIds);
  return assembleWorkspaceIntelligence(controls, rows, {
    analytics:
      controls.view === "insights" && loadedWorkspaceAnalytics !== undefined
        ? loadedWorkspaceAnalytics(rows)
        : previous.analytics,
    schedulePreview: previous.schedulePreview,
  });
}

export function searchWorkspace(state, query) {
  return rebuildWorkspace(
    state,
    { query, selectedIds: [] },
    { recomputeSearch: true },
  );
}

export function filterWorkspace(state, facet, value) {
  if (!["assignment", "priority", "status", "sort"].includes(facet)) {
    throw new RangeError(`Unknown workspace facet '${facet}'`);
  }
  return rebuildWorkspace(state, { [facet]: value, selectedIds: [] });
}

export function selectWorkspaceView(state, view) {
  if (!WORKSPACE_VIEW_IDS.includes(view)) {
    throw new RangeError(`Unknown workspace view '${view}'`);
  }
  return rebuildWorkspace(
    state,
    { view },
    { recomputeAnalytics: view === "insights" },
  );
}

export function toggleWorkspaceRow(state, todoId) {
  return rebuildWorkspace(state, (current) => {
    const selectedIds = [...current.intelligence.selectedIds];
    const index = selectedIds.findIndex(({ id }) => id === todoId);
    if (index === -1) selectedIds.push({ id: todoId });
    else selectedIds.splice(index, 1);
    return { selectedIds };
  });
}

export function selectWorkspaceResults(state) {
  return rebuildWorkspace(state, (current) => ({
    selectedIds: current.intelligence.previewRows.map(({ id }) => ({ id })),
  }));
}

export function archiveWorkspaceSelection(state) {
  return rebuildWorkspace(state, (current) => ({
    archivedIds: [
      ...new Map(
        [
          ...current.intelligence.archivedIds,
          ...current.intelligence.selectedIds,
        ].map((entry) => [entry.id, entry]),
      ).values(),
    ],
    selectedIds: [],
  }));
}

export async function saveWorkspaceView(state) {
  const { parseSavedWorkspaceView } = await import(
    "./workspace-saved-view.mjs"
  );
  return rebuildWorkspace(state, (current) => {
    const id = `saved-${current.intelligence.savedViews.length + 1}`;
    const candidate = {
      assignment: current.intelligence.assignment,
      id,
      label: `Saved view ${current.intelligence.savedViews.length + 1}`,
      priority: current.intelligence.priority,
      query: current.intelligence.query,
      sort: current.intelligence.sort,
      status: current.intelligence.status,
      view: current.intelligence.view,
    };
    const parsed = parseSavedWorkspaceView(candidate);
    return parsed.success
      ? {
          savedViews: [...current.intelligence.savedViews, parsed.data],
          validationMessage: `${parsed.data.label} saved and validated`,
        }
      : {
          validationMessage: parsed.error.issues[0]?.message
            ?? "Saved view validation failed",
        };
  });
}

export async function exportWorkspaceRows(state) {
  const { createWorkspaceCsv } = await import("./workspace-csv.mjs");
  return rebuildWorkspace(state, (current) => {
    const csv = createWorkspaceCsv(current.intelligence.previewRows);
    return {
      exportBytes: new TextEncoder().encode(csv).byteLength,
      exportRows: current.intelligence.previewRows.length,
      exportStatus: "CSV export generated",
    };
  });
}

export function setWorkspaceSchedule(state, schedule) {
  if (!WORKSPACE_SCHEDULE_IDS.includes(schedule)) {
    throw new RangeError(`Unknown schedule '${schedule}'`);
  }
  return rebuildWorkspace(
    state,
    { schedule },
    { recomputeSchedule: true },
  );
}

export function resetWorkspaceIntelligence(state) {
  const current = readWorkspaceState(state);
  return rebuildWorkspace(
    state,
    (latest) => ({
      matchingIds: latest.todos.map(({ id }) => ({ id })),
    }),
    {
      recomputeSchedule: current.intelligence.schedule !== "weekdays",
      reset: true,
    },
  );
}
