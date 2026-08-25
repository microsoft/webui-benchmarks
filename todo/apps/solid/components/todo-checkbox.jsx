// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export function TodoCheckbox(props) {
  return (
    <todo-checkbox data-component="todo-checkbox">
      <input
        aria-label={`${props.todo.statusLabel}: ${props.todo.title}`}
        checked={props.todo.completed}
        class="todo-checkbox"
        data-action="toggle-completion"
        data-todo-id={props.todo.id}
        onChange={() => props.onToggle(props.todo.id)}
        onClick={(event) => event.stopPropagation()}
        type="checkbox"
      />
    </todo-checkbox>
  );
}
