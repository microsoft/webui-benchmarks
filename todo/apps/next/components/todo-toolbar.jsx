// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import TodoButton from "./todo-button.jsx";
import TodoFilter from "./todo-filter.jsx";

export default function TodoToolbar({
  onClearCompleted,
  onFilter,
  selection,
  toolbar,
}) {
  return (
    <section className="todo-toolbar" aria-label="Todo controls">
      <div
        className="todo-toolbar__filters"
        role="group"
        aria-label="Filter todos"
      >
        {toolbar.filters.map((filter) => (
          <TodoFilter
            filter={filter}
            key={filter.id}
            onFilter={onFilter}
          />
        ))}
      </div>
      <span className="todo-toolbar__selection" aria-live="polite">
        {selection.label}
      </span>
      <TodoButton
        action="clear-completed"
        ariaLabel={toolbar.clearCompletedLabel}
        disabled={!toolbar.hasCompleted}
        label={toolbar.clearCompletedLabel}
        onAction={onClearCompleted}
      />
    </section>
  );
}
