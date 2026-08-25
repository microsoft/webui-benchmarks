// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export function TodoBadge({ branch, label }) {
  return (
    <todo-badge
      class="todo-badge"
      data-branch={branch}
      data-component="todo-badge"
    >
      {label}
    </todo-badge>
  );
}
