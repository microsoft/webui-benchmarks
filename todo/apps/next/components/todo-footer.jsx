// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export default function TodoFooter({ footer }) {
  return (
    <footer className="todo-footer">
      <span>{footer.label}</span>
      <span>
        <span data-footer-count>{footer.itemCountLabel}</span>
        {" · "}
        {footer.variantLabel}
      </span>
    </footer>
  );
}
