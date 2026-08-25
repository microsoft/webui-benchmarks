// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export default function TodoBadge({ branch, label }) {
  return (
    <span className="todo-badge" data-branch={branch}>
      {label}
    </span>
  );
}
