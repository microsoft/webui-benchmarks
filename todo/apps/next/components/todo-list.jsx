// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import TodoItem from "./todo-item.jsx";

function isHidden(todo, activeFilter) {
  if (activeFilter === "pending") {
    return !todo.pending;
  }
  if (activeFilter === "completed") {
    return !todo.completed;
  }
  return false;
}

export default function TodoList({
  activeFilter,
  onSelect,
  onToggle,
  todos,
}) {
  return (
    <ul className="todo-list" aria-label="Todo items" role="listbox">
      {todos.map((todo) => (
        <TodoItem
          hidden={isHidden(todo, activeFilter)}
          key={todo.id}
          onSelect={onSelect}
          onToggle={onToggle}
          todo={todo}
        />
      ))}
    </ul>
  );
}
