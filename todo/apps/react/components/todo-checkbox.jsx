// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export function TodoCheckbox({ onToggle, todo }) {
  return (
    <todo-checkbox data-component="todo-checkbox">
      <input
        aria-label={`${todo.statusLabel}: ${todo.title}`}
        checked={todo.completed}
        className="todo-checkbox"
        data-action="toggle-completion"
        data-todo-id={todo.id}
        onChange={() => onToggle(todo.id)}
        onClick={(event) => event.stopPropagation()}
        type="checkbox"
      />
    </todo-checkbox>
  );
}
