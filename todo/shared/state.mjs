// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  FILTER_IDS,
  STATE_VARIANT_COUNT,
  TODO_ITEM_COUNT,
  countTodoBranches,
} from "./contract.mjs";

const TAGS = Object.freeze([
  Object.freeze({ key: "planning", label: "Planning", tone: "blue" }),
  Object.freeze({ key: "frontend", label: "Frontend", tone: "violet" }),
  Object.freeze({ key: "backend", label: "Backend", tone: "green" }),
  Object.freeze({ key: "testing", label: "Testing", tone: "amber" }),
  Object.freeze({ key: "security", label: "Security", tone: "red" }),
]);
const TIMESTAMP_EPOCH_MS = Date.UTC(2026, 0, 1);
let lastRequestTimestampMicros = 0n;

function pad(value, width) {
  return String(value).padStart(width, "0");
}

function todoId(index) {
  return `todo-${pad(index + 1, 4)}`;
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function deepFreeze(root) {
  const stack = [root];
  while (stack.length > 0) {
    const value = stack.pop();
    if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
      continue;
    }
    Object.freeze(value);
    for (const child of Object.values(value)) {
      if (child !== null && typeof child === "object") {
        stack.push(child);
      }
    }
  }
  return root;
}

function createAssignee(index, variantIndex, assigned) {
  if (!assigned) {
    return { id: "", name: "", initials: "--" };
  }
  const number = ((index + variantIndex) % 8) + 1;
  const padded = pad(number, 2);
  return {
    id: `owner-${padded}`,
    name: `Owner ${padded}`,
    initials: `O${number}`,
  };
}

function createTags(id, index, pattern) {
  const tagCount = pattern % 3;
  return Array.from({ length: tagCount }, (_, tagIndex) => {
    const definition = TAGS[(index + tagIndex) % TAGS.length];
    return {
      id: `${id}-tag-${tagIndex + 1}`,
      label: definition.label,
      tone: definition.tone,
    };
  });
}

function createSubtasks(id, itemNumber, pattern) {
  const subtaskCount = pattern % 4;
  return Array.from({ length: subtaskCount }, (_, subtaskIndex) => {
    const completed = (pattern + subtaskIndex) % 2 === 0;
    return {
      id: `${id}-subtask-${subtaskIndex + 1}`,
      label: `Subtask ${subtaskIndex + 1} for item ${pad(itemNumber, 4)}`,
      completed,
      statusLabel: completed ? "Completed" : "Pending",
    };
  });
}

function createTodo(index, variantIndex, selectedIndex) {
  const itemNumber = index + 1;
  const id = todoId(index);
  const pattern = index + variantIndex;
  const completed = pattern % 4 === 0;
  const pending = !completed;
  const priorityCode = pattern % 5;
  const isHighPriority = priorityCode === 0;
  const isMediumPriority = priorityCode === 1 || priorityCode === 2;
  const priority = isHighPriority
    ? "high"
    : isMediumPriority
      ? "medium"
      : "low";
  const overdue = pending && pattern % 10 === 1;
  const dueToday = pending && !overdue && pattern % 10 === 2;
  const blocked = pending && pattern % 11 === 3;
  const recurring = pattern % 6 === 4;
  const assigned = pattern % 5 !== 4;
  const assignee = createAssignee(index, variantIndex, assigned);
  const tags = createTags(id, index, pattern);
  const subtasks = createSubtasks(id, itemNumber, pattern);
  const completedSubtaskCount = subtasks.reduce(
    (total, subtask) => total + Number(subtask.completed),
    0,
  );
  const selected = index === selectedIndex;
  const timestamp = new Date(
    TIMESTAMP_EPOCH_MS
      + (variantIndex * TODO_ITEM_COUNT + index) * 1_000,
  ).toISOString();

  return {
    id,
    title: `Todo ${pad(itemNumber, 4)} · ${timestamp}`,
    timestamp,
    description: `Dynamic snapshot ${pad(variantIndex + 1, 2)} item ${pad(itemNumber, 4)} generated at ${timestamp}.`,
    completed,
    pending,
    priority,
    isHighPriority,
    isMediumPriority,
    overdue,
    dueToday,
    blocked,
    recurring,
    assigned,
    assignee,
    tags,
    tagCount: tags.length,
    hasTags: tags.length > 0,
    subtasks,
    subtaskCount: subtasks.length,
    completedSubtaskCount,
    hasSubtasks: subtasks.length > 0,
    selected,
    visible: true,
    statusLabel: completed ? "Completed" : "Pending",
    priorityLabel: `${priority[0].toUpperCase()}${priority.slice(1)} priority`,
    dueLabel: overdue ? "Overdue" : dueToday ? "Due today" : "Scheduled",
    blockedLabel: blocked ? "Blocked" : "Unblocked",
    recurringLabel: recurring ? "Recurring" : "One-time",
    assigneeLabel: assigned ? `Assigned to ${assignee.name}` : "Unassigned",
    tagCountLabel: plural(tags.length, "tag"),
    subtaskCountLabel: plural(subtasks.length, "subtask"),
    subtaskProgressLabel: `${completedSubtaskCount}/${subtasks.length} subtasks complete`,
    selectionLabel: selected ? "Selected" : "Not selected",
  };
}

function createVariant(variantIndex) {
  const selectedIndex = (variantIndex * 3) % TODO_ITEM_COUNT;
  const todos = Array.from(
    { length: TODO_ITEM_COUNT },
    (_, index) => createTodo(index, variantIndex, selectedIndex),
  );
  const branchCounts = countTodoBranches(todos);
  const totalTags = todos.reduce((total, todo) => total + todo.tagCount, 0);
  const totalSubtasks = todos.reduce(
    (total, todo) => total + todo.subtaskCount,
    0,
  );

  return deepFreeze({
    schema: "webui.ssr-todo-state/v1",
    variantIndex,
    variantId: `variant-${pad(variantIndex + 1, 2)}`,
    variantLabel: `Variant ${pad(variantIndex + 1, 2)} of ${STATE_VARIANT_COUNT}`,
    app: {
      eyebrow: "Framework-neutral SSR fixture",
      title: "SSR Todo Benchmark",
      subtitle: "100 timestamped dynamic items",
      description: "Equivalent component, branch, loop, and interaction work.",
    },
    summary: {
      totalCount: TODO_ITEM_COUNT,
      completedCount: branchCounts.completed,
      pendingCount: branchCounts.pending,
      highPriorityCount: branchCounts["high-priority"],
      overdueCount: branchCounts.overdue,
      selectedCount: branchCounts.selected,
      tagCount: totalTags,
      subtaskCount: totalSubtasks,
      totalLabel: plural(TODO_ITEM_COUNT, "item"),
      completedLabel: plural(branchCounts.completed, "completed item"),
      pendingLabel: plural(branchCounts.pending, "pending item"),
      highPriorityLabel: plural(
        branchCounts["high-priority"],
        "high priority item",
      ),
      overdueLabel: plural(branchCounts.overdue, "overdue item"),
    },
    toolbar: {
      activeFilter: FILTER_IDS[0],
      clearCompletedLabel: "Clear completed",
      hasCompleted: branchCounts.completed > 0,
      filters: [
        {
          id: FILTER_IDS[0],
          label: "All",
          count: TODO_ITEM_COUNT,
          countLabel: String(TODO_ITEM_COUNT),
          active: true,
        },
        {
          id: FILTER_IDS[1],
          label: "Pending",
          count: branchCounts.pending,
          countLabel: String(branchCounts.pending),
          active: false,
        },
        {
          id: FILTER_IDS[2],
          label: "Completed",
          count: branchCounts.completed,
          countLabel: String(branchCounts.completed),
          active: false,
        },
      ],
    },
    selection: {
      todoId: todoId(selectedIndex),
      label: `Selected ${todoId(selectedIndex)}`,
      hasSelection: true,
    },
    branchCounts,
    todos,
    footer: {
      label: "Reproducible dynamic todo contract",
      itemCountLabel: plural(TODO_ITEM_COUNT, "item"),
      variantLabel: `Snapshot ${pad(variantIndex + 1, 2)}`,
    },
  });
}

export function createTodoStateVariants() {
  return deepFreeze(
    Array.from(
      { length: STATE_VARIANT_COUNT },
      (_, variantIndex) => createVariant(variantIndex),
    ),
  );
}

export const TODO_STATE_VARIANTS = createTodoStateVariants();

export function createTodoState(variantIndex = 0) {
  if (
    !Number.isInteger(variantIndex)
    || variantIndex < 0
    || variantIndex >= STATE_VARIANT_COUNT
  ) {
    throw new RangeError(
      `variantIndex must be an integer from 0 to ${STATE_VARIANT_COUNT - 1}`,
    );
  }
  return TODO_STATE_VARIANTS[variantIndex];
}

export function createRequestTodoState(
  state,
  requestTimestamp = currentRequestTimestamp(),
) {
  if (
    typeof requestTimestamp !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(
      requestTimestamp,
    )
  ) {
    throw new TypeError("requestTimestamp must be an ISO UTC microsecond timestamp");
  }
  const variantNumber = pad(state.variantIndex + 1, 2);
  const todos = state.todos.map((todo, index) => {
    const itemNumber = pad(index + 1, 4);
    return {
      ...todo,
      title: `Todo ${itemNumber} · ${requestTimestamp}`,
      timestamp: requestTimestamp,
      description:
        `Dynamic request variant ${variantNumber} item ${itemNumber} rendered at ${requestTimestamp}.`,
    };
  });
  return {
    ...state,
    requestTimestamp,
    todos,
    footer: {
      ...state.footer,
      requestTimestampLabel: `Rendered ${requestTimestamp}`,
    },
  };
}

function wallClockMilliseconds() {
  return typeof performance === "object"
      && Number.isFinite(performance.timeOrigin)
      && typeof performance.now === "function"
    ? performance.timeOrigin + performance.now()
    : Date.now();
}

export function currentRequestTimestamp(nowMs = wallClockMilliseconds()) {
  if (!Number.isFinite(nowMs)) {
    throw new TypeError("nowMs must be finite");
  }
  const nowMicros = BigInt(Math.trunc(nowMs * 1_000));
  const timestampMicros = nowMicros > lastRequestTimestampMicros
    ? nowMicros
    : lastRequestTimestampMicros + 1n;
  lastRequestTimestampMicros = timestampMicros;
  const wholeMilliseconds = timestampMicros / 1_000n;
  const isoMilliseconds = new Date(Number(wholeMilliseconds)).toISOString();
  const fractionalMicros = String(timestampMicros % 1_000_000n).padStart(6, "0");
  return `${isoMilliseconds.slice(0, -5)}.${fractionalMicros}Z`;
}
