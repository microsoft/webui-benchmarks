// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export function TodoFilter({ filter, onFilter }) {
  return (
    <todo-filter data-component="todo-filter">
      <button
        aria-label={`${filter.label}: ${filter.countLabel}`}
        aria-pressed={String(filter.active)}
        className="todo-filter"
        data-action="filter"
        data-active={filter.active || undefined}
        data-filter={filter.id}
        onClick={() => onFilter(filter.id)}
        type="button"
      >
        <span>{filter.label}</span>
        <span className="todo-filter__count">{filter.countLabel}</span>
      </button>
    </todo-filter>
  );
}
