// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export const WORKSPACE_PREVIEW_ROW_COUNT = 12;
export const WORKSPACE_VIEW_IDS = Object.freeze([
  "table",
  "board",
  "insights",
]);
export const WORKSPACE_STATUS_IDS = Object.freeze([
  "all",
  "pending",
  "completed",
]);
export const WORKSPACE_PRIORITY_IDS = Object.freeze([
  "all",
  "high",
  "medium",
  "low",
]);
export const WORKSPACE_ASSIGNMENT_IDS = Object.freeze([
  "all",
  "assigned",
  "unassigned",
]);
export const WORKSPACE_SORT_IDS = Object.freeze([
  "priority",
  "title",
  "owner",
  "due",
]);
export const WORKSPACE_SCHEDULE_IDS = Object.freeze([
  "daily",
  "weekdays",
  "weekly",
]);

function idEntries(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === "string") return [{ id: entry }];
    return entry !== null && typeof entry === "object"
        && typeof entry.id === "string"
      ? [{ id: entry.id }]
      : [];
  });
}

function optionList(ids, active, labels) {
  return ids.map((id) => ({
    active: id === active,
    id,
    label: labels[id],
  }));
}

export function normalizeWorkspaceControls(previous = {}) {
  return {
    archivedIds: idEntries(previous.archivedIds),
    assignment: WORKSPACE_ASSIGNMENT_IDS.includes(previous.assignment)
      ? previous.assignment
      : "all",
    exportBytes: Number.isFinite(previous.exportBytes)
      ? previous.exportBytes
      : 0,
    exportRows: Number.isFinite(previous.exportRows)
      ? previous.exportRows
      : 0,
    exportStatus: typeof previous.exportStatus === "string"
      ? previous.exportStatus
      : "Export not generated",
    matchingIds: idEntries(previous.matchingIds),
    priority: WORKSPACE_PRIORITY_IDS.includes(previous.priority)
      ? previous.priority
      : "all",
    query: typeof previous.query === "string" ? previous.query : "",
    savedViews: Array.isArray(previous.savedViews) ? previous.savedViews : [],
    schedule: WORKSPACE_SCHEDULE_IDS.includes(previous.schedule)
      ? previous.schedule
      : "weekdays",
    selectedIds: idEntries(previous.selectedIds),
    sort: WORKSPACE_SORT_IDS.includes(previous.sort)
      ? previous.sort
      : "priority",
    status: WORKSPACE_STATUS_IDS.includes(previous.status)
      ? previous.status
      : "all",
    validationMessage: typeof previous.validationMessage === "string"
      ? previous.validationMessage
      : "Saved views are schema validated",
    view: WORKSPACE_VIEW_IDS.includes(previous.view)
      ? previous.view
      : "table",
  };
}

function rowFromTodo(todo) {
  const priorityRank = { high: 0, medium: 1, low: 2 }[todo.priority];
  return {
    assignment: todo.assigned ? "assigned" : "unassigned",
    assigned: todo.assigned,
    completed: todo.completed,
    dueLabel: todo.dueLabel,
    dueRank: todo.overdue ? 0 : todo.dueToday ? 1 : 2,
    id: todo.id,
    owner: todo.assigneeLabel,
    priority: todo.priority,
    priorityLabel: todo.priorityLabel,
    priorityRank,
    selected: todo.selected,
    status: todo.completed ? "completed" : "pending",
    statusLabel: todo.statusLabel,
    tagLabel: todo.tags.map(({ label }) => label).join(", ") || "No tags",
    title: todo.title,
  };
}

function sortRows(rows, sort) {
  const valueFor = {
    due: (row) => row.dueRank,
    owner: (row) => row.owner,
    priority: (row) => row.priorityRank,
    title: (row) => row.title,
  }[sort];
  const compare = (left, right) => {
    const leftValue = valueFor(left);
    const rightValue = valueFor(right);
    if (leftValue === rightValue) return 0;
    return leftValue < rightValue ? -1 : 1;
  };
  return rows
    .map((row, index) => ({ index, row }))
    .sort(
      (left, right) =>
        compare(left.row, right.row) || left.index - right.index,
    )
    .map(({ row }, index) => ({
      ...row,
      displayIndex: index + 1,
    }));
}

export function deriveWorkspaceRows(todos, controls, matchingIds) {
  const archived = new Set(controls.archivedIds.map(({ id }) => id));
  const selected = new Set(controls.selectedIds.map(({ id }) => id));
  const rows = todos
    .filter(({ id }) => matchingIds.has(id) && !archived.has(id))
    .filter((todo) =>
      controls.status === "all"
        || controls.status === "completed" && todo.completed
        || controls.status === "pending" && !todo.completed
    )
    .filter((todo) =>
      controls.priority === "all" || todo.priority === controls.priority
    )
    .filter((todo) =>
      controls.assignment === "all"
        || controls.assignment === "assigned" && todo.assigned
        || controls.assignment === "unassigned" && !todo.assigned
    )
    .map(rowFromTodo);
  return sortRows(rows, controls.sort).map((row) => ({
    ...row,
    bulkSelected: selected.has(row.id),
  }));
}

function boardFor(rows) {
  return ["high", "medium", "low"].map((priority) => {
    const items = rows.filter((row) => row.priority === priority);
    return {
      count: items.length,
      id: priority,
      items: items.slice(0, 8),
      label: `${priority[0].toUpperCase()}${priority.slice(1)} priority`,
    };
  });
}

function labelsForControls(controls) {
  return {
    assignmentOptions: optionList(
      WORKSPACE_ASSIGNMENT_IDS,
      controls.assignment,
      {
        all: "Any owner",
        assigned: "Assigned",
        unassigned: "Unassigned",
      },
    ),
    priorityOptions: optionList(
      WORKSPACE_PRIORITY_IDS,
      controls.priority,
      {
        all: "Any priority",
        high: "High",
        low: "Low",
        medium: "Medium",
      },
    ),
    scheduleOptions: optionList(
      WORKSPACE_SCHEDULE_IDS,
      controls.schedule,
      {
        daily: "Daily",
        weekdays: "Weekdays",
        weekly: "Weekly",
      },
    ),
    sortOptions: optionList(WORKSPACE_SORT_IDS, controls.sort, {
      due: "Due state",
      owner: "Owner",
      priority: "Priority",
      title: "Title",
    }),
    statusOptions: optionList(WORKSPACE_STATUS_IDS, controls.status, {
      all: "Any status",
      completed: "Completed",
      pending: "Pending",
    }),
    viewOptions: optionList(WORKSPACE_VIEW_IDS, controls.view, {
      board: "Board",
      insights: "Insights",
      table: "Table",
    }),
  };
}

export function assembleWorkspaceIntelligence(
  controls,
  rows,
  { analytics, schedulePreview },
) {
  const labels = labelsForControls(controls);
  return {
    ...controls,
    ...labels,
    analytics,
    archivedCount: controls.archivedIds.length,
    boardColumns: boardFor(rows),
    exportGeneratedLabel: controls.exportRows > 0
      ? `${controls.exportRows} rows · ${controls.exportBytes} bytes · Aug 31, 16:00`
      : controls.exportStatus,
    matchingIds: controls.matchingIds,
    previewRows: rows.slice(0, WORKSPACE_PREVIEW_ROW_COUNT),
    resultCount: rows.length,
    resultLabel:
      `${rows.length} matching ${rows.length === 1 ? "item" : "items"}`,
    savedViewCount: controls.savedViews.length,
    schedulePreview,
    selectedCount: controls.selectedIds.length,
    selectedLabel: `${controls.selectedIds.length} selected`,
    viewLabel:
      labels.viewOptions.find(({ active }) => active)?.label ?? "Table",
  };
}
