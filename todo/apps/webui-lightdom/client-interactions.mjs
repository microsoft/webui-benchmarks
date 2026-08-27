// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function visibleForFilter(todo, filterId) {
  return filterId === "all"
    || filterId === "pending" && !todo.completed
    || filterId === "completed" && todo.completed;
}

function withCounts(state, todos) {
  let completedCount = 0;
  let highPriorityCount = 0;
  let overdueCount = 0;
  let selectedTodo;
  for (const todo of todos) {
    completedCount += Number(todo.completed);
    highPriorityCount += Number(todo.isHighPriority);
    overdueCount += Number(todo.overdue);
    if (todo.selected) selectedTodo = todo;
  }
  const pendingCount = todos.length - completedCount;
  const filters = state.toolbar.filters.map((filter) => {
    const count = filter.id === "all"
      ? todos.length
      : filter.id === "pending"
        ? pendingCount
        : completedCount;
    return { ...filter, count, countLabel: String(count) };
  });
  return {
    ...state,
    todos: todos.map((todo) => ({
      ...todo,
      visible: visibleForFilter(todo, state.toolbar.activeFilter),
    })),
    summary: {
      ...state.summary,
      totalCount: todos.length,
      completedCount,
      pendingCount,
      highPriorityCount,
      overdueCount,
      selectedCount: Number(selectedTodo !== undefined),
      totalLabel: plural(todos.length, "item"),
      completedLabel: plural(completedCount, "completed item"),
      pendingLabel: plural(pendingCount, "pending item"),
      highPriorityLabel: plural(highPriorityCount, "high priority item"),
      overdueLabel: plural(overdueCount, "overdue item"),
    },
    toolbar: {
      ...state.toolbar,
      filters,
      hasCompleted: completedCount > 0,
    },
    selection: {
      todoId: selectedTodo?.id ?? "",
      label: selectedTodo === undefined
        ? "No todo selected"
        : `Selected ${selectedTodo.id}`,
      hasSelection: selectedTodo !== undefined,
    },
    footer: {
      ...state.footer,
      itemCountLabel: plural(todos.length, "item"),
    },
  };
}

export function filterTodos(state, filterId) {
  return {
    ...state,
    toolbar: {
      ...state.toolbar,
      activeFilter: filterId,
      filters: state.toolbar.filters.map((filter) => ({
        ...filter,
        active: filter.id === filterId,
      })),
    },
    todos: state.todos.map((todo) => ({
      ...todo,
      visible: visibleForFilter(todo, filterId),
    })),
  };
}

export function selectTodo(state, todoId) {
  return {
    ...state,
    selection: {
      todoId,
      label: `Selected ${todoId}`,
      hasSelection: true,
    },
    todos: state.todos.map((todo) => ({
      ...todo,
      selected: todo.id === todoId,
      selectionLabel: todo.id === todoId ? "Selected" : "Not selected",
    })),
  };
}

export function toggleTodoCompletion(state, todoId) {
  const todos = state.todos.map((todo) => {
    if (todo.id !== todoId) return todo;
    const completed = !todo.completed;
    return {
      ...todo,
      completed,
      pending: !completed,
      statusLabel: completed ? "Completed" : "Pending",
    };
  });
  return withCounts(state, todos);
}

export function clearCompletedTodos(state) {
  const remaining = state.todos.filter((todo) => !todo.completed);
  const selectedId = remaining.find((todo) => todo.selected)?.id
    ?? remaining[0]?.id;
  return withCounts(
    state,
    remaining.map((todo) => {
      const selected = todo.id === selectedId;
      return {
        ...todo,
        selected,
        selectionLabel: selected ? "Selected" : "Not selected",
      };
    }),
  );
}
