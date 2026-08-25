// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export function TodoButton({
  action,
  ariaLabel,
  disabled = false,
  label,
  onAction,
  pressed,
  todoId,
}) {
  return (
    <todo-button data-component="todo-button">
      <button
        aria-label={ariaLabel}
        aria-pressed={pressed === undefined ? undefined : String(pressed)}
        className="todo-button"
        data-action={action}
        data-todo-id={todoId}
        disabled={disabled}
        onClick={onAction}
        type="button"
      >
        {label}
      </button>
    </todo-button>
  );
}
