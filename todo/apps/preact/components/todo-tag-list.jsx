// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export function TodoTagList({ todo }) {
  return (
    <todo-tag-list data-component="todo-tag-list">
      <div aria-label={todo.tagCountLabel} class="todo-tag-list">
        {todo.tags.map((tag) => (
          <span
            class="todo-tag"
            data-tag-id={tag.id}
            data-tone={tag.tone}
            key={tag.id}
          >
            {tag.label}
          </span>
        ))}
      </div>
    </todo-tag-list>
  );
}
