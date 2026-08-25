// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export function TodoFilter(props) {
  return (
    <todo-filter data-component="todo-filter">
      <button
        aria-label={`${props.filter.label}: ${props.filter.countLabel}`}
        aria-pressed={String(props.filter.active)}
        class="todo-filter"
        data-action="filter"
        data-active={props.filter.active || undefined}
        data-filter={props.filter.id}
        onClick={() => props.onFilter(props.filter.id)}
        type="button"
      >
        <span>{props.filter.label}</span>
        <span class="todo-filter__count">{props.filter.countLabel}</span>
      </button>
    </todo-filter>
  );
}
