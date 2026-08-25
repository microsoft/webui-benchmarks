// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { TodoButton } from "./todo-button.jsx";
import { TodoFilter } from "./todo-filter.jsx";

export function TodoToolbar({ onClear, onFilter, selection, toolbar }) {
  return (
    <todo-toolbar data-component="todo-toolbar">
      <section aria-label="Todo controls" class="todo-toolbar">
        <div aria-label="Filter todos" class="todo-toolbar__filters" role="group">
          {toolbar.filters.map((filter) => (
            <TodoFilter filter={filter} key={filter.id} onFilter={onFilter} />
          ))}
        </div>
        <span aria-live="polite" class="todo-toolbar__selection">
          {selection.label}
        </span>
        <TodoButton
          action="clear-completed"
          ariaLabel={toolbar.clearCompletedLabel}
          disabled={!toolbar.hasCompleted}
          label={toolbar.clearCompletedLabel}
          onAction={onClear}
        />
      </section>
    </todo-toolbar>
  );
}
