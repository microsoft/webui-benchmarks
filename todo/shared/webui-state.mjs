// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export function createWebuiTodo(todo) {
  return {
    assigned: todo.assigned,
    assigneeLabel: todo.assigneeLabel,
    blocked: todo.blocked,
    blockedLabel: todo.blockedLabel,
    completed: todo.completed,
    description: todo.description,
    dueLabel: todo.dueLabel,
    dueToday: todo.dueToday,
    hasSubtasks: todo.hasSubtasks,
    hasTags: todo.hasTags,
    id: todo.id,
    isHighPriority: todo.isHighPriority,
    isMediumPriority: todo.isMediumPriority,
    overdue: todo.overdue,
    pending: todo.pending,
    priority: todo.priority,
    priorityLabel: todo.priorityLabel,
    recurring: todo.recurring,
    recurringLabel: todo.recurringLabel,
    selected: todo.selected,
    selectionLabel: todo.selectionLabel,
    statusLabel: todo.statusLabel,
    subtaskCountLabel: todo.subtaskCountLabel,
    subtaskProgressLabel: todo.subtaskProgressLabel,
    tagCountLabel: todo.tagCountLabel,
    tags: todo.tags,
    title: todo.title,
    visible: todo.visible,
  };
}

export function createWebuiRenderState(state) {
  const { analytics: _analytics, boardColumns: _boardColumns, ...intelligence } =
    state.intelligence;
  return {
    ...state,
    intelligence,
    todos: state.todos.map(createWebuiTodo),
  };
}
