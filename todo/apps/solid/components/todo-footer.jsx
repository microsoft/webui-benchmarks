// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export function TodoFooter(props) {
  return (
    <todo-footer data-component="todo-footer">
      <footer class="todo-footer">
        <span>{props.footer.label}</span>
        <span>{props.footer.itemCountLabel}</span>
        <span>{props.footer.variantLabel}</span>
      </footer>
    </todo-footer>
  );
}
