// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export function TodoFooter({ footer }) {
  return (
    <todo-footer data-component="todo-footer">
      <footer class="todo-footer">
        <span>{footer.label}</span>
        <span>{footer.itemCountLabel}</span>
        <span>{footer.variantLabel}</span>
      </footer>
    </todo-footer>
  );
}
