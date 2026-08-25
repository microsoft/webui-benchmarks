// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  ARIA_PRESSED_COUNT,
  BRANCHES,
  COMPONENTS,
  INTERACTIONS,
  REQUIRED_TEXT,
  SELECTORS,
  SENTINEL_IDS,
  TODO_BUTTON_COUNT,
  TODO_ITEM_COUNT,
  TODO_ITEM_FIELDS,
  TODO_ITEM_METADATA_FIELDS,
  countTodoBranches,
} from "./contract.mjs";

function freezeResult(value) {
  const stack = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (
      current === null
      || typeof current !== "object"
      || Object.isFrozen(current)
    ) {
      continue;
    }
    Object.freeze(current);
    for (const child of Object.values(current)) {
      if (child !== null && typeof child === "object") {
        stack.push(child);
      }
    }
  }
  return value;
}

function report(errors) {
  return freezeResult({ valid: errors.length === 0, errors });
}

function sameArray(left, right) {
  return (
    Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index])
  );
}

function resolveCount(specification, metrics) {
  return specification.kind === "metric"
    ? metrics[specification.value]
    : specification.value;
}

function createMetrics(state) {
  return {
    ariaPressedCount: ARIA_PRESSED_COUNT,
    badgeCount: Object.values(state.branchCounts).reduce(
      (total, branchCount) => total + branchCount,
      0,
    ),
    buttonCount: TODO_BUTTON_COUNT,
    filterCount: state.toolbar.filters.length,
    itemCount: state.todos.length,
    metadataCount: state.todos.length * TODO_ITEM_METADATA_FIELDS.length,
    tagCount: state.todos.reduce(
      (total, todo) => total + todo.tags.length,
      0,
    ),
  };
}

function sameJson(left, right) {
  const pending = [[left, right]];
  while (pending.length > 0) {
    const [currentLeft, currentRight] = pending.pop();
    if (Object.is(currentLeft, currentRight)) {
      continue;
    }
    if (
      currentLeft === null
      || currentRight === null
      || typeof currentLeft !== "object"
      || typeof currentRight !== "object"
      || Array.isArray(currentLeft) !== Array.isArray(currentRight)
    ) {
      return false;
    }
    const leftKeys = Object.keys(currentLeft).sort();
    const rightKeys = Object.keys(currentRight).sort();
    if (!sameArray(leftKeys, rightKeys)) {
      return false;
    }
    for (const key of leftKeys) {
      pending.push([currentLeft[key], currentRight[key]]);
    }
  }
  return true;
}

function compareRecord(actual, expected, name, errors) {
  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
    errors.push(`${name} must be an object`);
    return;
  }
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (!sameArray(actualKeys, expectedKeys)) {
    errors.push(`${name} keys do not match the contract`);
    return;
  }
  for (const key of expectedKeys) {
    if (actual[key] !== expected[key]) {
      errors.push(`${name}.${key} must be ${expected[key]}, received ${actual[key]}`);
    }
  }
}

export function validateTodoState(state) {
  const errors = [];
  if (state === null || typeof state !== "object") {
    return report(["state must be an object"]);
  }
  if (!Array.isArray(state.todos)) {
    return report(["state.todos must be an array"]);
  }
  if (state.todos.length !== TODO_ITEM_COUNT) {
    errors.push(`state.todos must contain exactly ${TODO_ITEM_COUNT} items`);
  }

  let selectedCount = 0;
  const ids = new Set();
  for (let index = 0; index < state.todos.length; index += 1) {
    const todo = state.todos[index];
    const expectedId = `todo-${String(index + 1).padStart(4, "0")}`;
    if (todo === null || typeof todo !== "object") {
      errors.push(`state.todos[${index}] must be an object`);
      continue;
    }
    if (
      !sameArray(
        Object.keys(todo).sort(),
        [...TODO_ITEM_FIELDS].sort(),
      )
    ) {
      errors.push(`${expectedId} fields do not match TODO_ITEM_FIELDS`);
    }
    if (todo.id !== expectedId) {
      errors.push(`state.todos[${index}].id must be ${expectedId}`);
    }
    if (ids.has(todo.id)) {
      errors.push(`duplicate todo id ${todo.id}`);
    }
    ids.add(todo.id);
    if (todo.pending !== !todo.completed) {
      errors.push(`${expectedId} completed and pending must be complementary`);
    }
    if (todo.isHighPriority !== (todo.priority === "high")) {
      errors.push(`${expectedId} has an invalid high-priority derivation`);
    }
    if (todo.isMediumPriority !== (todo.priority === "medium")) {
      errors.push(`${expectedId} has an invalid medium-priority derivation`);
    }
    if (!Array.isArray(todo.tags)) {
      errors.push(`${expectedId}.tags must be an array`);
    }
    if (!Array.isArray(todo.subtasks)) {
      errors.push(`${expectedId}.subtasks must be an array`);
    }
    if (todo.hasTags !== (Array.isArray(todo.tags) && todo.tags.length > 0)) {
      errors.push(`${expectedId} has an invalid hasTags derivation`);
    }
    if (
      todo.hasSubtasks
      !== (Array.isArray(todo.subtasks) && todo.subtasks.length > 0)
    ) {
      errors.push(`${expectedId} has an invalid hasSubtasks derivation`);
    }
    if (todo.tagCount !== todo.tags?.length) {
      errors.push(`${expectedId} has an invalid tagCount`);
    }
    if (todo.subtaskCount !== todo.subtasks?.length) {
      errors.push(`${expectedId} has an invalid subtaskCount`);
    }
    selectedCount += Number(todo.selected);
  }
  if (selectedCount !== 1) {
    errors.push(`state must contain exactly one selected todo, received ${selectedCount}`);
  }
  if (
    state.toolbar === null
    || typeof state.toolbar !== "object"
    || !Array.isArray(state.toolbar.filters)
    || state.toolbar.filters.length !== 3
  ) {
    errors.push("state.toolbar.filters must contain all, pending, and completed");
  }
  for (const sentinelId of SENTINEL_IDS) {
    if (!ids.has(sentinelId)) {
      errors.push(`state is missing sentinel ${sentinelId}`);
    }
  }

  const expectedBranches = countTodoBranches(state.todos);
  compareRecord(
    state.branchCounts,
    expectedBranches,
    "state.branchCounts",
    errors,
  );
  return report(errors);
}

export function createExpectedObservation(state) {
  const stateReport = validateTodoState(state);
  if (!stateReport.valid) {
    throw new TypeError(stateReport.errors.join("\n"));
  }
  const metrics = createMetrics(state);
  const selectorCounts = Object.fromEntries(
    SELECTORS.map((selector) => [
      selector.id,
      resolveCount(selector.count, metrics),
    ]),
  );
  const textCounts = Object.fromEntries(
    REQUIRED_TEXT.map((entry) => [entry.id, entry.minimum]),
  );
  const interactionCounts = Object.fromEntries(
    INTERACTIONS.map((interaction) => [
      interaction.id,
      resolveCount(interaction.count, metrics),
    ]),
  );
  const tagIdsByTodo = Object.fromEntries(
    state.todos.map((todo) => [
      todo.id,
      todo.tags.map((tag) => tag.id),
    ]),
  );
  const interactionTargets = {
    filter: state.toolbar.filters.map((filter) => filter.id),
    select: state.todos.map((todo) => todo.id),
    "toggle-completion": state.todos.map((todo) => todo.id),
    "clear-completed": ["clear-completed"],
  };
  const visibleSubtree = {
    toolbar: {
      children: {
        button: 1,
        filter: state.toolbar.filters.length,
        selectionSummary: 1,
      },
      filters: state.toolbar.filters.map((filter) => ({
        action: "filter",
        ariaPressed: String(filter.active),
        countText: filter.countLabel,
        id: filter.id,
        label: filter.label,
      })),
      clearButton: {
        action: "clear-completed",
        ariaPressed: null,
        disabled: !state.toolbar.hasCompleted,
        label: state.toolbar.clearCompletedLabel,
        todoId: null,
      },
      selectionText: state.selection.label,
    },
    items: state.todos.map((todo) => ({
      ariaSelected: String(todo.selected),
      branches: BRANCHES
        .filter((branch) => todo[branch.condition.field])
        .map((branch) => branch.id),
      checkbox: {
        action: "toggle-completion",
        checked: todo.completed,
        todoId: todo.id,
      },
      children: {
      badge: BRANCHES.filter(
        (branch) => todo[branch.condition.field],
      ).length,
      button: 1,
      checkbox: 1,
      tagList: 1,
      },
      id: todo.id,
      metadata: TODO_ITEM_METADATA_FIELDS.map((field) => todo[field]),
      metaRegionCount: 1,
      selectButton: {
        action: "select",
        ariaPressed: String(todo.selected),
        label: "Select",
        todoId: todo.id,
      },
      tags: todo.tags.map((tag) => ({ id: tag.id, label: tag.label })),
      title: todo.title,
    })),
  };

  return freezeResult({
    componentNames: [...COMPONENTS],
    selectorCounts,
    textCounts,
    branchCounts: { ...state.branchCounts },
    itemIds: state.todos.map((todo) => todo.id),
    sentinelIds: [...SENTINEL_IDS],
    tagIdsByTodo,
    interactionCounts,
    interactionTargets,
    visibleSubtree,
  });
}

export function validateObservation(observation, state) {
  const errors = [];
  const stateReport = validateTodoState(state);
  if (!stateReport.valid) {
    return report(stateReport.errors.map((error) => `invalid expected state: ${error}`));
  }
  if (observation === null || typeof observation !== "object") {
    return report(["observation must be an object"]);
  }

  const expected = createExpectedObservation(state);
  if (!sameArray(observation.componentNames, expected.componentNames)) {
    errors.push("componentNames must match the 12 component boundaries in order");
  }
  if (!sameArray(observation.itemIds, expected.itemIds)) {
    errors.push("itemIds must contain the 100 stable todo ids in render order");
  }
  if (!sameArray(observation.sentinelIds, expected.sentinelIds)) {
    errors.push("sentinelIds must contain the three required sentinels in order");
  }

  compareRecord(
    observation.branchCounts,
    expected.branchCounts,
    "branchCounts",
    errors,
  );
  compareRecord(
    observation.interactionCounts,
    expected.interactionCounts,
    "interactionCounts",
    errors,
  );
  if (!sameJson(observation.interactionTargets, expected.interactionTargets)) {
    errors.push("interactionTargets must match every exact data-action binding");
  }
  if (!sameJson(observation.visibleSubtree, expected.visibleSubtree)) {
    errors.push(
      "visibleSubtree must match toolbar, item metadata, branches, tags, and controls",
    );
  }

  const selectorCounts = observation.selectorCounts;
  if (
    selectorCounts === null
    || typeof selectorCounts !== "object"
    || Array.isArray(selectorCounts)
  ) {
    errors.push("selectorCounts must be an object");
  } else {
    const metrics = createMetrics(state);
    for (const selector of SELECTORS) {
      const expectedCount = resolveCount(selector.count, metrics);
      const actualCount = selectorCounts[selector.id];
      if (
        !Number.isInteger(actualCount)
        || actualCount < 0
        || (
          selector.count.kind === "minimum"
            ? actualCount < expectedCount
            : actualCount !== expectedCount
        )
      ) {
        errors.push(
          `selectorCounts.${selector.id} does not satisfy ${selector.count.kind} ${expectedCount}`,
        );
      }
    }
  }

  const textCounts = observation.textCounts;
  if (
    textCounts === null
    || typeof textCounts !== "object"
    || Array.isArray(textCounts)
  ) {
    errors.push("textCounts must be an object");
  } else {
    for (const entry of REQUIRED_TEXT) {
      if (
        !Number.isInteger(textCounts[entry.id])
        || textCounts[entry.id] < entry.minimum
      ) {
        errors.push(`textCounts.${entry.id} must be at least ${entry.minimum}`);
      }
    }
  }

  const tagIdsByTodo = observation.tagIdsByTodo;
  if (
    tagIdsByTodo === null
    || typeof tagIdsByTodo !== "object"
    || Array.isArray(tagIdsByTodo)
  ) {
    errors.push("tagIdsByTodo must be an object");
  } else {
    const actualTodoIds = Object.keys(tagIdsByTodo);
    if (actualTodoIds.length !== TODO_ITEM_COUNT) {
      errors.push(`tagIdsByTodo must contain exactly ${TODO_ITEM_COUNT} todo keys`);
    }
    for (const todo of state.todos) {
      const expectedTagIds = todo.tags.map((tag) => tag.id);
      if (!sameArray(tagIdsByTodo[todo.id], expectedTagIds)) {
        errors.push(`tagIdsByTodo.${todo.id} does not match nested tag data`);
      }
    }
  }

  if (
    observation.branchCounts !== null
    && typeof observation.branchCounts === "object"
    && !Array.isArray(observation.branchCounts)
  ) {
    for (const branch of BRANCHES) {
      if (!(branch.id in observation.branchCounts)) {
        errors.push(`branchCounts is missing ${branch.id}`);
      }
    }
  }
  return report(errors);
}

export function assertValidObservation(observation, state) {
  const validation = validateObservation(observation, state);
  if (!validation.valid) {
    throw new Error(validation.errors.join("\n"));
  }
  return observation;
}
