// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export default function TodoCheckbox({ todo, onToggle }) {
  return (
    <input
      aria-label={`Toggle completion for ${todo.title}`}
      checked={todo.completed}
      className="todo-checkbox"
      data-action="toggle-completion"
      data-todo-id={todo.id}
      onChange={() => onToggle(todo.id)}
      type="checkbox"
    />
  );
}
