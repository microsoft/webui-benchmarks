// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export function TodoBadge(props) {
  return (
    <todo-badge
      class="todo-badge"
      data-branch={props.branch}
      data-component="todo-badge"
    >
      {props.label}
    </todo-badge>
  );
}
