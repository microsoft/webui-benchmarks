// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { For } from "solid-js";
import { TodoItem } from "./todo-item.jsx";

export function TodoList(props) {
  return (
    <todo-list data-component="todo-list">
      <ul aria-label="Todo items" class="todo-list" role="listbox">
        <For each={props.todos}>
          {(todo) => (
            <TodoItem
              todo={todo}
              onSelect={props.onSelect}
              onToggle={props.onToggle}
            />
          )}
        </For>
      </ul>
    </todo-list>
  );
}
