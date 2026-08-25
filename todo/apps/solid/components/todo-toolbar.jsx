// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { For } from "solid-js";
import { TodoButton } from "./todo-button.jsx";
import { TodoFilter } from "./todo-filter.jsx";

export function TodoToolbar(props) {
  return (
    <todo-toolbar data-component="todo-toolbar">
      <section aria-label="Todo controls" class="todo-toolbar">
        <div
          aria-label="Filter todos"
          class="todo-toolbar__filters"
          role="group"
        >
          <For each={props.toolbar.filters}>
            {(filter) => (
              <TodoFilter filter={filter} onFilter={props.onFilter} />
            )}
          </For>
        </div>
        <span aria-live="polite" class="todo-toolbar__selection">
          {props.selection.label}
        </span>
        <TodoButton
          action="clear-completed"
          ariaLabel={props.toolbar.clearCompletedLabel}
          disabled={!props.toolbar.hasCompleted}
          label={props.toolbar.clearCompletedLabel}
          onAction={props.onClear}
        />
      </section>
    </todo-toolbar>
  );
}
