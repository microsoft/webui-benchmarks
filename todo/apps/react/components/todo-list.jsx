// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { TodoItem } from "./todo-item.jsx";

export function TodoList({ onSelect, onToggle, todos }) {
  return (
    <todo-list data-component="todo-list">
      <ul aria-label="Todo items" className="todo-list" role="listbox">
        {todos.map((todo) => (
          <TodoItem
            key={todo.id}
            onSelect={onSelect}
            onToggle={onToggle}
            todo={todo}
          />
        ))}
      </ul>
    </todo-list>
  );
}
