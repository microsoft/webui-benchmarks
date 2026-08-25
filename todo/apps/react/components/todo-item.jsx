// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { TodoBadge } from "./todo-badge.jsx";
import { TodoButton } from "./todo-button.jsx";
import { TodoCheckbox } from "./todo-checkbox.jsx";
import { TodoTagList } from "./todo-tag-list.jsx";

export function TodoItem({ onSelect, onToggle, todo }) {
  return (
    <todo-item data-component="todo-item">
      <li
        aria-selected={String(todo.selected)}
        className="todo-item"
        data-selected={todo.selected || undefined}
        data-todo-id={todo.id}
        role="option"
        tabIndex={0}
      >
        <TodoCheckbox onToggle={onToggle} todo={todo} />
        <div className="todo-item__content">
          <strong className="todo-item__title">{todo.title}</strong>
          <span className="todo-item__description">{todo.description}</span>
          <div aria-label="Todo attributes" className="todo-item__badges">
            {todo.completed && (
              <TodoBadge branch="completed" label={todo.statusLabel} />
            )}
            {todo.pending && (
              <TodoBadge branch="pending" label={todo.statusLabel} />
            )}
            {todo.isHighPriority && (
              <TodoBadge branch="high-priority" label={todo.priorityLabel} />
            )}
            {todo.isMediumPriority && (
              <TodoBadge branch="medium-priority" label={todo.priorityLabel} />
            )}
            {todo.overdue && (
              <TodoBadge branch="overdue" label={todo.dueLabel} />
            )}
            {todo.dueToday && (
              <TodoBadge branch="due-today" label={todo.dueLabel} />
            )}
            {todo.blocked && (
              <TodoBadge branch="blocked" label={todo.blockedLabel} />
            )}
            {todo.recurring && (
              <TodoBadge branch="recurring" label={todo.recurringLabel} />
            )}
            {todo.assigned && (
              <TodoBadge branch="assigned" label={todo.assigneeLabel} />
            )}
            {todo.hasTags && (
              <TodoBadge branch="has-tags" label={todo.tagCountLabel} />
            )}
            {todo.hasSubtasks && (
              <TodoBadge
                branch="has-subtasks"
                label={todo.subtaskProgressLabel}
              />
            )}
            {todo.selected && (
              <TodoBadge branch="selected" label={todo.selectionLabel} />
            )}
          </div>
          <TodoTagList todo={todo} />
        </div>
        <div className="todo-item__meta">
          <span>{todo.priorityLabel}</span>
          <span>{todo.dueLabel}</span>
          <span>{todo.assigneeLabel}</span>
          <span>{todo.subtaskCountLabel}</span>
          <TodoButton
            action="select"
            ariaLabel={`Select ${todo.title}`}
            label="Select"
            onAction={() => onSelect(todo.id)}
            pressed={todo.selected}
            todoId={todo.id}
          />
        </div>
      </li>
    </todo-item>
  );
}
