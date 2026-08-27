// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { useEffect, useState } from "preact/hooks";
import { publishHydrated } from "../../../shared/hydration.mjs";
import {
  clearCompletedTodos,
  filterTodos,
  selectTodo,
  toggleTodoCompletion,
  visibleTodos,
} from "../interactions.mjs";
import { TodoFooter } from "./todo-footer.jsx";
import { TodoHeader } from "./todo-header.jsx";
import { TodoList } from "./todo-list.jsx";
import { TodoSummary } from "./todo-summary.jsx";
import { TodoToolbar } from "./todo-toolbar.jsx";
import { WorkspaceIntelligence } from "./workspace-intelligence.jsx";

export function TodoApp({ hydrationId = "preact", renderMode, state }) {
  const [current, setCurrent] = useState(state);
  useEffect(() => {
    publishHydrated(hydrationId);
  }, [hydrationId]);

  function handleFilter(filterId) {
    setCurrent((value) => filterTodos(value, filterId));
  }

  function handleSelect(todoId) {
    setCurrent((value) => selectTodo(value, todoId));
  }

  function handleToggleCompletion(todoId) {
    setCurrent((value) => toggleTodoCompletion(value, todoId));
  }

  function handleClearCompleted() {
    setCurrent((value) => clearCompletedTodos(value));
  }

  return (
    <todo-app data-component="todo-app" data-variant-id={current.variantId}>
      <main
        aria-labelledby="todo-app-title"
        class="todo-app"
        data-route-page="work"
        data-render-mode={renderMode}
      >
        <TodoHeader app={current.app} variantLabel={current.variantLabel} />
        <TodoSummary summary={current.summary} />
        <WorkspaceIntelligence current={current} onStateChange={setCurrent} />
        <TodoToolbar
          onClear={handleClearCompleted}
          onFilter={handleFilter}
          selection={current.selection}
          toolbar={current.toolbar}
        />
        <TodoList
          onSelect={handleSelect}
          onToggle={handleToggleCompletion}
          todos={visibleTodos(current)}
        />
        <TodoFooter footer={current.footer} />
      </main>
    </todo-app>
  );
}
