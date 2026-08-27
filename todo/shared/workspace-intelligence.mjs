// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  arc,
  area,
  bin,
  csvFormat,
  curveMonotoneX,
  extent,
  line,
  max,
  mean,
  pie,
  rollups,
  scaleBand,
  scaleLinear,
  stack,
  sum,
} from "d3";
import {
  addDays,
  format,
  formatDistanceStrict,
  startOfWeek,
} from "date-fns";
import { produce } from "immer";
import MiniSearch from "minisearch";
import rrulePackage from "rrule/dist/es5/rrule.js";
import {
  enum as zodEnum,
  object as zodObject,
  string as zodString,
} from "zod";

const { RRule } = rrulePackage;

export const WORKSPACE_MINIMUM_EMITTED_BYTES = 200 * 1024;
export const WORKSPACE_PREVIEW_ROW_COUNT = 12;

const viewIds = Object.freeze(["table", "board", "insights"]);
const statusIds = Object.freeze(["all", "pending", "completed"]);
const priorityIds = Object.freeze(["all", "high", "medium", "low"]);
const assignmentIds = Object.freeze(["all", "assigned", "unassigned"]);
const sortIds = Object.freeze(["priority", "title", "owner", "due"]);
const scheduleIds = Object.freeze(["daily", "weekdays", "weekly"]);

const savedViewSchema = zodObject({
  assignment: zodEnum(assignmentIds),
  id: zodString().min(1).max(64),
  label: zodString().min(1).max(64),
  priority: zodEnum(priorityIds),
  query: zodString().max(120),
  sort: zodEnum(sortIds),
  status: zodEnum(statusIds),
  view: zodEnum(viewIds),
});

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

function normalizeControls(previous = {}) {
  return {
    archivedIds: idEntries(previous.archivedIds),
    assignment: assignmentIds.includes(previous.assignment)
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
    priority: priorityIds.includes(previous.priority)
      ? previous.priority
      : "all",
    query: typeof previous.query === "string" ? previous.query : "",
    savedViews: Array.isArray(previous.savedViews) ? previous.savedViews : [],
    schedule: scheduleIds.includes(previous.schedule)
      ? previous.schedule
      : "weekdays",
    selectedIds: idEntries(previous.selectedIds),
    sort: sortIds.includes(previous.sort) ? previous.sort : "priority",
    status: statusIds.includes(previous.status) ? previous.status : "all",
    validationMessage: typeof previous.validationMessage === "string"
      ? previous.validationMessage
      : "Saved views are schema validated",
    view: viewIds.includes(previous.view) ? previous.view : "table",
  };
}

function searchIds(todos, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return new Set(todos.map(({ id }) => id));
  }
  const exactMatches = todos.filter((todo) =>
    [
      todo.assigneeLabel,
      todo.description,
      todo.id,
      todo.priorityLabel,
      todo.statusLabel,
      todo.title,
      ...todo.tags.map(({ label }) => label),
    ].some((value) => value.toLowerCase().includes(normalized))
  );
  if (exactMatches.length > 0) {
    return new Set(exactMatches.map(({ id }) => id));
  }
  const index = new MiniSearch({
    fields: [
      "assignee",
      "description",
      "id",
      "priority",
      "status",
      "tags",
      "title",
    ],
    idField: "id",
    storeFields: ["id"],
  });
  index.addAll(
    todos.map((todo) => ({
      assignee: todo.assigneeLabel,
      description: todo.description,
      id: todo.id,
      priority: todo.priorityLabel,
      status: todo.statusLabel,
      tags: todo.tags.map(({ label }) => label).join(" "),
      title: todo.title,
    })),
  );
  return new Set(
    index.search(normalized, {
      combineWith: "AND",
      fuzzy: 0.2,
      prefix: true,
    }).map(({ id }) => String(id)),
  );
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

function tableRows(rows, sort) {
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

function analyticsFor(rows) {
  const priorities = ["high", "medium", "low"];
  const counts = new Map(
    rollups(rows, (items) => items.length, (row) => row.priority),
  );
  const maximum = max(priorities, (priority) => counts.get(priority) ?? 0) || 1;
  const width = scaleLinear().domain([0, maximum]).range([0, 100]);
  const x = scaleBand().domain(priorities).range([24, 276]).padding(0.22);
  const priorityBars = priorities.map((priority) => ({
    count: counts.get(priority) ?? 0,
    id: priority,
    label: `${priority[0].toUpperCase()}${priority.slice(1)}`,
    percent: width(counts.get(priority) ?? 0),
    x: x(priority) ?? 0,
  }));

  const buckets = Array.from({ length: 12 }, (_, index) => {
    const slice = rows.filter((_, rowIndex) => rowIndex % 12 === index);
    return {
      completed: slice.filter(({ completed }) => completed).length,
      index,
      pending: slice.filter(({ completed }) => !completed).length,
      total: slice.length,
    };
  });
  const chartX = scaleLinear().domain([0, 11]).range([8, 292]);
  const chartY = scaleLinear()
    .domain([0, max(buckets, ({ total }) => total) || 1])
    .range([112, 8]);
  const trendPath = line()
    .x(({ index }) => chartX(index))
    .y(({ total }) => chartY(total))
    .curve(curveMonotoneX)(buckets) ?? "";
  const areaPath = area()
    .x(({ index }) => chartX(index))
    .y0(112)
    .y1(({ completed }) => chartY(completed))
    .curve(curveMonotoneX)(buckets) ?? "";

  const pieGenerator = pie().value((entry) => entry.value);
  const arcGenerator = arc().innerRadius(30).outerRadius(52);
  const statusValues = [
    { id: "pending", value: rows.filter(({ completed }) => !completed).length },
    { id: "completed", value: rows.filter(({ completed }) => completed).length },
  ];
  const donutSegments = pieGenerator(statusValues).map((segment) => ({
    id: segment.data.id,
    path: arcGenerator(segment) ?? "",
    value: segment.data.value,
  }));

  const tagCounts = rows.map((row) =>
    row.tagLabel === "No tags" ? 0 : row.tagLabel.split(",").length
  );
  const tagExtent = extent(tagCounts);
  const tagBins = bin()
    .domain([
      Number.isFinite(tagExtent[0]) ? tagExtent[0] : 0,
      Number.isFinite(tagExtent[1]) ? tagExtent[1] + 1 : 1,
    ])
    .thresholds(4)(tagCounts)
    .map((bucket, index) => ({ count: bucket.length, index }));
  const layers = stack()
    .keys(["pending", "completed"])(
      buckets.map(({ completed, pending }) => ({ completed, pending })),
    )
    .map((layer, index) => ({
      id: index === 0 ? "pending" : "completed",
      total: sum(layer, ([start, end]) => end - start),
    }));

  return {
    areaPath,
    averageTags: mean(tagCounts) ?? 0,
    averageTagsDisplay: (mean(tagCounts) ?? 0).toFixed(1),
    donutSegments,
    layers,
    priorityBars,
    tagBins,
    trendPath,
  };
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

function schedulePreview(schedule) {
  const options = {
    daily: {
      byweekday: undefined,
      freq: RRule.DAILY,
      interval: 1,
      label: "Every day",
    },
    weekdays: {
      byweekday: [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR],
      freq: RRule.WEEKLY,
      interval: 1,
      label: "Weekdays",
    },
    weekly: {
      byweekday: [RRule.MO],
      freq: RRule.WEEKLY,
      interval: 1,
      label: "Every Monday",
    },
  }[schedule];
  const weekStart = startOfWeek(new Date(Date.UTC(2026, 7, 31)), {
    weekStartsOn: 1,
  });
  const rule = new RRule({
    byweekday: options.byweekday,
    count: 6,
    dtstart: addDays(weekStart, 1),
    freq: options.freq,
    interval: options.interval,
  });
  return {
    dates: rule.all().slice(0, 4).map((date, index) => ({
      id: `schedule-${index + 1}`,
      label: format(date, "EEE, MMM d 'at' HH:mm"),
    })),
    humanized: formatDistanceStrict(rule.all()[0], addDays(weekStart, -1), {
      addSuffix: true,
    }),
    id: schedule,
    label: options.label,
  };
}

function labelsForControls(controls) {
  return {
    assignmentOptions: optionList(assignmentIds, controls.assignment, {
      all: "Any owner",
      assigned: "Assigned",
      unassigned: "Unassigned",
    }),
    priorityOptions: optionList(priorityIds, controls.priority, {
      all: "Any priority",
      high: "High",
      low: "Low",
      medium: "Medium",
    }),
    scheduleOptions: optionList(scheduleIds, controls.schedule, {
      daily: "Daily",
      weekdays: "Weekdays",
      weekly: "Weekly",
    }),
    sortOptions: optionList(sortIds, controls.sort, {
      due: "Due state",
      owner: "Owner",
      priority: "Priority",
      title: "Title",
    }),
    statusOptions: optionList(statusIds, controls.status, {
      all: "Any status",
      completed: "Completed",
      pending: "Pending",
    }),
    viewOptions: optionList(viewIds, controls.view, {
      board: "Board",
      insights: "Insights",
      table: "Table",
    }),
  };
}

export function createWorkspaceIntelligence(todos, previous = {}) {
  const controls = normalizeControls(previous);
  const archived = new Set(controls.archivedIds.map(({ id }) => id));
  const matchingIds = searchIds(todos, controls.query);
  let rows = todos
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
  rows = tableRows(rows, controls.sort);
  const selected = new Set(controls.selectedIds.map(({ id }) => id));
  rows = rows.map((row) => ({ ...row, bulkSelected: selected.has(row.id) }));
  const exportedAt = new Date(Date.UTC(2026, 7, 31, 16, 0, 0));
  const analytics = analyticsFor(rows);
  const labels = labelsForControls(controls);
  return {
    ...controls,
    ...labels,
    analytics,
    archivedCount: controls.archivedIds.length,
    boardColumns: boardFor(rows),
    exportGeneratedLabel: controls.exportRows > 0
      ? `${controls.exportRows} rows · ${controls.exportBytes} bytes · ${
        format(exportedAt, "MMM d, HH:mm")
      }`
      : controls.exportStatus,
    previewRows: rows.slice(0, WORKSPACE_PREVIEW_ROW_COUNT),
    resultCount: rows.length,
    resultLabel: `${rows.length} matching ${rows.length === 1 ? "item" : "items"}`,
    savedViewCount: controls.savedViews.length,
    schedulePreview: schedulePreview(controls.schedule),
    selectedCount: controls.selectedIds.length,
    selectedLabel:
      `${controls.selectedIds.length} selected`,
    viewLabel: labels.viewOptions.find(({ active }) => active)?.label ?? "Table",
  };
}

function updateIntelligence(state, recipe) {
  const controls = produce(normalizeControls(state.intelligence), recipe);
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
  if (!viewIds.includes(view)) {
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
  const parsed = savedViewSchema.safeParse(candidate);
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
  const csv = csvFormat(
    state.intelligence.previewRows.map((row) => ({
      due: row.dueLabel,
      id: row.id,
      owner: row.owner,
      priority: row.priorityLabel,
      status: row.statusLabel,
      title: row.title,
    })),
  );
  return updateIntelligence(state, (draft) => {
    draft.exportBytes = new TextEncoder().encode(csv).byteLength;
    draft.exportRows = state.intelligence.previewRows.length;
    draft.exportStatus = "CSV export generated";
  });
}

export function setWorkspaceSchedule(state, schedule) {
  if (!scheduleIds.includes(schedule)) {
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
