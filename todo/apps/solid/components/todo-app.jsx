// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { createSignal, onMount } from "solid-js";
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

export function TodoApp(props) {
  const [current, setCurrent] = createSignal(props.state);
  onMount(() => {
    publishHydrated("solid");
  });
  return (
    <todo-app
      data-component="todo-app"
      data-variant-id={current().variantId}
    >
      <main
        aria-labelledby="todo-app-title"
        class="todo-app"
        data-route-page="work"
      >
        <TodoHeader
          app={current().app}
          variantLabel={current().variantLabel}
        />
        <TodoSummary summary={current().summary} />
        <WorkspaceIntelligence
          onStateChange={setCurrent}
          state={current()}
        />
        <TodoToolbar
          onClear={() => setCurrent(clearCompletedTodos(current()))}
          onFilter={(filterId) =>
            setCurrent(filterTodos(current(), filterId))}
          selection={current().selection}
          toolbar={current().toolbar}
        />
        <TodoList
          onSelect={(todoId) => setCurrent(selectTodo(current(), todoId))}
          onToggle={(todoId) =>
            setCurrent(toggleTodoCompletion(current(), todoId))}
          todos={visibleTodos(current())}
        />
        <TodoFooter footer={current().footer} />
      </main>
    </todo-app>
  );
}
