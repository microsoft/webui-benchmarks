// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export function TodoButton(props) {
  return (
    <todo-button data-component="todo-button">
      <button
        aria-label={props.ariaLabel}
        aria-pressed={
          props.pressed === undefined ? undefined : String(props.pressed)
        }
        class="todo-button"
        data-action={props.action}
        data-todo-id={props.todoId}
        disabled={props.disabled}
        onClick={props.onAction}
        type="button"
      >
        {props.label}
      </button>
    </todo-button>
  );
}
