// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { For } from "solid-js";

export function TodoTagList(props) {
  return (
    <todo-tag-list data-component="todo-tag-list">
      <div aria-label={props.todo.tagCountLabel} class="todo-tag-list">
        <For each={props.todo.tags}>
          {(tag) => (
            <span
              class="todo-tag"
              data-tag-id={tag.id}
              data-tone={tag.tone}
            >
              {tag.label}
            </span>
          )}
        </For>
      </div>
    </todo-tag-list>
  );
}
