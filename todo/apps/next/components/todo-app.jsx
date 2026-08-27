// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

"use client";

import { useEffect, useState } from "react";
import { BRANCHES } from "../../../shared/contract.mjs";
import { publishHydrated } from "../../../shared/hydration.mjs";
import { createWorkspaceIntelligence } from "../../../shared/workspace-intelligence.mjs";
import TodoFooter from "./todo-footer.jsx";
import TodoHeader from "./todo-header.jsx";
import TodoList from "./todo-list.jsx";
import TodoSummary from "./todo-summary.jsx";
import TodoToolbar from "./todo-toolbar.jsx";
import { WorkspaceIntelligence } from "../../react/components/workspace-intelligence.jsx";

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function copyTodoState(source) {
  return {
    ...source,
    app: { ...source.app },
    branchCounts: { ...source.branchCounts },
    footer: { ...source.footer },
    selection: { ...source.selection },
    summary: { ...source.summary },
    toolbar: {
      ...source.toolbar,
      filters: source.toolbar.filters.map((filter) => ({ ...filter })),
    },
    todos: source.todos.map((todo) => ({
      ...todo,
      assignee: { ...todo.assignee },
      subtasks: todo.subtasks.map((subtask) => ({ ...subtask })),
      tags: todo.tags.map((tag) => ({ ...tag })),
    })),
  };
}

function refreshDerivedState(current, todos) {
  const branchCounts = Object.fromEntries(
    BRANCHES.map((branch) => [branch.id, 0]),
  );
  let tagCount = 0;
  let subtaskCount = 0;
  for (const todo of todos) {
    tagCount += todo.tags.length;
    subtaskCount += todo.subtasks.length;
    for (const branch of BRANCHES) {
      if (todo[branch.condition.field]) {
        branchCounts[branch.id] += 1;
      }
    }
  }

  const completedCount = branchCounts.completed;
  const pendingCount = branchCounts.pending;
  const highPriorityCount = branchCounts["high-priority"];
  const overdueCount = branchCounts.overdue;
  const selectedTodo = todos.find((todo) => todo.selected);
  const totalCount = todos.length;

  return {
    ...current,
    branchCounts,
    footer: {
      ...current.footer,
      itemCountLabel: plural(totalCount, "item"),
    },
    intelligence: createWorkspaceIntelligence(todos, current.intelligence),
    selection: {
      todoId: selectedTodo?.id ?? "",
      label: selectedTodo ? `Selected ${selectedTodo.id}` : "No todo selected",
      hasSelection: selectedTodo !== undefined,
    },
    summary: {
      ...current.summary,
      totalCount,
      completedCount,
      pendingCount,
      highPriorityCount,
      overdueCount,
      selectedCount: branchCounts.selected,
      tagCount,
      subtaskCount,
      totalLabel: plural(totalCount, "item"),
      completedLabel: plural(completedCount, "completed item"),
      pendingLabel: plural(pendingCount, "pending item"),
      highPriorityLabel: plural(highPriorityCount, "high priority item"),
      overdueLabel: plural(overdueCount, "overdue item"),
    },
    toolbar: {
      ...current.toolbar,
      hasCompleted: completedCount > 0,
      filters: current.toolbar.filters.map((filter) => {
        const count = filter.id === "all"
          ? totalCount
          : filter.id === "pending"
            ? pendingCount
            : completedCount;
        return { ...filter, count, countLabel: String(count) };
      }),
    },
    todos,
  };
}

export default function TodoApp({ initialState, renderMode }) {
  const [state, setState] = useState(() => copyTodoState(initialState));
  useEffect(() => {
    publishHydrated("next");
  }, []);

  function filterTodos(filterId) {
    setState((current) => ({
      ...current,
      toolbar: {
        ...current.toolbar,
        activeFilter: filterId,
        filters: current.toolbar.filters.map((filter) => ({
          ...filter,
          active: filter.id === filterId,
        })),
      },
    }));
  }

  function selectTodo(todoId) {
    setState((current) => refreshDerivedState(
      current,
      current.todos.map((todo) => {
        const selected = todo.id === todoId;
        return {
          ...todo,
          selected,
          selectionLabel: selected ? "Selected" : "Not selected",
        };
      }),
    ));
  }

  function toggleTodo(todoId) {
    setState((current) => refreshDerivedState(
      current,
      current.todos.map((todo) => {
        if (todo.id !== todoId) {
          return todo;
        }
        const completed = !todo.completed;
        return {
          ...todo,
          completed,
          pending: !completed,
          statusLabel: completed ? "Completed" : "Pending",
        };
      }),
    ));
  }

  function clearCompleted() {
    setState((current) => {
      const remaining = current.todos.filter((todo) => !todo.completed);
      const selectedId = remaining.find((todo) => todo.selected)?.id
        ?? remaining[0]?.id;
      const todos = remaining.map((todo) => {
        const selected = todo.id === selectedId;
        return {
          ...todo,
          selected,
          selectionLabel: selected ? "Selected" : "Not selected",
        };
      });
      return refreshDerivedState(current, todos);
    });
  }

  return (
    <main
      className="todo-app"
      data-route-page="work"
      data-render-mode={renderMode}
      data-variant-id={state.variantId}
    >
      <TodoHeader app={state.app} variantLabel={state.variantLabel} />
      <TodoSummary summary={state.summary} />
      <WorkspaceIntelligence current={state} onStateChange={setState} />
      <TodoToolbar
        onClearCompleted={clearCompleted}
        onFilter={filterTodos}
        selection={state.selection}
        toolbar={state.toolbar}
      />
      <TodoList
        activeFilter={state.toolbar.activeFilter}
        onSelect={selectTodo}
        onToggle={toggleTodo}
        todos={state.todos}
      />
      <TodoFooter footer={state.footer} />
    </main>
  );
}
