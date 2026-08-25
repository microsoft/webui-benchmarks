// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export default function TodoButton({
  action,
  ariaLabel,
  disabled = false,
  label,
  onAction,
  pressed,
  todoId,
}) {
  return (
    <button
      aria-label={ariaLabel}
      aria-pressed={pressed}
      className="todo-button"
      data-action={action}
      data-todo-id={todoId}
      disabled={disabled}
      onClick={onAction}
      type="button"
    >
      {label}
    </button>
  );
}
