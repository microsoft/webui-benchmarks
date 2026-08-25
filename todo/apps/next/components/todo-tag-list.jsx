// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export default function TodoTagList({ todo }) {
  return (
    <div className="todo-tag-list" aria-label={todo.tagCountLabel}>
      {todo.tags.map((tag) => (
        <span
          className="todo-tag"
          data-tag-id={tag.id}
          data-tone={tag.tone}
          key={tag.id}
        >
          {tag.label}
        </span>
      ))}
    </div>
  );
}
