// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export default function TodoFilter({ filter, onFilter }) {
  return (
    <button
      aria-pressed={filter.active}
      className="todo-filter"
      data-action="filter"
      data-active={filter.active ? "" : undefined}
      data-filter={filter.id}
      onClick={() => onFilter(filter.id)}
      type="button"
    >
      <span>{filter.label}</span>
      <span className="todo-filter__count">{filter.countLabel}</span>
    </button>
  );
}
